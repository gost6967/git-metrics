// 미리보기 복호화: node report/preview-decrypt.mjs <preview.enc.json> [개인키 경로]
// 개인키 기본값 ~/.config/work-report/preview.key.pem (레포에 두지 않는다)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [file, keyPath = path.join(os.homedir(), '.config', 'work-report', 'preview.key.pem')] = process.argv.slice(2);
if (!file) { console.error('사용법: node report/preview-decrypt.mjs <preview.enc.json> [개인키]'); process.exit(1); }
const enc = JSON.parse(fs.readFileSync(file, 'utf8'));
const key = crypto.privateDecrypt({ key: fs.readFileSync(keyPath), oaepHash: 'sha256' }, Buffer.from(enc.k, 'base64'));
const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
process.stdout.write(Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]).toString('utf8') + '\n');
