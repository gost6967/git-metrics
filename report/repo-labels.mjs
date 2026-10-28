// harvest.js REPOS 에 없는 조직 레포(실행 때 nd-market 조직에서 자동 발견)의 제품·레이어 표기.
// 확실한 것만 명시하고, 나머지는 이름 접두로 추정, 그래도 모르면 '기타'에 레포 이름을 붙인다.
const EXPLICIT = {
  'bipum':                ['남도마켓', '비품샵'],
  'nd-receipt-audit':     ['남도마켓', '영수증 정산 확인'],
  'market-rn':            ['남도마켓', 'RN 앱'],
  'nd-developer-console': ['남도마켓', '개발자 콘솔'],
  'nd-welfare-rn':        ['복지몰', 'RN 앱'],
  'nd-pengdi-chatbot':    ['펭디(pengdi)', '챗봇'],
  'montemilano':          ['QR랜딩', '몬테밀라노'],
  'market-ai-harness':    ['공통/플랫폼', '개발 하네스'],
  'nd-ai-platform':       ['공통/플랫폼', 'AI 플랫폼'],
  'nd-ml-platform':       ['공통/플랫폼', 'ML 플랫폼'],
  'nd-k8s-manifests':     ['공통/플랫폼', '배포 설정'],
  'nd-design-system':     ['공통/플랫폼', '디자인시스템'],
  'nd-image-kit':         ['공통/플랫폼', '이미지 도구'],
  'appstore-automation':  ['공통/플랫폼', '앱스토어 자동화'],
  'ai-dart':              ['공통/플랫폼', 'AI-DART'],
  'nd-corporation-site':  ['회사 사이트', '웹'],
  'company-introduction-page': ['회사 사이트', '회사 소개'],
};
const PREFIX = [
  [/^fo-/, '패션온(fashionon)'],
  [/^uncle-/, '엉클(uncle)'],
  [/^(nd-welfare-|ndmall)/, '복지몰'],
];

export function labelOf(name) {
  if (EXPLICIT[name]) return EXPLICIT[name];
  for (const [re, product] of PREFIX) if (re.test(name)) return [product, name];
  return ['기타', name];
}
