// 고용24 직업정보 API 래퍼 — 목록 / 상세(7섹션).
//
// 상세는 `dtlGb` 가 필수라 **직업 1건당 7번 호출**해야 전부 모인다.
// 492직업 × 7 = 3,444 호출. 초당 ~2.5회로 약 26분(2026-09-26 실측 기준).
const { call, asArray } = require('./client');

const EP_LIST   = 'callOpenApiSvcInfo212L01.do';
const EP_DETAIL = 'callOpenApiSvcInfo212D01.do';

// dtlGb → 응답 루트 태그. 섹션마다 루트가 다르다.
const DETAIL_SECTIONS = {
  1: { key: 'summary',    root: 'jobSum'      },  // 요약
  2: { key: 'duties',     root: 'jobsDo'      },  // 하는 일
  3: { key: 'education',  root: 'way'         },  // 교육/자격/훈련
  4: { key: 'prospect',   root: 'salProspect' },  // 임금/직업만족도/전망
  5: { key: 'ability',    root: 'ablKnwEnv'   },  // 능력/지식/환경
  6: { key: 'character',  root: 'chrIntrVals' },  // 성격/흥미/가치관
  7: { key: 'activity',   root: 'jobActv'     },  // 업무활동
};

/**
 * 직업 목록 전량.
 * ⚠️ 이 API 에는 **페이지네이션 파라미터가 없다**(startPage/display 는 직업사전 전용).
 *    한 번에 전량이 온다. 2026-09-26 기준 492건.
 */
async function fetchJobList() {
  const parsed = await call(EP_LIST, { target: 'JOBCD' }, 'jobsList');
  const root = parsed.jobsList || {};
  const list = asArray(root.jobList).map((j) => ({
    jobCd: String(j.jobCd ?? '').trim(),      // 예: K000000933
    jobNm: String(j.jobNm ?? '').trim(),
    jobClcd: String(j.jobClcd ?? '').trim(),  // 3자리 분류코드
    jobClcdNM: String(j.jobClcdNM ?? '').trim(),
  }));
  return { total: Number(root.total ?? list.length), list };
}

/** 상세 한 섹션. */
async function fetchJobDetailSection(jobCd, dtlGb) {
  const sec = DETAIL_SECTIONS[dtlGb];
  if (!sec) throw new Error(`알 수 없는 dtlGb: ${dtlGb}`);
  const parsed = await call(
    EP_DETAIL,
    { target: 'JOBDTL', jobGb: '1', jobCd, dtlGb: String(dtlGb) },
    sec.root,
  );
  return parsed[sec.root] ?? {};
}

/**
 * 상세 7섹션 전부. 섹션별 원문을 그대로 담아 돌려준다(변환은 상위 단계에서).
 * ⚠️ 순차 호출이다. 병렬로 돌리면 클라이언트의 속도 억제를 무력화한다.
 */
async function fetchJobDetailAll(jobCd) {
  const out = { jobCd };
  for (const [dtlGb, sec] of Object.entries(DETAIL_SECTIONS)) {
    out[sec.key] = await fetchJobDetailSection(jobCd, Number(dtlGb));
  }
  return out;
}

module.exports = { fetchJobList, fetchJobDetailSection, fetchJobDetailAll, DETAIL_SECTIONS };
