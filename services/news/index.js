// 진로 뉴스(앱 '진로정보' 탭, 2026-10-29) — 진로엔뉴스 공식 RSS 를 받아 제목·날짜·출처·원문 링크만 내준다.
//
// ⚠️ 저작권: 진로엔뉴스 저작권보호정책 2조 — 승낙 없이 복제·전송·배포 금지.
//    그래서 **썸네일·요약(description)은 내보내지 않는다.** 제목 + 날짜 + 출처 + 원문 링크만(사용자 결정 2026-10-29, 테스트 용도 위주).
//    썸네일·요약을 쓰려면 먼저 승낙(저작권 담당 jinron@kakao.com).
// 앱이 RSS 를 직접 부르면 CORS·속도 문제 → 서버가 받아 메모리에 1시간 캐시한다.
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const SOURCE = { name: '진로엔뉴스', url: 'https://www.jinron.kr', rss: 'https://cdn.jinron.kr/rss/gns_allArticle.xml' };
const CACHE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, cdataPropName: false });

let cache = null; // { at, items }

// 'Thu, 29 Oct 2026 11:30:00 +0900' → ISO. 못 읽으면 ''
function toIso(s) {
  const t = Date.parse(s ?? '');
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}
// RSS 제목의 엔티티·줄바꿈 정리(본문은 다루지 않는다)
function cleanTitle(s) {
  return String(s ?? '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml) {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((it) => ({
      title: cleanTitle(it.title),
      url: String(it.link ?? it.guid ?? '').trim(),
      publishedAt: toIso(it.pubDate),
      source: SOURCE.name,
    }))
    // 원문 링크가 진로엔뉴스 기사일 때만(엉뚱한 주소로 보내지 않게)
    .filter((n) => n.title && /^https:\/\/www\.jinron\.kr\/news\/articleView\.html\?idxno=\d+$/.test(n.url));
}

/**
 * @param {{ limit?: number }} opts
 * @returns {Promise<{ items: {title:string,url:string,publishedAt:string,source:string}[], source: {name:string,url:string}, cached: boolean }>}
 */
async function getCareerNews({ limit = 10 } = {}) {
  const n = Math.max(1, Math.min(30, Number(limit) || 10));
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { items: cache.items.slice(0, n), source: { name: SOURCE.name, url: SOURCE.url }, cached: true };
  }
  try {
    const res = await axios.get(SOURCE.rss, { timeout: TIMEOUT_MS, responseType: 'text', headers: { 'User-Agent': 'LighthouseBot/1.0 (+https://www.lighthouse.career)' } });
    const items = parseRss(res.data);
    cache = { at: Date.now(), items };
    return { items: items.slice(0, n), source: { name: SOURCE.name, url: SOURCE.url }, cached: false };
  } catch (err) {
    console.warn(`[news] 진로엔뉴스 RSS 실패: ${String(err?.message ?? err).slice(0, 120)}`);
    // 실패하면 지난 캐시라도(오래됐어도) — 없으면 빈 목록. 화면은 '불러오지 못했어요'
    return { items: cache ? cache.items.slice(0, n) : [], source: { name: SOURCE.name, url: SOURCE.url }, cached: !!cache };
  }
}

module.exports = { getCareerNews, parseRss };
