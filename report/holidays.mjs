// 한국 공휴일 판정. Google 캘린더 '대한민국의 휴일' 공개 ICS를 쓴다 — 대체공휴일·선거일 같은 임시공휴일도 반영되고,
// 기념일(어버이날 등)은 DESCRIPTION이 '기념일'이라 '공휴일'만 골라낸다.
const ICS_URL = 'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';

let cache;

// 반환: Map<'YYYY-MM-DD', 이름>. 받아오지 못하면 null (호출부는 '공휴일 아님'으로 취급해 보고를 거르지 않는다)
export async function loadHolidays() {
  if (cache !== undefined) return cache;
  try {
    const res = await fetch(ICS_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).replace(/\r?\n[ \t]/g, ''); // ICS 줄 접힘 해제
    const map = new Map();
    for (const ev of text.split('BEGIN:VEVENT').slice(1)) {
      const date = ev.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
      const desc = ev.match(/DESCRIPTION:(.*)/)?.[1] ?? '';
      if (!date || !desc.startsWith('공휴일')) continue;
      map.set(`${date[1]}-${date[2]}-${date[3]}`, ev.match(/SUMMARY:(.*)/)?.[1]?.trim() ?? '공휴일');
    }
    cache = map;
  } catch (e) {
    console.warn('공휴일 정보를 받지 못함 → 공휴일 없이 진행:', e.message);
    cache = null;
  }
  return cache;
}
