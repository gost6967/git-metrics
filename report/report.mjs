// 사용법: node report/report.mjs --mode daily|weekly [--date YYYY-MM-DD] [--fetch] [--post] [--plain]
//   daily : 직전 평일 18:00 ~ 당일 18:00 (KST)
//   weekly: 7일 전 09:00 ~ 당일 09:00 (KST, 금요일 실행 기준)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { summarize, plain } from './summarize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// 공개 레포라 보고서 원문·상태는 커밋하지 않는다 (둘 다 gitignore, CI 상태는 Actions 캐시로 보존)
const OUT_DIR = path.join(here, 'out');
const STATE = path.join(here, '.state', 'seen.json');
const CI = !!process.env.CI;

function parseArgs(argv) {
  const a = { mode: 'daily', date: null, fetch: false, post: false, plain: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mode') a.mode = argv[++i];
    else if (k === '--date') a.date = argv[++i];
    else if (k === '--fetch') a.fetch = true;
    else if (k === '--post') a.post = true;
    else if (k === '--plain') a.plain = true;
  }
  if (!['daily', 'weekly'].includes(a.mode)) throw new Error('--mode 는 daily 또는 weekly');
  return a;
}

// ── KST 날짜 계산 (Date 는 UTC 기준이라 +9h 이동 후 UTC getter 로 읽는다) ──
const DAY = 86400000;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const label = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(${WD[weekday(ymd)]})`;
const iso = (ymd, hh) => `${ymd}T${hh}:00:00+09:00`;

function period(mode, date) {
  if (mode === 'daily') {
    let prev = addDays(date, -1);
    while ([0, 6].includes(weekday(prev))) prev = addDays(prev, -1); // 월요일은 금요일 18시부터
    return {
      since: iso(prev, '18'), until: iso(date, '18'),
      title: `일간 개발 업무 보고 – ${label(date)}`,
      period: `${label(prev)} 18:00 ~ ${label(date)} 18:00 · 원격 저장소에 올라온 커밋 기준`,
    };
  }
  const from = addDays(date, -7);
  return {
    since: iso(from, '09'), until: iso(date, '09'),
    title: `주간 개발 업무 보고 – ${label(from)} ~ ${label(date)}`,
    period: `${label(from)} 09:00 ~ ${label(date)} 09:00 · 원격 저장소에 올라온 커밋 기준`,
  };
}

// 이미 보고한 커밋 키 (모드별). 슬랙 게시가 성공했을 때만 갱신한다.
const KEEP_DAYS = 45;
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { daily: {}, weekly: {} }; }
}
function saveState(state, mode, keys, date) {
  const cutoff = addDays(date, -KEEP_DAYS);
  const cur = Object.fromEntries(Object.entries(state[mode] || {}).filter(([, d]) => d >= cutoff));
  for (const k of keys) cur[k] ??= date;
  state[mode] = cur;
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
}

async function postSlack(mode, text) {
  const url = process.env[`SLACK_WEBHOOK_URL_${mode.toUpperCase()}`] || process.env.SLACK_WEBHOOK_URL;
  if (!url) { console.warn('SLACK_WEBHOOK_URL 없음 → 슬랙 게시 건너뜀'); return false; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mrkdwn: true }),
  });
  if (!res.ok) throw new Error(`슬랙 게시 실패 ${res.status}: ${await res.text()}`);
  console.log('슬랙 게시 완료');
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date || todayKst();
  const p = period(args.mode, date);
  console.log(`[${args.mode}] ${p.since} ~ ${p.until}`);

  const state = loadState();
  const exclude = new Set(Object.keys(state[args.mode] || {}));
  const staleDays = args.mode === 'daily' ? 7 : 14;
  const data = await collect({ since: p.since, until: p.until, fetch: args.fetch, exclude, staleDays });
  if (data.missing.length) console.warn('없는 레포(건너뜀):', data.missing.join(', '));
  const total = data.people.reduce((n, x) => n + x.count, 0);
  console.log(`커밋 ${total}건 · ${data.people.length}명 · 릴리스 ${data.releases.length}건`);

  const input = { title: p.title, period: p.period, mode: args.mode, people: data.people, releases: data.releases };
  const text = args.plain ? plain(input) : await summarize(input);

  const out = path.join(OUT_DIR, args.mode, `${date}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text + '\n');
  console.log('저장:', path.relative(here, out));

  if (args.post) {
    // 실제로 게시됐을 때만 '보고함'으로 기록 (웹훅 미설정이면 다음 보고에 다시 싣는다)
    if (await postSlack(args.mode, text)) saveState(state, args.mode, data.keys, date);
  } else if (!CI) {
    console.log('\n' + text); // CI 로그는 공개라 본문을 찍지 않는다
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
