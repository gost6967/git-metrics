// 기간 내 커밋 수집 (모든 원격 브랜치, 병합 커밋 제외). 사람별로 묶고 릴리스 커밋은 따로 모은다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 레포 목록·작성자 통합(AUTHOR_MAP_JSON / authors.local.json)은 리포트(harvest.js)와 같은 정의를 쓴다
const { REPOS, canon: canonAuthor } = createRequire(import.meta.url)('../harvest.js');

// 로컬: 워크스페이스의 relpath / CI: REPO_BASE/<key> 로 clone (harvest.js와 같은 규약)
const CI_MODE = !!process.env.REPO_BASE;
const BASE = process.env.REPO_BASE || '/Users/seominsu/WebstormProjects';

const RELEASE_RE = /^chore\(release\)/i;
const AI_DART_RE = /ai-dart/i;

function git(args, cwd, timeout = 120000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 256 * 1024 * 1024, timeout },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

// AI-DART 자동 수정 PR은 봇이지만 보고에는 남긴다
function canon(email, name) {
  if (AI_DART_RE.test(name + email)) return ['AI-DART (자동 수정)', false];
  return canonAuthor(email, name);
}

// 스쿼시 머지가 붙이는 " (#123)" 을 떼서 브랜치 커밋과 같은 작업으로 본다
const normSubject = (s) => s.replace(/(\s*\(#\d+\))+\s*$/, '').trim();

async function mainRef(cwd) {
  const out = await git(['branch', '-r', '--format=%(refname:short)'], cwd);
  const set = new Set(out.split('\n').map((s) => s.trim()));
  for (const b of ['origin/main', 'origin/master']) if (set.has(b)) return b;
  return null;
}

function parseLog(out) {
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, date, authored, email, name, subject] = line.split('\x1f');
    return { hash, date, authored, email, name, subject };
  });
}

const FMT = '--format=%H%x1f%cI%x1f%aI%x1f%ae%x1f%an%x1f%s';

async function collectRepo([key, rel, , product, layer], { since, until, fetch, exclude, staleDays }) {
  const cwd = CI_MODE ? path.join(BASE, key) : path.join(BASE, rel);
  if (!fs.existsSync(path.join(cwd, '.git'))) return { key, missing: true };
  if (fetch) await git(['fetch', '--quiet', '--prune', 'origin'], cwd, 180000);

  const range = [`--since=${since}`, `--until=${until}`];
  const all = parseLog(await git(['log', '--remotes', '--no-merges', ...range, FMT], cwd));

  // 커밋 시각은 기간 전인데 늦게 push 돼 기간 안에 병합된 작업도 싣는다 (예: 금 17:27 커밋 → 화요일 push·병합).
  // 기간 안의 병합 커밋마다 병합으로 새로 들어온 커밋(^1..^2)을 더한다. 이미 보고한 것은 아래 exclude 로 걸러진다.
  const known = new Set(all.map((c) => c.hash));
  const merges = (await git(['log', '--remotes', '--merges', ...range, '--format=%H'], cwd)).split('\n').filter(Boolean);
  for (const m of merges) {
    for (const c of parseLog(await git(['log', '--no-merges', `${m}^1..${m}^2`, FMT], cwd))) {
      if (!known.has(c.hash)) { known.add(c.hash); all.push(c); }
    }
  }
  if (!all.length) return { key, product, layer, commits: [], excluded: 0 };

  // 리베이스로 커밋 날짜만 갱신된 오래된 작업은 제외 (작성일이 기간 시작보다 staleDays 이상 이전)
  const staleBefore = Date.parse(since) - staleDays * 86400000;

  // main/master 에 들어간 것 = 배포 반영. 스쿼시로 해시가 바뀌므로 제목으로도 대조.
  // 늦게 병합된 커밋은 커밋 시각이 기간 전이라, 대조 범위는 staleDays 만큼 넓게 잡는다.
  const ref = await mainRef(cwd);
  const onMain = ref ? parseLog(await git(['log', ref, '--no-merges', `--since=${new Date(staleBefore).toISOString()}`, FMT], cwd)) : [];
  const mainHashes = new Set(onMain.map((c) => c.hash));
  const mainSubjects = new Set(onMain.map((c) => normSubject(c.subject)));
  const seen = new Map();
  let excluded = 0;
  for (const c of all) {
    const [author, bot] = canon(c.email, c.name);
    const subject = normSubject(c.subject);
    const k = key + '\x1f' + author + '\x1f' + subject;
    if (exclude.has(k)) { excluded++; continue; }
    if (Date.parse(c.authored) < staleBefore) continue;
    const deployed = mainHashes.has(c.hash) || mainSubjects.has(subject);
    const prev = seen.get(k);
    if (prev) { prev.deployed ||= deployed; continue; }
    seen.set(k, { key: k, author, bot, subject, date: c.date, deployed });
  }
  return { key, product, layer, commits: [...seen.values()], excluded };
}

// exclude: 이전 보고에 이미 실린 커밋 키(레포·작성자·제목). 리베이스로 날짜가 바뀐 커밋이 다시 실리는 것을 막는다.
// 반환: { people: [{ name, count, repos: [{ repo, product, layer, commits: [{subject, deployed, date}] }] }], releases, keys, missing }
export async function collect({ since, until, fetch = false, exclude = new Set(), staleDays = 14 }) {
  const results = await Promise.all(REPOS.map((r) => collectRepo(r, { since, until, fetch, exclude, staleDays })));
  const people = new Map();
  const releases = [];
  const missing = [];
  const keys = [];
  let excluded = 0;

  for (const r of results) {
    if (r.missing) { missing.push(r.key); continue; }
    excluded += r.excluded;
    for (const c of r.commits) {
      keys.push(c.key);
      if (RELEASE_RE.test(c.subject)) {
        releases.push({ repo: r.key, product: r.product, layer: r.layer, subject: c.subject, date: c.date });
        continue;
      }
      if (c.bot) continue;
      let p = people.get(c.author);
      if (!p) { p = { name: c.author, count: 0, repos: new Map() }; people.set(c.author, p); }
      let pr = p.repos.get(r.key);
      if (!pr) { pr = { repo: r.key, product: r.product, layer: r.layer, commits: [] }; p.repos.set(r.key, pr); }
      pr.commits.push({ subject: c.subject, deployed: c.deployed, date: c.date.slice(0, 16) });
      p.count++;
    }
  }

  const list = [...people.values()]
    .map((p) => ({ ...p, repos: [...p.repos.values()].sort((a, b) => b.commits.length - a.commits.length) }))
    .sort((a, b) => b.count - a.count);
  releases.sort((a, b) => a.date.localeCompare(b.date));
  return { people: list, releases, keys, excluded, missing };
}
