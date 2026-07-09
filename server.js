'use strict';
// 생산성 리포트 로컬 서버 (외부 공개). 요청마다 git 재집계.
//   npm start           → http://localhost:8899 (+ LAN IP 출력)
//   npm start -- 9000   → 포트 지정 (PORT 환경변수도 지원)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { harvest, REPOS } = require('./harvest');

const HERE = __dirname;
const TEMPLATE = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');
const PORT = Number(process.argv[2] || process.env.PORT || 8899);

function lanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

function pad(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function render(doFetch) {
  const data = await harvest({ fetch: doFetch });
  const gen = `실시간 · ${stamp()} 기준` + (doFetch ? ' (git fetch 완료)' : '');
  const payload = JSON.stringify({ mode: 'plain', data });
  return TEMPLATE.replace('__PAYLOAD__', payload).replace('__GEN__', gen);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!['/', '/index.html', '/report'].includes(u.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  try {
    const body = await render(u.searchParams.get('fetch') === '1');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('error: ' + (e && e.message));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('▶ 생산성 리포트 서버 (외부 공개, Ctrl+C 종료)');
  console.log(`  이 컴퓨터:      http://localhost:${PORT}`);
  console.log(`  같은 네트워크:  http://${ip}:${PORT}   ← 팀원에게 이 주소 공유`);
  console.log(`  레포 ${REPOS.length}개 · 인증 없음(포트에 닿는 누구나 열람)`);
  console.log('  ※ macOS 방화벽 "수신 연결 허용" 팝업이 뜨면 허용');
  console.log('  첫 로드/새로고침 시 git 집계로 몇 초 소요');
});
