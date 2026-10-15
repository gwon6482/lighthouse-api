// 진로백과 '채용' 탭 — 여러 채용 출처를 한 모양으로 합친다.
//
// 출처 추가(사람인·잡코리아 등): providers/<id>.js 를 만들고 아래 PROVIDERS 에 넣으면 끝이다.
//   출처 모듈 약속: { id, name, enabled(): boolean, search(job, { limit, signal }) → { total, moreUrl, postings } }
//   선택: searchOpenings(job, { limit, signal }) → { total, scope, openings } — 기업 공개채용(공채). 없는 출처는 안 만들면 된다
//   - 직업 연결은 출처마다 다르다(고용24 = KECO, 사람인·잡코리아 = 각자의 직종코드) → 출처 안에서 한다
//   - 공고는 아래 Posting 모양으로 돌려준다. 앱은 이 모양만 안다
//   - IP 등록이 필요한 출처(잡코리아)는 고정 출구 lighthouse-egress(54.117.34.116)를 거쳐 호출할 것
// 한 출처가 실패·지연돼도 나머지는 보여준다(출처별 타임아웃). 결과는 직업별로 잠시 캐시한다.
//
// 공고 상세는 우리가 보여주지 않는다 — 원문(url)으로 보낸다. 저장·재가공을 최소화하고 출처를 표시한다.

/**
 * @typedef {Object} Posting
 * @property {string} id            '<source>:<원본 공고번호>' — 출처 간에 겹치지 않게
 * @property {string} source        'work24' | 'saramin' | 'jobkorea' …
 * @property {string} sourceName    화면 표시용 출처 이름
 * @property {string} title
 * @property {string} company
 * @property {string} region
 * @property {string} salary        '연봉 3000만원 ~ 5000만원' 처럼 표시용 문자열
 * @property {string} career
 * @property {string} education
 * @property {string} employmentType  정규직·계약직 등(모르면 '')
 * @property {string} [workSchedule]   주5일근무 등
 * @property {string|null} postedAt 'YYYY-MM-DD'
 * @property {{date: string|null, untilFilled: boolean, label: string}} deadline
 * @property {string|null} url       원문(PC)
 * @property {string|null} mobileUrl 원문(모바일)
 */

/**
 * @typedef {Object} Opening  기업 공개채용(공채) — 회사 단위 채용이라 Posting 과 따로 둔다
 * @property {string} id
 * @property {string} source
 * @property {string} sourceName
 * @property {string} company
 * @property {string} companyType       대기업·공기업·공공기관·중견기업·외국계기업 (빈 값 있음)
 * @property {string} title
 * @property {string|null} startDate    'YYYY-MM-DD'
 * @property {string|null} endDate
 * @property {string[]} employmentTypes
 * @property {string|null} logoUrl
 * @property {string|null} url          기업 채용 사이트
 */

const PROVIDERS = [require('./providers/work24')];
const OPENINGS_LIMIT = 5;

const PROVIDER_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 공고는 하루에도 바뀌지만 탭을 열 때마다 외부를 부를 필요는 없다
const CACHE_MAX = 800;                      // 직업 537 × 여유. 넘으면 오래된 것부터 버린다
const cache = new Map();

async function withTimeout(fn) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {{ jobCode: string, title: string, work24?: object }} job
 * @returns {Promise<{ postings: Posting[], sources: object[], openings: object[], cached: boolean }>}
 */
async function getRecruitment(job, { limit = 10 } = {}) {
  const key = `${job.jobCode}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const active = PROVIDERS.filter((p) => p.enabled());
  const [settled, openSettled] = await Promise.all([
    Promise.allSettled(active.map((p) => withTimeout((signal) => p.search(job, { limit, signal })))),
    Promise.allSettled(active.filter((p) => p.searchOpenings).map((p) =>
      withTimeout((signal) => p.searchOpenings(job, { limit: OPENINGS_LIMIT, signal })).then((r) => ({ ...r, p })))),
  ]);

  const sources = [];
  let postings = [];
  settled.forEach((r, i) => {
    const p = active[i];
    if (r.status === 'fulfilled') {
      sources.push({ id: p.id, name: p.name, ok: true, total: r.value.total, count: r.value.postings.length, moreUrl: r.value.moreUrl, skipped: r.value.skipped ?? null });
      postings.push(...r.value.postings);
    } else {
      const msg = r.reason?.name === 'AbortError' ? '응답 지연' : String(r.reason?.message ?? r.reason).slice(0, 120);
      sources.push({ id: p.id, name: p.name, ok: false, error: msg });
      console.warn(`[recruit] ${p.id} 실패 job=${job.jobCode}: ${msg}`);
    }
  });

  // 여러 출처에 같은 공고가 올라오는 일이 흔하다 — 회사+제목이 같으면 하나만
  const seen = new Set();
  postings = postings.filter((x) => {
    const k = `${x.company}|${x.title}`.replace(/\s+/g, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  postings.sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')));

  // 공채는 출처별로 따로 보여준다(범위 scope 가 출처마다 다를 수 있다). 실패한 출처는 조용히 뺀다 — 일반 공고가 본론이다
  const openings = openSettled
    .filter((r) => r.status === 'fulfilled' && r.value.openings.length)
    .map(({ value: { p, total, scope, openings: items } }) => ({ source: p.id, sourceName: p.name, total, scope, items }));
  openSettled.filter((r) => r.status === 'rejected').forEach((r) => console.warn(`[recruit] 공채 실패 job=${job.jobCode}: ${String(r.reason?.message ?? r.reason).slice(0, 120)}`));

  const value = { postings: postings.slice(0, limit), sources, openings };

  // 하나라도 성공했을 때만 캐시 — 전부 실패를 6시간 붙들고 있지 않게
  if (sources.some((s) => s.ok)) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
  }
  return { ...value, cached: false };
}

module.exports = { getRecruitment, PROVIDERS };
