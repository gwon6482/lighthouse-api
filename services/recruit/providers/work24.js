// 채용 출처: 고용24 채용정보 OPEN-API (명세 lighthouse-docs/work24-api/recruit.md)
//
// 직업 연결: 우리 jobCode 를 **그대로 쓰지 않는다** — 모양은 같은 6자리지만 버전이 달라 엉뚱한 직종이 된다
//   (012201 = 우리 '경영지원관리자' / 고용24 채용 '경영기획 부서장').
//   job_info.work24.keco.code(4자리) + '00' 이 채용 직종코드의 상위 코드이고, **상위 코드 하나로 하위 직종까지** 검색된다
//   (간호 304000 = 하위 4개 합 615건, 2026-10-16 실측).
// 키: WORK24_KEY_RECRUIT (서비스마다 키가 다르다 — 직업정보 키로는 '신청하신 OpenApi 서비스가 존재하지 않습니다')
const { XMLParser } = require('fast-xml-parser');

const LIST_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
const OPEN_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do'; // 공채속보
const TREE = require('../../../config/work24OccupationTree.json'); // 세분류 → 중·대분류(scripts/work24-occupation-tree.js)
const SEARCH_PAGE = 'https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do';
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// '26-10-15' → '2026-10-15'
const ymd = (s) => {
  const m = String(s ?? '').match(/(\d{2})-(\d{2})-(\d{2})/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
};

// 고용형태 코드(empTpCd). 목록의 holidayTpNm 은 '주5일근무' 같은 근무형태라 고용형태가 아니다
const EMP_TYPE = { 10: '정규직', 11: '정규직(시간선택제)', 20: '계약직', 21: '계약직(시간선택제)' };

async function fetchXml(url, signal) {
  const xml = await (await fetch(url, { signal })).text();
  // 고용24 는 오류도 HTTP 200 + 본문 <error> 로 준다
  const err = (xml.match(/<error>([^<]*)<\/error>/) || [])[1];
  if (err) throw new Error(`고용24: ${err}`);
  return parser.parse(xml);
}

// '20261029' → '2026-10-29'
const ymd8 = (s) => {
  const m = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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
    const root = (await fetchXml(`${LIST_URL}?${qs}`, signal))?.wantedRoot ?? {};

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
        employmentType: EMP_TYPE[w.empTpCd] ?? '',
        workSchedule: w.holidayTpNm ?? '',
        postedAt: ymd(w.regDt),
        // '채용시까지 26-12-14' 처럼 문구와 날짜가 함께 오기도 한다
        deadline: { date: ymd(close), untilFilled: close.includes('채용시까지'), label: close.replace(/\s+/g, ' ').trim() },
        url: w.wantedInfoUrl ?? null,
        mobileUrl: w.wantedMobileInfoUrl ?? null,
      };
    });
    return { total: Number(root.total ?? postings.length), moreUrl: `${SEARCH_PAGE}?occupation=${occupation}`, postings };
  },

  /**
   * 공채속보 — 대기업·공기업·공공기관·중견·외국계의 공개채용. 전체가 수백 건뿐이라 직업 단위로는 거의 없다.
   * 중분류(024 소프트웨어)로 찾는다 — 직업이 아니라 **분야** 단위라 화면에 scope 이름을 함께 보여줄 것.
   * 537개 직업 중 중분류에 1건 이상 296 (중앙값 1건, 2026-10-16 실측).
   * ⚠️ 대분류로 넓히지 않는다: 한식조리사 → '화학·섬유·식품가공' → 제약사 공채처럼 무관한 공고가 나온다(시험 후 뺐다)
   * @returns {Promise<{ total: number, scope: {code: string, name: string}|null, openings: Opening[] }>}
   */
  async searchOpenings(job, { limit, signal }) {
    const occ = occupationOf(job);
    const mid = occ && TREE.parent[occ];
    if (!mid) return { total: 0, scope: null, openings: [], skipped: '직종코드 연결 없음' };
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST

    const qs = new URLSearchParams({
      authKey: process.env.WORK24_KEY_RECRUIT, callTp: 'L', returnType: 'XML',
      startPage: '1', display: String(Math.max(limit * 2, 20)), jobsCd: mid, sortField: 'regDt', sortOrderBy: 'desc',
    });
    const root = (await fetchXml(`${OPEN_URL}?${qs}`, signal))?.dhsOpenEmpInfoList ?? {};
    const openings = asArray(root.dhsOpenEmpInfo)
      .map((o) => ({
        id: `work24-open:${o.empSeqno}`,
        source: 'work24',
        sourceName: '고용24',
        company: o.empBusiNm ?? '',
        companyType: o.coClcdNm ?? '',
        title: o.empWantedTitle ?? '',
        startDate: ymd8(o.empWantedStdt),
        endDate: ymd8(o.empWantedEndt),
        employmentTypes: String(o.empWantedTypeNm ?? '').split('|').filter(Boolean),
        // 로고는 http 로 온다 — 앱(https)에서 섞인 콘텐츠로 막히므로 https 로(같은 주소에서 응답 확인)
        logoUrl: o.regLogImgNm ? String(o.regLogImgNm).replace(/^http:/, 'https:') : null,
        url: o.empWantedMobileUrl || o.empWantedHomepgDetail || null,
      }))
      .filter((o) => !o.endDate || o.endDate >= today); // 마감 지난 공고가 섞여 오기도 한다
    // 괄호 설명은 화면 이름으로 길다: '수의사(수의사보조원 포함)·약사…' → '수의사·약사…'
    const name = String(TREE.names[mid] ?? '').replace(/\s*\([^)]*\)/g, '');
    return { total: Number(root.total ?? openings.length), scope: { code: mid, name }, openings: openings.slice(0, limit) };
  },
};
