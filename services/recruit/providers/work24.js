// 채용 출처: 고용24 채용정보 OPEN-API (명세 lighthouse-docs/work24-api/recruit.md)
//
// 직업 연결: 우리 jobCode 를 **그대로 쓰지 않는다** — 모양은 같은 6자리지만 버전이 달라 엉뚱한 직종이 된다
//   (012201 = 우리 '경영지원관리자' / 고용24 채용 '경영기획 부서장').
//   job_info.work24.keco.code(4자리) + '00' 이 채용 직종코드의 상위 코드이고, **상위 코드 하나로 하위 직종까지** 검색된다
//   (간호 304000 = 하위 4개 합 615건, 2026-10-16 실측).
// 키: WORK24_KEY_RECRUIT (서비스마다 키가 다르다 — 직업정보 키로는 '신청하신 OpenApi 서비스가 존재하지 않습니다')
const { XMLParser } = require('fast-xml-parser');

const LIST_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
const SEARCH_PAGE = 'https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do';
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// '26-10-15' → '2026-10-15'
const ymd = (s) => {
  const m = String(s ?? '').match(/(\d{2})-(\d{2})-(\d{2})/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
};

/** 우리 직업 → 고용24 채용 직종코드(상위 코드). 없으면 null(이 출처는 건너뛴다) */
function occupationOf(job) {
  const k = job?.work24?.keco?.code;
  return /^\d{4}$/.test(String(k ?? '')) ? `${k}00` : null;
}

module.exports = {
  id: 'work24',
  name: '고용24',
  enabled: () => !!process.env.WORK24_KEY_RECRUIT,

  /**
   * @returns {Promise<{ total: number, moreUrl: string|null, postings: import('../index').Posting[] }>}
   */
  async search(job, { limit, signal }) {
    const occupation = occupationOf(job);
    if (!occupation) return { total: 0, moreUrl: null, postings: [], skipped: '직종코드 연결 없음' };

    const qs = new URLSearchParams({
      authKey: process.env.WORK24_KEY_RECRUIT, callTp: 'L', returnType: 'XML',
      startPage: '1', display: String(limit), occupation, sortOrderBy: 'DESC',
    });
    const res = await fetch(`${LIST_URL}?${qs}`, { signal });
    const xml = await res.text();
    // 고용24 는 오류도 HTTP 200 + 본문 <error> 로 준다
    const err = (xml.match(/<error>([^<]*)<\/error>/) || [])[1];
    if (err) throw new Error(`고용24: ${err}`);
    const root = parser.parse(xml)?.wantedRoot ?? {};

    const postings = asArray(root.wanted).map((w) => {
      const close = String(w.closeDt ?? '');
      return {
        id: `work24:${w.wantedAuthNo}`,
        source: 'work24',
        sourceName: '고용24',
        title: w.title ?? '',
        company: w.company ?? '',
        region: w.region ?? '',
        salary: [w.salTpNm, w.sal].filter(Boolean).join(' '),
        career: w.career ?? '',
        education: w.minEdubg ?? '',
        employmentType: w.holidayTpNm ?? '',
        postedAt: ymd(w.regDt),
        // '채용시까지 26-12-14' 처럼 문구와 날짜가 함께 오기도 한다
        deadline: { date: ymd(close), untilFilled: close.includes('채용시까지'), label: close.replace(/\s+/g, ' ').trim() },
        url: w.wantedInfoUrl ?? null,
        mobileUrl: w.wantedMobileInfoUrl ?? null,
      };
    });
    return { total: Number(root.total ?? postings.length), moreUrl: `${SEARCH_PAGE}?occupation=${occupation}`, postings };
  },
};
