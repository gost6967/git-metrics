# 생산성 리포트 (레포별 개발 활동)

nd-market·패션온 27개 제품 레포의 **최근 1년(2025-07~)** 개발 활동(커밋/라인/기여자)을 월별로 보여주는 대시보드.
Node 내장 모듈만 사용 — **`npm install` 불필요**.

## 실행

### 1) 거의 실시간 + 외부(LAN) 공개 — 추천
```bash
npm start              # http://localhost:8899, 실행 시 LAN IP도 출력
npm start -- 9000      # 포트 지정 (PORT=9000 npm start 도 가능)
```
- 페이지를 열거나 **🔄 새로고침** 버튼을 누를 때마다 git을 다시 읽어 최신 집계.
- 새로고침(`?fetch=1`)은 20개 레포 `git fetch` 후 재집계(약 10~15초) → 다른 사람 최신 커밋까지 반영.
- `0.0.0.0` 바인딩이라 **같은 네트워크의 팀원**이 `http://<이 PC IP>:8899`로 접속 가능.
  실행하면 콘솔에 공유용 IP 주소가 찍힘.
- 종료: Ctrl+C.

### 2) 정적 스냅샷 (서버 없이 더블클릭)
```bash
npm run build          # 현재 로컬 상태로 생성
npm run build:fetch    # git fetch 후 최신으로 생성
```
→ `../../repo-report.html` 생성. 그 순간의 스냅샷.

## ⚠️ 공개 범위 / 보안
- `npm start`는 **인증이 없습니다.** 포트에 닿는 사람은 누구나 커밋 통계를 봅니다.
- 출력되는 `192.168.x.x`는 **사설 IP** → 같은 사무실/VPN 안에서만 접속됨. 인터넷 공개 아님.
- macOS 방화벽이 "수신 연결 허용" 팝업을 띄우면 허용.
- **진짜 인터넷 공개**가 필요하면 사설 IP로는 안 되고, 사내 리버스 프록시나 터널(cloudflared/ngrep 등)이 필요 —
  이 경우 최소한 접근 제한(basic auth/IP 허용목록)을 앞단에 두는 걸 권장.

## 구성
- `harvest.js`  — 레포 목록·작성자 통합 규칙·git 집계 (핵심)
- `template.html` — 대시보드 HTML (`__DATA__`, `__GEN__` 치환)
- `server.js` / `build.js` — 서버 / 정적 생성
- `package.json` — npm scripts

## 지표 참고
- **순증 라인(net, 기본값)**: 추가−삭제. 리팩터/삭제가 마이너스, 문서(markdown) 레포가 부풀림 → 왜곡 주의.
- **변경 라인(churn = 추가+삭제)**: "얼마나 손댔나"에 가장 공정.
- **커밋 수**: 활동 빈도, 가장 안정적.
- 라인 지표는 네이티브/nextjs 생성물·lockfile 영향 있음.

## 레포 추가
`harvest.js`의 `REPOS` 배열에 `[이름, 상대경로, 브랜치, 제품, 레이어, 카테고리]` 한 줄 추가 → 서버 새로고침이면 반영.
작성자 통합/봇은 `EMAIL_MAP` 참조.

## 업무 보고 (슬랙, 일간·주간)
같은 레포 목록·작성자 통합 규칙으로 팀원 전체의 커밋을 모아 비개발자용 업무 보고를 슬랙에 올린다.
워크플로: `.github/workflows/report.yml`, 코드: `report/`.

| 보고 | 실행 | 집계 기간 (KST) |
|---|---|---|
| 일간 | 평일 17:50 | 직전 근무일 17:50 ~ 당일 17:50 (주말·공휴일 제외) |
| 주간 | 그 주 마지막 근무일 08:50 (보통 금, 금 휴무면 목 …) | 지난 주간 보고일 08:50 ~ 당일 08:50 |

- 한국 공휴일(Google 캘린더 '대한민국의 휴일', 대체·임시공휴일 포함)에는 일간을 게시하지 않고 그 커밋은 다음 근무일 보고에 합쳐진다. 주간은 평일 매일 예약돼 있고 그 주 마지막 근무일에만 게시한다(주 전체가 휴무면 다음 주에 합침). 휴일 정보를 못 받으면 주말만 빼고 평소대로 게시한다.
- 정각은 GitHub 예약 실행 지연이 커서 10분 앞당겼다. 집계 경계도 실행 시각과 같아 지연돼도 커밋이 빠지거나 겹치지 않는다.

- 모든 원격 브랜치의 커밋(병합 제외)을 사람별로 묶는다. `main`/`master`에 안 들어간 작업은 "(작업 중)"으로 표시하고, `chore(release)`는 배포 섹션으로 따로 모은다.
- `report/summarize.mjs`가 Claude Agent SDK로 요약한다. 구독 토큰을 쓰므로 토큰 발급자의 구독 사용량(주간 한도)에서 차감되고 추가 요금은 없다. 토큰이 없거나 한도 초과 등으로 실패하면 커밋 제목 나열로 대체한다. 모델을 고정하려면 Actions 변수 `REPORT_MODEL`(예: `opus`)을 둔다.
- 리베이스로 같은 커밋이 다시 잡히지 않도록, 보고한 커밋은 `report/.state/seen.json`에 기록해 제외한다. CI에서는 Actions 캐시로 보존한다.
- **공개 레포라** 보고서 원문은 커밋하지도 CI 로그에 찍지도 않는다. 슬랙이 유일한 보관처다.

추가 시크릿 (기존 `REPOS_TOKEN`·`AUTHOR_MAP_JSON`은 그대로 공유):
- `CLAUDE_CODE_OAUTH_TOKEN`: 요약용 구독 토큰. 터미널에서 `claude setup-token` 실행 → 브라우저 로그인 → 출력되는 `sk-ant-oat01-...` 값. 이 값을 `ANTHROPIC_API_KEY`에 넣으면 401로 실패한다.
- `SLACK_WEBHOOK_URL`: 슬랙 Incoming Webhook. 일간·주간을 다른 채널로 보내려면 `SLACK_WEBHOOK_URL_DAILY`/`_WEEKLY` (있으면 우선)

```bash
npm install
npm run report:daily                                   # 오늘 일간 (화면 출력만, 로그인된 Claude Code 세션으로 요약)
node report/report.mjs --mode weekly --date 2026-10-02 --plain   # 요약 없이 커밋 나열
node report/report.mjs --mode daily --fetch            # 로컬 레포 fetch 후 집계
```
`--post`를 붙여야 슬랙에 게시하고 상태를 갱신한다. 결과는 `report/out/`에 저장된다(gitignore).
수동 실행: Actions → Work report (Slack) → Run workflow (mode·date·post).

## 예약 실행 60일 중지 방지
공개 레포는 60일간 활동이 없으면 예약 워크플로가 자동 중지된다. 이 레포는 커밋을 만들지 않으므로
`.github/workflows/keepalive.yml`이 매월 1일 `deploy.yml`·`report.yml`·자기 자신을 API로 다시 활성화해 타이머를 초기화한다(빈 커밋 없음).
