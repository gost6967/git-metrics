'use strict';
// 정적 스냅샷 생성.
//   node build.js               → ../../repo-report.html (로컬 더블클릭용)
//   node build.js --fetch       → git fetch 후 생성
//   node build.js --pages       → ./docs/index.html (GitHub Pages 배포용, 새로고침 버튼 숨김)
//   npm run build / build:fetch / build:pages
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { harvest, REPOS } = require('./harvest');

const HERE = __dirname;
const TEMPLATE = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');

function pad(n) { return String(n).padStart(2, '0'); }

// AES-256-GCM(비밀번호 PBKDF2). WebCrypto와 호환되도록 ct||tag(16B) 이어붙임.
function encryptPayload(jsonStr, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 150000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(jsonStr, 'utf8'), c.final()]);
  return { mode: 'enc', salt: salt.toString('base64'), iv: iv.toString('base64'),
           ct: Buffer.concat([ct, c.getAuthTag()]).toString('base64') };
}

(async () => {
  const doFetch = process.argv.includes('--fetch');
  const pages = process.argv.includes('--pages');
  const data = await harvest({ fetch: doFetch });
  const d = new Date();
  const now = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let payload;
  if (pages) {
    const pw = process.env.REPORT_PASSWORD;
    if (!pw) { console.error('✗ REPORT_PASSWORD 환경변수가 필요합니다 (pages 모드는 데이터를 암호화).'); process.exit(1); }
    payload = encryptPayload(JSON.stringify(data), pw);
  } else {
    payload = { mode: 'plain', data };
  }
  let html = TEMPLATE
    .replace('__PAYLOAD__', JSON.stringify(payload))
    .replace('__GEN__', `스냅샷 · ${now} 생성` + (pages ? ' (매일 자동 갱신)' : ''));
  let dest;
  if (pages) {
    // Pages는 정적 → 서버 없는 새로고침 버튼 숨김
    html = html.replace(/<button id="refreshBtn"[\s\S]*?<\/button>/, '');
    const docs = path.join(HERE, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, '.nojekyll'), '');
    dest = path.join(docs, 'index.html');
  } else {
    dest = '/Users/seominsu/WebstormProjects/repo-report.html';
  }
  fs.writeFileSync(dest, html);
  console.log('wrote', dest, html.length, 'bytes', doFetch ? '(fetched)' : '(local)', pages ? '[pages]' : '');
})();
