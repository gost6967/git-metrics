// knowledge-base 업무 문서 색인(서비스·제목·한 줄 요약). 업무 보고가 기능 이름·업무 목적을 KB 용어로 설명하도록 참고 자료로만 넘긴다.
// 이번 주 무엇이 바뀌었는지의 근거는 아니다(그건 커밋). CI 는 REPO_BASE/knowledge-base(clone), 로컬은 워크스페이스의 knowledge-base.
import fs from 'node:fs';
import path from 'node:path';

const CI_MODE = !!process.env.REPO_BASE;
const BASE = process.env.REPO_BASE || '/Users/seominsu/WebstormProjects';
const SERVICES = [['domains', '남도마켓'], ['uncle', 'ND엉클'], ['uncle-pos', 'UNCLE POS'], ['welfare', '복지몰']];
const SUMMARY_MAX = 350;

function mdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? mdFiles(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

// "## 1. 한 줄 요약" 절, 없으면 제목 뒤 첫 일반 문단
function summaryOf(text) {
  const m = text.match(/^##\s*1\.\s*한 줄 요약\s*\n([\s\S]*?)(?=\n#{2,3}\s)/m);
  const body = m ? m[1] : text.replace(/^#.*\n/, '').split(/\n\s*\n/).find((p) => p.trim() && !/^\s*[>|#-]/.test(p)) || '';
  return body.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
}

export function kbIndex() {
  const root = path.join(BASE, 'knowledge-base', 'docs', 'business-logic');
  const lines = [];
  for (const [dir, service] of SERVICES) {
    for (const f of mdFiles(path.join(root, dir)).sort()) {
      const text = fs.readFileSync(f, 'utf8');
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const summary = summaryOf(text);
      if (title && summary) lines.push(`[${service}] ${title}: ${summary}`);
    }
  }
  if (!lines.length) console.warn(`KB 문서를 찾지 못함 (${root}) → KB 없이 진행`);
  return lines.join('\n');
}
