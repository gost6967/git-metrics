'use strict';
// 생산성 리포트용 git 집계 (Node 내장 모듈만 사용)
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// 로컬: 워크스페이스 경로 / CI: 각 레포를 REPO_BASE/<key> 로 clone
const BASE = process.env.REPO_BASE || '/Users/seominsu/WebstormProjects';
const CI_MODE = !!process.env.REPO_BASE;
const MIN_MONTH = '2024-09'; // 최근 24개월(2년)치 (2024-09 ~)
// 비개발자(정규화된 표시 이름 기준). 하드 제외 대신 nonDev 플래그로 내보내고, 리포트의 '개발자만' 토글로 숨김/표시.
const NON_DEV_AUTHORS = new Set(['제레미', '한스']);
// 라인 지표(추가/삭제/churn/파일)에서 제외할 자동생성·벤더 파일. 커밋 수엔 영향 없음.
const EXCLUDE_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Podfile\.lock|Gemfile\.lock|go\.sum)$|(^|\/)(dist|build|\.next|out|\.output|node_modules|vendor)\/|\.min\.(js|css)$|\.(map|snap|svg|lock|xcstrings|strings|pbxproj|md|mdx|markdown|rst|adoc)$|operator\.ya?ml$|(^|\/)search-index\.js$|(^|\/)lang-strings\.xml$/i;

// 기본은 nd-market org (레포명 = REPOS 키). 2026-09 NDMARKET(개인계정)→nd-market 이전.
// 아직 이전 안 된 레포·이전하며 개명된 레포만 예외로 명시 (REPOS 키는 리포트 표시명이라 유지)
const SLUG_OVERRIDE = {
  // NDMARKET 잔류
  'musangsa-nextjs': 'NDMARKET/musangsa-nextjs',
  'nd-stocklive':    'NDMARKET/nd-stocklive',
  'qrcode_landing':  'NDMARKET/qrcode_landing',
  'pos':             'NDMARKET/pos',
  // fashionon-repo 잔류
  'fo-data-server':  'fashionon-repo/fo-data-server',
  'fo-back-front':   'fashionon-repo/fo-back-front',
  'fo-scm-front':    'fashionon-repo/fo-scm-front',
  'fo-alarm-front':  'fashionon-repo/fo-alarm-front',
  // fashionon-repo → nd-market 이전 + fo- 접두 개명
  'fashionon-web-2':        'nd-market/fo-fashionon-web-2',
  'orders-partition-batch': 'nd-market/fo-orders-partition-batch',
  'maoda-bridge-app':       'nd-market/fo-maoda-bridge-app',
};
function slugOf(key){ return SLUG_OVERRIDE[key] || 'nd-market/' + key; }

// [repo, relpath, branch, product, layer(detail), cat(coarse)]
const REPOS = [
  ['nd-market-api',       'ndmarket/backend_api',         'devel',   '남도마켓',       '백엔드',            '백엔드'],
  ['vue_retail',          'ndmarket/front_retail',        'develop', '남도마켓',       '프론트(소매)',      '프론트'],
  ['vue_admin',           'ndmarket/front_admin',         'develop', '남도마켓',       '프론트(관리자)',    '프론트'],
  ['native_ios',          'ndmarket/native_ios',          'dev',     '남도마켓',       '네이티브(iOS)',     '네이티브'],
  ['native_android',      'ndmarket/native_android',      'dev',     '남도마켓',       '네이티브(Android)', '네이티브'],
  ['nd-image-proxy',      'ndmarket/nd-image-proxy',      'devel',   '남도마켓',       '이미지 프록시',     '인프라'],
  ['nd-welfare-api',      'wellfare/nd-welfare-api',      'devel',   '복지몰',         '백엔드',            '백엔드'],
  ['ndmall-nextjs',       'wellfare/ndmall-nextjs',       'main',    '복지몰',         '프론트',            '프론트'],
  ['ndmall-admin-nextjs', 'wellfare/ndmall-nextjs-admin', 'main',    '복지몰',         '프론트(관리자)',    '프론트'],
  ['nd-es-bridge',        'save/nd-es-bridge',            'main',    '공통/플랫폼',    '검색 브릿지',       '백엔드'],
  ['knowledge-base',      'knowledge-base',               'main',    '공통/플랫폼',    '문서/하네스',       '문서/공통'],
  ['ai-harness-common',   'ai-harness-common',            'main',    '공통/플랫폼',    '하네스 공통',       '문서/공통'],
  ['nd-pengdi-fe',        'save/pendig',                  'main',    '펭디(pengdi)',   '프론트',            '프론트'],
  ['musangsa-nextjs',     'save/qrcode/musangsa-next',    'main',    '무신사(musangsa)','프론트',           '프론트'],
  ['nd-stocklive',        'save/qrcode/nd-stocklive',     'main',    '스톡라이브',     '프론트',            '프론트'],
  ['qrcode_landing',      'save/qrcode_landing',          'main',    'QR랜딩',         '랜딩 서브사이트',    '프론트'],
  ['pos',                 'save/pos',                     'main',    'POS',            'POS 앱',            '프론트'],
  ['uncle-backend',       'save/uncle-backend',           'main',    '엉클(uncle)',    '백엔드',            '백엔드'],
  ['uncle-ai',            'save/uncle-ai',                'main',    '엉클(uncle)',    'AI',                'AI'],
  ['uncle-frontend',      'save/uncle-frontend',          'main',    '엉클(uncle)',    '프론트',            '프론트'],
  ['fo-data-server',      'save/fashion/fo-data-server',        'master', '패션온(fashionon)', '백엔드',          '백엔드'],
  ['fashionon-web-2',     'save/fashion/fashionon-web-2',       'main',   '패션온(fashionon)', '웹 프론트',       '프론트'],
  ['fo-back-front',       'save/fashion/fo-back-front',         'main',   '패션온(fashionon)', '백오피스 프론트', '프론트'],
  ['fo-scm-front',        'save/fashion/fo-scm-front',          'main',   '패션온(fashionon)', 'SCM 프론트',      '프론트'],
  ['fo-alarm-front',      'save/fashion/fo-alarm-front',        'main',   '패션온(fashionon)', '알림 프론트',     '프론트'],
  ['orders-partition-batch','save/fashion/orders-partition-batch','main', '패션온(fashionon)', '주문 배치',       '백엔드'],
  ['maoda-bridge-app',    'save/fashion/maoda-bridge-app',      'master', '패션온(fashionon)', '브릿지 앱',       '백엔드'],
  ['nd-automation-service','save/nd-automation-service',        'main',   '남도마켓',       '자동화 서비스',     '백엔드'],
  ['nd-transflow',        'save/nd-transflow',                  'main',   '남도마켓',       'transflow',         '백엔드'],
  ['parcel-tracker',      'save/parcel-tracker',                'main',   '남도마켓',       '배송 추적',         '백엔드'],
  ['nd-welfare-aos',      'save/nd-welfare-aos',                'main',   '복지몰',         '네이티브(Android)', '네이티브'],
  ['nd-welfare-ios',      'save/nd-welfare-ios',                'main',   '복지몰',         '네이티브(iOS)',     '네이티브'],
];

// 동일인(다중 이메일) 통합 + 봇 목록. [표시이름, isBot]
// ⚠️ 개인 이메일은 코드에 넣지 않음(공개 레포). 다음 우선순위로 로드:
//   1) 환경변수 AUTHOR_MAP_JSON (CI: GitHub Secret)
//   2) 로컬 파일 authors.local.json (gitignore, 개발용)
//   3) 없으면 빈 맵(정규화 없이 원본 이름 사용 + 이름에 bot 포함시 봇 처리)
function loadAuthorMap() {
  if (process.env.AUTHOR_MAP_JSON) {
    try { return JSON.parse(process.env.AUTHOR_MAP_JSON); } catch (e) { console.error('AUTHOR_MAP_JSON 파싱 실패:', e.message); }
  }
  try {
    const p = path.join(__dirname, 'authors.local.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}
const EMAIL_MAP = loadAuthorMap();

function canon(email, name) {
  const e = String(email).trim().toLowerCase();
  if (EMAIL_MAP[e]) return EMAIL_MAP[e];
  const bot = /bot|action|qodana/.test((name + e).toLowerCase());
  return [name.trim() || e, bot];
}

function git(args, cwd, timeout = 120000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 512 * 1024 * 1024, timeout },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

// 모든 레포를 main 기준으로 통일. main 없으면 master 폴백. 반환값은 origin/<branch> ref.
async function pickBranch(cwd) {
  const out = await git(['branch', '-r', '--format=%(refname:short)'], cwd);
  const set = new Set(out.split('\n').map((s) => s.trim()));
  for (const b of ['main', 'master']) if (set.has('origin/' + b)) return b;
  return null;
}

async function extract(cwd, branch) {
  const out = await git(
    ['log', branch, '--no-merges', '--numstat', `--since=${MIN_MONTH}-01`,
     '--date=format:%Y-%m', '--pretty=format:C|%H|%ad|%ae|%an'], cwd);
  const agg = new Map();
  let month, hash, author, bot;
  const bucket = (m, a, b) => {
    const k = m + ' ' + a + ' ' + b;
    let v = agg.get(k);
    if (!v) { v = { commits: new Set(), added: 0, deleted: 0, files: 0 }; agg.set(k, v); }
    return v;
  };
  for (const line of out.split('\n')) {
    if (line.startsWith('C|')) {
      const p = line.split('|'); hash = p[1]; month = p[2];
      [author, bot] = canon(p[3], p.slice(4).join('|'));
      bucket(month, author, bot).commits.add(hash);
      continue;
    }
    if (!line.trim()) continue;
    const m = line.match(/^(\S+)\t(\S+)\t(.+)$/);
    if (!m) continue;
    if (EXCLUDE_FILE.test(m[3])) continue;   // 생성/lock/벤더 파일은 라인 집계 제외
    const add = m[1] === '-' ? 0 : parseInt(m[1], 10);
    const del = m[2] === '-' ? 0 : parseInt(m[2], 10);
    const b = bucket(month, author, bot);
    b.added += add; b.deleted += del; b.files += 1; b.commits.add(hash);
  }
  const recs = [];
  for (const [k, v] of agg) {
    const [mon, auth, bt] = k.split(' ');
    if (mon < MIN_MONTH) continue;
    recs.push({ month: mon, author: auth, bot: bt === 'true', nonDev: NON_DEV_AUTHORS.has(auth),
      commits: v.commits.size, added: v.added, deleted: v.deleted,
      net: v.added - v.deleted, churn: v.added + v.deleted, files: v.files });
  }
  return recs;
}

async function harvest({ fetch = false } = {}) {
  const data = {};
  await Promise.all(REPOS.map(async ([repo, rel, _cfgBranch, product, layer, cat]) => {
    const cwd = CI_MODE ? path.join(BASE, repo) : path.join(BASE, rel); // CI는 REPO_BASE/<key>
    const branch = await pickBranch(cwd);            // main 우선, 없으면 master
    if (!branch) { data[repo] = { branch: '(none)', product, layer, cat, records: [] }; return; }
    if (fetch) await git(['fetch', '--quiet', 'origin', branch], cwd);
    data[repo] = { branch, product, layer, cat, records: await extract(cwd, 'origin/' + branch) };
  }));
  // REPOS 정의 순서 보존
  const ordered = {};
  for (const [repo] of REPOS) if (data[repo]) ordered[repo] = data[repo];
  return ordered;
}

// CI clone용: [{ key, slug }] 목록
function repoList() { return REPOS.map(([key]) => ({ key, slug: slugOf(key) })); }

module.exports = { harvest, REPOS, MIN_MONTH, slugOf, repoList, canon };
