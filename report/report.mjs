// 사용법: node report/report.mjs --mode daily|weekly [--date YYYY-MM-DD] [--fetch] [--post] [--plain] [--skip-holiday]
//   daily : 직전 근무일 17:50 ~ 당일 17:50 (KST, 주말·공휴일은 근무일에서 제외)
//   weekly: 지난 주간 보고일 08:50 ~ 당일 08:50 (KST). 보고일 = 그 주 마지막 근무일(보통 금, 금이 휴무면 목 …)
//   경계 시각 = 예약 실행 시각. 실행이 늦게 시작해도 경계 이후 커밋은 다음 보고로 넘어가 빠지거나 겹치지 않는다.
//   --skip-holiday: 당일이 보고일이 아니면(일간: 주말·공휴일, 주간: 그 주 마지막 근무일이 아님) 게시하지 않고 끝낸다.
//                   예약 실행에서만 쓴다 — 주간은 평일 매일 예약하고 이 판정으로 하루만 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { summarize, plain } from './summarize.mjs';
import { loadHolidays } from './holidays.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// 공개 레포라 보고서 원문·상태는 커밋하지 않는다 (둘 다 gitignore, CI 상태는 Actions 캐시로 보존)
const OUT_DIR = path.join(here, 'out');
const STATE = path.join(here, '.state', 'seen.json');
const CI = !!process.env.CI;

function parseArgs(argv) {
  const a = { mode: 'daily', date: null, fetch: false, post: false, plain: false, skipHoliday: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mode') a.mode = argv[++i];
    else if (k === '--date') a.date = argv[++i];
    else if (k === '--fetch') a.fetch = true;
    else if (k === '--post') a.post = true;
    else if (k === '--plain') a.plain = true;
    else if (k === '--skip-holiday') a.skipHoliday = true;
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
const iso = (ymd, hm) => `${ymd}T${hm}:00+09:00`;

const DAILY_AT = '17:50';
const WEEKLY_AT = '08:50';

// 예약 실행의 기준 날짜. GitHub 예약 실행은 몇 시간씩 늦게 시작하기도 해서(10/2 17:50 회차가 10/3 00:03에 시작)
// 실행 시각이 아니라 '가장 최근에 지난 예약 시각'의 날짜를 쓴다. 24시간 미만 지연까지 같은 회차로 본다.
function slotDate(mode) {
  const nowKst = new Date(Date.now() + 9 * 3600000).toISOString(); // YYYY-MM-DDTHH:MM…
  const at = mode === 'daily' ? DAILY_AT : WEEKLY_AT;
  const today = nowKst.slice(0, 10);
  return nowKst.slice(11, 16) >= at ? today : addDays(today, -1);
}

// 주말·공휴일
const isOff = (ymd, holidays) => [0, 6].includes(weekday(ymd)) || holidays.has(ymd);

// date 가 속한 주(월~금)의 주간 보고일 = 마지막 근무일. 한 주 전체가 휴무면 null.
function weeklyReportDay(date, holidays) {
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  for (let d = addDays(monday, 4); d >= monday; d = addDays(d, -1)) if (!isOff(d, holidays)) return d;
  return null;
}

// 예약 실행에서 오늘 보낼 날인지
function isReportDay(mode, date, holidays) {
  return mode === 'daily' ? !isOff(date, holidays) : weeklyReportDay(date, holidays) === date;
}

function period(mode, date, holidays) {
  if (mode === 'daily') {
    let prev = addDays(date, -1);
    while (isOff(prev, holidays)) prev = addDays(prev, -1); // 월요일·연휴 다음 날은 직전 근무일부터
    return {
      since: iso(prev, DAILY_AT), until: iso(date, DAILY_AT),
      title: `일간 개발 업무 보고 – ${label(date)}`,
      period: `${label(prev)} ${DAILY_AT} ~ ${label(date)} ${DAILY_AT} · 원격 저장소에 올라온 커밋 기준`,
    };
  }
  // 직전 주간 보고일. 한 주 전체가 휴무였다면 그 주는 보고가 없으므로 더 거슬러 올라가 합친다.
  let from = null;
  for (let w = 1; !from && w <= 8; w++) from = weeklyReportDay(addDays(date, -7 * w), holidays);
  from ??= addDays(date, -7);
  return {
    since: iso(from, WEEKLY_AT), until: iso(date, WEEKLY_AT),
    title: `주간 개발 업무 보고 – ${label(from)} ~ ${label(date)}`,
    period: `${label(from)} ${WEEKLY_AT} ~ ${label(date)} ${WEEKLY_AT} · 원격 저장소에 올라온 커밋 기준`,
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
  const date = args.date || (args.skipHoliday ? slotDate(args.mode) : todayKst());
  const holidays = (await loadHolidays()) ?? new Map();
  if (args.skipHoliday && !isReportDay(args.mode, date, holidays)) {
    console.log(`${date} ${holidays.get(date) ?? ''} → ${args.mode} 보고일이 아니라 게시하지 않음`);
    return;
  }
  const p = period(args.mode, date, holidays);
  console.log(`[${args.mode}] ${p.since} ~ ${p.until}`);

  const state = loadState();
  const exclude = new Set(Object.keys(state[args.mode] || {}));
  const staleDays = args.mode === 'daily' ? 7 : 14;
  const data = await collect({ since: p.since, until: p.until, fetch: args.fetch, exclude, staleDays });
  if (data.missing.length) console.warn('없는 레포(건너뜀):', data.missing.join(', '));
  const total = data.people.reduce((n, x) => n + x.count, 0);
  console.log(`커밋 ${total}건 · ${data.people.length}명 · 릴리스 ${data.releases.length}건 (이미 보고 ${data.excluded}건 제외)`);
  // 수동 실행 뒤 늦게 돈 예약 실행처럼, 새 커밋 없이 이미 보고한 것만 있으면 빈 보고를 다시 올리지 않는다
  if (args.post && !data.keys.length && data.excluded) {
    console.log('새로 보고할 커밋이 없어 게시하지 않음');
    return;
  }

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
