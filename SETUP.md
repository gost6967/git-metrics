# GitHub Pages 배포 설정 (gost6967/git-metrics)

공개 레포지만 **데이터는 비밀번호로 암호화**되어 올라가므로, 비밀번호 없이는 통계를 볼 수 없습니다.
(코드에도 개인 이메일은 없음 — 작성자 매핑은 Secret으로 주입)

## 1. 시크릿 3개 등록
레포 → Settings → Secrets and variables → Actions → **New repository secret**

| 이름 | 값 | 설명 |
|---|---|---|
| `REPORT_PASSWORD` | 원하는 비밀번호 | 페이지 열람 비밀번호 (팀에 공유) |
| `AUTHOR_MAP_JSON` | `authors.local.json` 파일 내용 전체 | 동일인/봇 매핑(개인 이메일 포함, 그래서 코드가 아닌 Secret) |
| clone 토큰 | 아래 A 또는 B | 27개(비공개) 레포 clone용 |

### clone 토큰 — 둘 중 하나 선택
**A. Classic PAT 1개 (간단)** — `repo` scope, NDMARKET·fashionon-repo 두 org 모두 접근 가능한 계정.
- 시크릿 이름: `REPOS_TOKEN`

**B. Fine-grained PAT 2개 (권한 최소화, 더 안전)** — fine-grained는 소유자 1명만 지정 가능하므로 org별로 1개씩.
- `REPOS_TOKEN_ND` : owner=NDMARKET, Repository access=대상 레포, **Contents: Read-only**
- `REPOS_TOKEN_FO` : owner=fashionon-repo, 동일 권한
- ⚠️ org가 fine-grained PAT를 허용해야 하고 org owner 승인이 필요할 수 있음.
- 워크플로는 org별로 토큰을 골라 쓰고, 없으면 `REPOS_TOKEN`으로 폴백.

CLI로도 가능:
```bash
gh secret set REPORT_PASSWORD --repo gost6967/git-metrics
gh secret set AUTHOR_MAP_JSON --repo gost6967/git-metrics < authors.local.json
# A) 클래식 1개
gh secret set REPOS_TOKEN     --repo gost6967/git-metrics
# 또는 B) fine-grained 2개
gh secret set REPOS_TOKEN_ND  --repo gost6967/git-metrics
gh secret set REPOS_TOKEN_FO  --repo gost6967/git-metrics
```

## 2. Pages 소스 지정
레포 → Settings → **Pages** → Build and deployment → Source = **GitHub Actions**

## 3. 첫 배포 실행
레포 → **Actions** → "Build & Deploy report" → **Run workflow**
- 이후 매일 06:00(KST) 자동 갱신 (`.github/workflows/deploy.yml`의 cron).
- 완료되면 `https://gost6967.github.io/git-metrics/` 접속 → 비밀번호 입력.

## 참고
- `REPOS_TOKEN`이 접근 못 하는 레포는 clone을 건너뛰고(로그에 `skip`) 나머지만 집계합니다.
- 비밀번호를 바꾸려면 `REPORT_PASSWORD` 시크릿 수정 후 워크플로 재실행. (브라우저는 localStorage에 저장된 옛 비번이 실패하면 자동으로 다시 물어봄)
- 데이터 기준: 최근 1년(2025-07~), main 브랜치(없으면 master), origin 기준, 병합 커밋 제외.
