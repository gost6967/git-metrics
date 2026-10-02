// 수집 결과 → 슬랙 mrkdwn 보고서. Claude Agent SDK로 요약하고, 실패하면 커밋 제목 나열로 대체한다.
// 인증: CI는 구독 토큰 CLAUDE_CODE_OAUTH_TOKEN(`claude setup-token`), 로컬은 로그인된 Claude Code 세션.
import { query } from '@anthropic-ai/claude-agent-sdk';

// 요약은 1회 생성이라 도구가 필요 없다. 허용·차단 목록을 함께 줘 빈 허용 목록 해석에 기대지 않는다.
const ALL_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput',
  'KillShell', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

const SYSTEM = `당신은 개발팀의 커밋 기록을 비개발자(경영진·기획·운영·CS)가 읽는 업무 보고로 정리합니다.

입력은 JSON입니다: title(제목), period(기간), mode(daily|weekly), people(사람별 → 레포별 커밋 목록), releases(버전 업데이트 커밋).
커밋의 deployed=true 는 운영 배포 브랜치(main/master)에 반영된 것, false 는 아직 작업 브랜치에만 있는 것입니다.

출력 형식 (슬랙 mrkdwn, 그대로 붙여넣는 용도):
- 첫 줄: *📋 {title}*  둘째 줄: _{period}_
- weekly 일 때만, 사람별 섹션 앞에 "*이번 주 핵심*" 아래 팀 전체에서 중요한 변화 3~5줄.
- 사람별 섹션: "*👤 {이름}*" 다음 줄부터 "• " 목록. 입력 people 순서를 유지합니다.
- 한 사람당 daily 는 2~5줄, weekly 는 3~8줄. 같은 기능을 다룬 여러 커밋은 한 줄로 묶습니다.
- releases 가 있으면 마지막에 "*🚀 배포*" 섹션: 앱은 버전 번호, 서버·웹은 서비스별 횟수로 요약합니다.
- 굵게는 *텍스트* 만 사용합니다. 표, # 제목, **굵게**, 코드 블록은 쓰지 않습니다.

작성 원칙:
- 개발 용어(API, DTO, 엔드포인트, 리팩터링, 마이그레이션, lint, 테스트, 픽스처, 타입 등)를 쓰지 말고, 사용자나 업무 관점에서 무엇이 바뀌었는지 씁니다.
- 기능 이름이나 화면 이름처럼 업무에서 쓰는 말은 그대로 씁니다.
- 테스트·포맷·리뷰 반영·빌드 설정 같은 내부 작업은 별도 줄로 쓰지 말고 관련 기능에 흡수하거나 생략합니다. 내부 작업만 있는 사람은 "내부 정비"로 한 줄만 씁니다.
- 묶은 커밋이 대부분 deployed=false 이면 줄 끝에 "(작업 중)"을 붙입니다.
- 커밋 제목에 없는 효과·수치·일정·이유를 지어내지 않습니다. 모호하면 짧게 씁니다.
- 보고서 외의 말(인사, 설명, 맺음말)은 출력하지 않습니다.`;

export async function summarize(input) {
  if (!input.people.length && !input.releases.length) {
    return `*📋 ${input.title}*\n_${input.period}_\n\n이 기간에 올라온 커밋이 없습니다.`;
  }
  if (process.env.CI && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.warn('CLAUDE_CODE_OAUTH_TOKEN 없음 → 커밋 제목 나열로 대체');
    return plain(input);
  }

  try {
    for await (const message of query({
      prompt: JSON.stringify(input),
      options: {
        ...(process.env.REPORT_MODEL ? { model: process.env.REPORT_MODEL } : {}),
        maxTurns: 1,
        allowedTools: [],
        disallowedTools: ALL_TOOLS,
        permissionMode: 'dontAsk',
        settingSources: [],
        persistSession: false,
        systemPrompt: SYSTEM,
      },
    })) {
      if (message.type !== 'result') continue;
      // 사용 한도 초과 등은 success 로 와도 is_error 가 켜진다
      if (message.subtype !== 'success' || message.is_error) {
        throw new Error(`${message.subtype}${message.is_error ? ': ' + String(message.result ?? '').slice(0, 200) : ''}`);
      }
      const text = message.result.trim();
      if (!text) throw new Error('빈 응답');
      console.log(`요약 완료: in ${message.usage?.input_tokens ?? '?'} / out ${message.usage?.output_tokens ?? '?'} tokens`);
      return text;
    }
    throw new Error('결과 메시지 없음');
  } catch (e) {
    console.error('요약 실패:', e.message); // 본문은 찍지 않는다 (공개 CI 로그)
    return plain(input) + '\n\n_※ 자동 요약에 실패해 커밋 제목을 그대로 나열했습니다._';
  }
}

// 요약 없이 사람별·레포별 커밋 제목 나열
export function plain(input) {
  const lines = [`*📋 ${input.title}*`, `_${input.period}_`];
  for (const p of input.people) {
    lines.push('', `*👤 ${p.name}* (${p.count}건)`);
    for (const r of p.repos) {
      lines.push(`• ${r.product} ${r.layer}`);
      for (const c of r.commits.slice(0, 15)) lines.push(`    ◦ ${c.subject}${c.deployed ? '' : ' (작업 중)'}`);
      if (r.commits.length > 15) lines.push(`    ◦ 외 ${r.commits.length - 15}건`);
    }
  }
  if (input.releases.length) {
    lines.push('', '*🚀 배포*');
    const byService = new Map();
    for (const r of input.releases) {
      const k = `${r.product} ${r.layer}`;
      if (!byService.has(k)) byService.set(k, []);
      byService.get(k).push(r.subject.replace(/^chore\(release\):\s*/i, '').replace(/\s*버전업$/, ''));
    }
    for (const [k, v] of byService) lines.push(`• ${k}: ${v.length > 1 ? `${v[0]} → ${v.at(-1)} (${v.length}회)` : v[0]}`);
  }
  return lines.join('\n');
}
