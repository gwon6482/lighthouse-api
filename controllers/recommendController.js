const mongoose = require('mongoose');
const SurveyResult = require('../models/SurveyResult');
const { T1_PS_MAP, T21_AB_MAP, T21_A_MAP, T22_HOLLAND_MAP, T23_VA_MAP, T23_WEIGHTS } = require('../config/matchingMaps');

// ─── 시작 시 캐시 ────────────────────────────────────────────────────────────

let _t3PartsCache = null;  // { T3_PHY: { up: [...], down: [...] }, ... }

async function getT3Parts() {
  if (_t3PartsCache) return _t3PartsCache;
  const db = mongoose.connection.useDb('survey_questions');
  const docs = await db.collection('T3_environmental')
    .find({}, { projection: { part_code: 1, related_WE: 1, _id: 0 } })
    .toArray();
  _t3PartsCache = Object.fromEntries(docs.map(d => [d.part_code, d.related_WE]));
  return _t3PartsCache;
}

function getJobModel() {
  const jobDb = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data');
  if (jobDb.models['JobData']) return jobDb.models['JobData'];
  const schema = new mongoose.Schema({}, { strict: false });
  return jobDb.model('JobData', schema, 'job_info');
}

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

// 🚨 **2026-10-05 수정.** 여기 있던 `{ A:1.0, B:0.75, C:0.5, D:0.25, E:0.0 }` 는
//    **뒤집혀 있었다.** UI 는 A=매우 아니다 / E=매우 그렇다 이고
//    통계·보고서(`normalizeScore`)는 A:0 … E:1 로 맞게 쓰고 있었는데, 추천만 반대였다.
//    같은 답변이 보고서와 추천에서 **반대 점수**가 되던 것이다.
//    → 정본을 `config/answerScale.js` 하나로 합쳤다. 다시 복사해 쓰지 말 것.
const { ANSWER_SCORE_5: ANSWER_SCORE } = require('../config/answerScale');

// details.중요도.직업간 배열 → { code: 0~1 } 맵
//
// 🔑 **그 직업 안에서의 순위로 0~1 을 다시 매긴다(2026-09-28).** 원본 값은 건드리지 않는다.
//
// 왜 필요한가 — **척도 불일치**:
//   매칭은 전부 `1 - |u - j|` 인데
//     u = 사용자의 **절대적 자기평가**(0~1)
//     j = `직업간` = **다른 직업 대비 백분위**  ← 상대값
//   단위가 다른 두 값을 빼고 있었다. 전 항목 백분위가 낮은 직업(경비원·청소원·검표원 등)은
//   j 가 모든 축에서 0 근처에 고정돼 **어떤 사용자와도 거리가 벌어진다.**
//   점수가 "당신에게 맞는 정도"가 아니라 **"이 직업이 얼마나 평균적인가"**를 재게 된다.
//
// 순위로 바꾸면 직업의 **전반적 높낮이**가 사라지고 **프로파일 모양**만 남는다.
// "이 직업이 다른 직업보다 뭘 더 요구하나"가 아니라 "이 직업 안에서 뭐가 더 중요한가"를 본다.
//
// 실측 근거 — **도달가능성**(무작위 사용자 프로파일 1200개를 훑어
//             "이 직업을 TOP-N 에 올리는 u 가 하나라도 있는가"를 판정):
//   현행  TOP5 221/537  TOP30 389/537   ← **148개 직업이 어떤 응답으로도 TOP30 에 못 든다**
//   순위  TOP5 524/537  TOP30 536/537
//   변별력은 그대로다(한 사용자에 대한 점수 sd 0.0453 → 0.0426). 과교정이 아니다.
//
// ⚠️ 검사 응답 표본으로 검증하지 말 것. `survey_data.survey_results` 88건은 **전부 더미**다
//    (respondent_id 가 users 에 0건, seed_test_responses.js). 실사용자 응답은 아직 없다.
//    위 수치는 **채점 함수 + 직업 데이터만으로** 나온 것이라 표본과 무관하게 성립한다.
//
// ℹ️ 2026-10-05 부터 `recommend-t2` 도 이 함수를 쓴다(전에는 `top5codes` 로 상위 5개만 봤다).
//    두 추천 경로가 같은 척도를 쓰게 됐다 — 한쪽만 고치면 다시 갈라진다.
// 분석 도구가 **전환 전 동작(직업간 백분위 그대로)** 과 비교할 수 있도록 끄는 스위치.
// 운영 경로에서는 절대 끄지 않는다 — `__test__.setRankNormalize` 로만 접근한다.
let RANK_NORMALIZE = true;

function buildScoreMap(items) {
  const arr = items || [];
  const map = {};
  if (arr.length === 0) return map;

  if (!RANK_NORMALIZE) {                          // 비교군: 원래의 직업간 백분위
    for (const { code, score } of arr) map[code] = score / 100;
    return map;
  }
  // 항목이 하나뿐이면 순위를 매길 수 없다 → 중립(0.5)
  if (arr.length === 1) { map[arr[0].code] = 0.5; return map; }

  // 동점은 **같은 순위**를 받아야 한다. 단순 인덱스를 쓰면 배열 순서가 점수를 가른다.
  const sorted = [...arr].sort((a, b) => a.score - b.score);
  let i = 0;
  while (i < sorted.length) {
    let k = i;
    while (k + 1 < sorted.length && sorted[k + 1].score === sorted[i].score) k++;
    const rank = (i + k) / 2;                      // 동점 구간의 평균 순위
    const v = rank / (sorted.length - 1);          // 0~1
    for (let x = i; x <= k; x++) map[sorted[x].code] = v;
    i = k + 1;
  }
  return map;
}

// A/B/C/D/E 개별 답변 → 그룹 평균 점수
// T1_E2 → group 'E', T21_M4 → group 'M'
function calcGroupScores(answers) {
  const groups = {};
  for (const [qId, ans] of Object.entries(answers || {})) {
    const g = qId.split('_')[1][0];
    if (!groups[g]) groups[g] = [];
    groups[g].push(ANSWER_SCORE[ans] ?? 0.5);
  }
  const result = {};
  for (const [g, scores] of Object.entries(groups)) {
    result[g] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  return result;
}

// 매핑 목록에 대해 직업 scoreMap으로 가중 평균 계산
// 음수 가중치(PS11, R그룹)는 역방향으로 처리: (1 - score) * |w|
// ⚠️ **`scoreMap[code] ?? 0` 이 "데이터 없음"과 "실제 0점"을 구분하지 않는다.**
//
//    2026-09-27 전까지 job_info.details 는 **상위 5개만** 있었다(크롤링 한계).
//    그래서 아래가 참조하는 코드 대부분이 맵에 없어 `raw = 0` 이 됐고,
//    거의 모든 직업의 j 가 0 에 수렴했다 → `1 - |u - j|` 가 **설계대로 동작하지 않았다**
//    (점수를 낮게 답할수록 매칭이 높아지고, 변별력은 "우연히 상위 5개에 든 코드"로만 결정).
//    고용24 전량 적재(632항목)로 정상화됐다. 실측: 맵 코드 수 5개 → 44개.
//
// ⚠️ `dataSource: 'crawled'` 인 직업은 details 가 적어(카테고리당 5개) 구조적으로 불리하다.
//    없는 코드가 `?? 0` 으로 최저점을 먹기 때문이다.
//
//    해당 1건 = **경기심판 및 경기기록원(420301)**. 고용24 목록에 대응 직업이 없어
//    매핑을 못 만든 유일한 직업이다(`services/work24/jobMapping.json`).
//
//    ✅ **2026-10-05: 손대지 않기로 결정했다(사용자 판단).**
//       도달가능성 실측(무작위 프로파일 400개) 결과 **최고 37위** —
//       TOP30 에는 못 들지만 TOP100 에는 든다. 추천에서 사실상 안 보이는 셈인데,
//       그래도 괜찮다고 판단했다. 직업 1건이고 진로백과 검색으로는 정상 노출된다.
//
//    ⚠️ **이걸 '미도달 1건' 이라고 다시 결함으로 보고하지 말 것.** 알고서 남긴 것이다.
//       `scripts/recommend-reachability.js` 가 매번 이 1건을 집어낸다 — **정상 출력이다.**
//       크롤링본이 늘어나면(= 매핑 없는 직업이 생기면) 그때 재검토한다.
function weightedJobScore(mappings, scoreMap) {
  let totalW = 0;
  let totalScore = 0;
  for (const { code, w } of mappings) {
    const absW = Math.abs(w);
    totalW += absW;
    const raw = scoreMap[code] ?? 0;
    totalScore += w < 0 ? (1 - raw) * absW : raw * absW;
  }
  return totalW > 0 ? totalScore / totalW : 0;
}

function round3(n) { return Math.round(n * 1000) / 1000; }

// ─── 파트별 매칭 함수 ────────────────────────────────────────────────────────

// T1 성격 매칭 (20%)
// 사용자 그룹 점수(0~1) vs 직업 PS 가중 점수(0~1) → 1 - |차이| 평균
function calcT1Match(userT1, jobPS) {
  if (!userT1 || Object.keys(userT1).length === 0) return 0.5;
  const groups = Object.keys(T1_PS_MAP);
  let sum = 0;
  for (const g of groups) {
    const u = userT1[g] ?? 0.5;
    const j = weightedJobScore(T1_PS_MAP[g], jobPS);
    sum += 1 - Math.abs(u - j);
  }
  return sum / groups.length;
}

// T21 재능 매칭 (25%)
// AB(업무수행능력)와 A(업무활동) 점수 50:50 결합
function calcT21Match(userT21, jobAB, jobA) {
  if (!userT21 || Object.keys(userT21).length === 0) return 0.5;
  const groups = Object.keys(T21_AB_MAP);
  let sum = 0;
  for (const g of groups) {
    const u = userT21[g] ?? 0.5;
    const jAB = weightedJobScore(T21_AB_MAP[g], jobAB);
    const jA = weightedJobScore(T21_A_MAP[g], jobA);
    const j = (jAB + jA) / 2;
    sum += 1 - Math.abs(u - j);
  }
  return sum / groups.length;
}

// T22 흥미 매칭 (25%)
// 체크 항목 → 대분류별 카운트 → Holland 점수 → 직업 Holland와 비교
function calcT22Match(userT22, jobHolland) {
  const checked = userT22?.checked || [];
  if (checked.length === 0) return 0.5;

  // 대분류별 체크 수 (T22_SOC_1 → SOC, SOC_1 → SOC 둘 다 처리)
  const catCounts = {};
  for (const itemId of checked) {
    const parts = itemId.split('_');
    const cat = parts[0] === 'T22' ? parts[1] : parts[0];
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  // user Holland 점수: 카운트 × 가중치 합산 후 정규화
  const hollandTypes = ['R', 'I', 'A', 'S', 'E', 'C'];
  const userHolland = Object.fromEntries(hollandTypes.map(h => [h, 0]));

  for (const [cat, count] of Object.entries(catCounts)) {
    for (const { code, w } of (T22_HOLLAND_MAP[cat] || [])) {
      userHolland[code] += count * w;
    }
  }

  // 0~1 정규화: 최대값 = 전체 체크 수 × 최대 가중치(1.5)
  const maxPossible = checked.length * 1.5;
  for (const h of hollandTypes) {
    userHolland[h] = Math.min(1, userHolland[h] / maxPossible);
  }

  let sum = 0;
  for (const h of hollandTypes) {
    sum += 1 - Math.abs(userHolland[h] - (jobHolland[h] ?? 0));
  }
  return sum / hollandTypes.length;
}

// T23 가치관 매칭 (20%)
// 우선순위 3개만 활용, 각 VA 직업 점수에 가중치 적용
function calcT23Match(userT23, jobVA) {
  if (!userT23?.priority_1) return 0.5;

  let totalScore = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(T23_WEIGHTS)) {
    const t23Key = userT23[key];
    if (!t23Key) continue;
    const vaCode = T23_VA_MAP[t23Key];
    if (!vaCode) continue;
    totalScore += (jobVA[vaCode] ?? 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalScore / totalWeight : 0.5;
}

// T3 업무환경 매칭 (10%)
// 파트별로 직업 WE 가중 평균 → 직업 강도 레벨(0~1) 산출 → 사용자 레벨과 비교
function calcT3Match(userT3, jobWE, t3Parts) {
  if (!userT3 || Object.keys(userT3).length === 0) return 0.5;
  const partCodes = ['T3_PHY', 'T3_PEO', 'T3_COM', 'T3_RES', 'T3_STR', 'T3_FLX'];

  let sum = 0;
  let count = 0;
  for (const partCode of partCodes) {
    const userLevel = userT3[partCode];
    if (userLevel == null) continue;

    const partDef = t3Parts[partCode];
    if (!partDef) continue;

    const { up, down } = partDef;
    const upTotalW = up.reduce((s, x) => s + x.weight, 0);
    const downTotalW = down.reduce((s, x) => s + x.weight, 0);

    const upScore = upTotalW > 0
      ? up.reduce((s, x) => s + (jobWE[x.code] ?? 0) * x.weight, 0) / upTotalW
      : null;
    const downScore = downTotalW > 0
      ? down.reduce((s, x) => s + (jobWE[x.code] ?? 0) * x.weight, 0) / downTotalW
      : null;

    // 직업 파트 레벨 (0~1): up 높음 + down 낮음 → 높은 강도
    let jobLevel;
    if (upScore !== null && downScore !== null) {
      jobLevel = (upScore + (1 - downScore)) / 2;
    } else if (upScore !== null) {
      jobLevel = upScore;
    } else {
      jobLevel = 1 - downScore;
    }

    const userLevelNorm = (userLevel - 1) / 4;  // 1~5 → 0~1
    sum += 1 - Math.abs(userLevelNorm - jobLevel);
    count++;
  }
  return count > 0 ? sum / count : 0.5;
}

// ─── 종합 매칭 ───────────────────────────────────────────────────────────────

function calcTotalMatch(userSurvey, job, t3Parts) {
  const d = job.details || {};
  const jobPS      = buildScoreMap(d['성격']?.['중요도']?.['직업간']);
  const jobHolland = buildScoreMap(d['흥미']?.['중요도']?.['직업간']);
  const jobVA      = buildScoreMap(d['가치관']?.['중요도']?.['직업간']);
  const jobAB      = buildScoreMap(d['업무수행능력']?.['중요도']?.['직업간']);
  const jobA       = buildScoreMap(d['업무활동']?.['중요도']?.['직업간']);
  const jobWE      = buildScoreMap(d['업무환경']?.['중요도']?.['직업간']);

  const t1  = calcT1Match(userSurvey.T1,   jobPS);
  const t21 = calcT21Match(userSurvey.T21, jobAB, jobA);
  const t22 = calcT22Match(userSurvey.T22, jobHolland);
  const t23 = calcT23Match(userSurvey.T23, jobVA);
  const t3  = calcT3Match(userSurvey.T3,   jobWE, t3Parts);

  const total = t1 * 0.20 + t21 * 0.25 + t22 * 0.25 + t23 * 0.20 + t3 * 0.10;

  return {
    total: round3(total),
    // ⚠️ **정렬은 `totalExact` 로 한다.** `round3` 로 자르고 정렬하면
    //    537개가 ~173개 점수 버킷에 몰려 **동점이 배열 순서(= MongoDB 문서 순서)로 갈린다.**
    //    문서 순서는 안정적이라 **늘 같은 직업이 이긴다.**
    //    실측(프로파일 200개): 5·6위 경계 동점이 **27%** 에서 발생, 평균 4.5개가 자리를 다퉜다.
    //    원점수로 정렬하면 고유 점수가 173개 → **463개** 로 늘어난다.
    //    응답에는 `total`(3자리)을 쓴다 — 0.7369999999 를 내보내지 않기 위해서다.
    totalExact: total,
    detail: {
      T1:  round3(t1),
      T21: round3(t21),
      T22: round3(t22),
      T23: round3(t23),
      T3:  round3(t3),
    },
  };
}

// survey_result 도큐먼트 → 매칭용 userSurvey 변환
function buildUserSurvey(surveyResult) {
  return {
    // T1_result.group_scores 우선, 없으면 answers.T1 에서 계산
    T1:  surveyResult.T1_result?.group_scores ?? calcGroupScores(surveyResult.answers?.T1),
    T21: calcGroupScores(surveyResult.answers?.T21),
    T22: surveyResult.answers?.T22 ?? { checked: [] },
    T23: surveyResult.answers?.T23 ?? {},
    T3:  surveyResult.answers?.T3  ?? {},
  };
}

// 매칭 실행 (공통 로직)
async function runRecommend(userSurvey, { limit = 10, primary = null, minScore = 0 } = {}) {
  const [t3Parts, Job] = await Promise.all([getT3Parts(), Promise.resolve(getJobModel())]);

  const filter = {};
  if (primary) filter['classification.primary'] = primary;

  const jobs = await Job.find(filter, {
    jobCode: 1, title: 1, classification: 1, salary: 1, jobSatisfaction: 1,
    // 공유 그룹 접기용. `work24.jobCd` 가 그룹의 정체성이다(같은 jobCd = 고용24가 한 직업으로 조사).
    dataSource: 1, 'work24.jobCd': 1, 'work24.jobNm': 1,
    'details.성격.중요도.직업간':       1,
    'details.흥미.중요도.직업간':       1,
    'details.가치관.중요도.직업간':     1,
    'details.업무수행능력.중요도.직업간': 1,
    'details.업무활동.중요도.직업간':   1,
    'details.업무환경.중요도.직업간':   1,
    _id: 0,
  }).lean();

  const results = [];
  for (const job of jobs) {
    const { total, totalExact, detail } = calcTotalMatch(userSurvey, job, t3Parts);
    if (total < minScore) continue;
    results.push({
      jobCode: job.jobCode,
      title: job.title,
      classification: job.classification,
      match_score: total,
      match_detail: detail,
      salary: job.salary ?? null,
      jobSatisfaction: job.jobSatisfaction ?? null,
      _exact: totalExact,          // 정렬 전용. 응답 직전에 제거한다
      _groupKey: job.dataSource === 'work24-shared' ? (job.work24?.jobCd ?? null) : null,
      _groupName: job.work24?.jobNm ?? null,
    });
  }

  // ⚠️ `match_score`(3자리) 가 아니라 **원점수**로 정렬한다. 위 calcTotalMatch 주석 참조.
  // 그래도 남는 동점은 **공유 그룹**이다(전문의 13종처럼 details 가 실제로 동일한 경우).
  // 그때는 직업코드로 끊어 **순서를 결정적으로** 만든다 — 문서 순서에 맡기지 않는다.
  results.sort((a, b) => (b._exact - a._exact) || a.jobCode.localeCompare(b.jobCode));

  const collapsed = collapseSharedGroups(results);
  for (const r of collapsed) { delete r._exact; delete r._groupKey; delete r._groupName; }

  return {
    total_jobs: jobs.length,
    data: collapsed.slice(0, Math.min(limit, 30)),
  };
}

// 고용24가 한 직업으로 묶어 조사한 그룹을 **추천 목록에서 한 자리로 접는다.**
//
// 왜: 그룹 구성원은 `details`·임금·만족도가 **전부 동일**해서(29개 그룹 전수 확인)
//     점수가 완전히 같다. 접지 않으면 전문의 13종이 TOP5 다섯 자리를 독식하고,
//     동점을 코드순으로 끊으면 **코드가 낮은 5개만 영원히 노출**된다
//     (피부과·가정의학과 등 8개는 어떤 사용자에게도 안 나온다).
//     데이터가 구분하지 못하는 것을 구분되는 척 보여주지 않는 쪽이 정직하다.
//
// 결과 항목: `title` 은 **그룹 대표명**(예: '전문의사'), `members` 에 세부 직업이 담긴다.
//           `jobCode` 는 대표(점수 정렬 후 첫) 구성원 — 상세 페이지 링크가 그대로 동작한다.
//           그 상세 페이지에는 "이 정보는 전문의사 기준" 배너가 이미 붙는다.
//
// ⚠️ 이미 점수순으로 정렬된 배열을 받는다는 전제다. 첫 등장 순서를 그대로 유지한다.
function collapseSharedGroups(sorted) {
  const out = [];
  const seen = new Map();          // groupKey → out 배열에서의 항목
  for (const r of sorted) {
    if (!r._groupKey) { out.push(r); continue; }
    const hit = seen.get(r._groupKey);
    if (!hit) {
      const entry = {
        ...r,
        title: r._groupName || r.title,
        members: [{ jobCode: r.jobCode, title: r.title }],
      };
      seen.set(r._groupKey, entry);
      out.push(entry);
      continue;
    }
    hit.members.push({ jobCode: r.jobCode, title: r.title });
  }
  return out;
}

// ─── API 핸들러 ──────────────────────────────────────────────────────────────

// GET /api/job/recommend/:survey_id
const getJobRecommendBySurveyId = async (req, res, next) => {
  try {
    const { survey_id } = req.params;
    const limit    = Math.min(parseInt(req.query.limit) || 10, 30);
    const primary  = req.query.primary || null;
    const minScore = parseFloat(req.query.min_score) || 0;

    const surveyResult = await SurveyResult.findOne({ survey_id }).lean();
    if (!surveyResult) {
      return res.status(404).json({
        success: false,
        error: `survey_id '${survey_id}'에 해당하는 검사 결과를 찾을 수 없습니다.`,
      });
    }

    const userSurvey = buildUserSurvey(surveyResult);
    const { total_jobs, data } = await runRecommend(userSurvey, { limit, primary, minScore });

    res.json({ success: true, survey_id, total_jobs, data });
  } catch (error) {
    next(error);
  }
};

// POST /api/job/recommend
// T1/T21은 그룹 점수(0~1)를 body에 직접 전달 (테스트/프리뷰용)
const postJobRecommend = async (req, res, next) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 10, 30);
    const primary  = req.query.primary || null;
    const minScore = parseFloat(req.query.min_score) || 0;

    const { T1, T21, T22, T23, T3 } = req.body || {};
    if (!T1 && !T21 && !T22 && !T23 && !T3) {
      return res.status(400).json({ success: false, error: '요청 body에 검사 결과가 없습니다.' });
    }

    const userSurvey = {
      T1:  T1  ?? {},
      T21: T21 ?? {},
      T22: T22 ?? { checked: [] },
      T23: T23 ?? {},
      T3:  T3  ?? {},
    };

    const { total_jobs, data } = await runRecommend(userSurvey, { limit, primary, minScore });

    res.json({ success: true, total_jobs, data });
  } catch (error) {
    next(error);
  }
};

// ─── 단일 직업 매칭 점수 ─────────────────────────────────────────────────────

const JOB_DETAIL_PROJECTION = {
  jobCode: 1, title: 1, classification: 1, salary: 1, jobSatisfaction: 1,
  'details.성격.중요도.직업간':        1,
  'details.흥미.중요도.직업간':        1,
  'details.가치관.중요도.직업간':      1,
  'details.업무수행능력.중요도.직업간': 1,
  'details.업무활동.중요도.직업간':    1,
  'details.업무환경.중요도.직업간':    1,
  _id: 0,
};

async function calcJobMatch(jobCode, userSurvey) {
  const [t3Parts, Job] = await Promise.all([getT3Parts(), Promise.resolve(getJobModel())]);
  const job = await Job.findOne({ jobCode }, JOB_DETAIL_PROJECTION).lean();
  if (!job) return null;
  const { total, detail } = calcTotalMatch(userSurvey, job, t3Parts);
  return { job, total, detail };
}

// GET /api/job/:jobCode/match?survey_id=xxx
const getJobMatchScore = async (req, res, next) => {
  try {
    const { jobCode } = req.params;
    const { survey_id } = req.query;

    if (!survey_id) {
      return res.status(400).json({ success: false, error: 'survey_id 쿼리 파라미터가 필요합니다.' });
    }

    const surveyResult = await SurveyResult.findOne({ survey_id }).lean();
    if (!surveyResult) {
      return res.status(404).json({ success: false, error: `survey_id '${survey_id}'에 해당하는 검사 결과를 찾을 수 없습니다.` });
    }

    const userSurvey = buildUserSurvey(surveyResult);
    const result = await calcJobMatch(jobCode, userSurvey);
    if (!result) {
      return res.status(404).json({ success: false, error: `jobCode '${jobCode}'에 해당하는 직업을 찾을 수 없습니다.` });
    }

    res.json({
      success: true,
      jobCode: result.job.jobCode,
      title: result.job.title,
      classification: result.job.classification,
      survey_id,
      match_score: result.total,
      match_detail: result.detail,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/job/:jobCode/match  (점수 직접 전달, 프리뷰용)
const postJobMatchScore = async (req, res, next) => {
  try {
    const { jobCode } = req.params;
    const { T1, T21, T22, T23, T3 } = req.body || {};

    if (!T1 && !T21 && !T22 && !T23 && !T3) {
      return res.status(400).json({ success: false, error: '요청 body에 검사 결과가 없습니다.' });
    }

    const userSurvey = {
      T1:  T1  ?? {},
      T21: T21 ?? {},
      T22: T22 ?? { checked: [] },
      T23: T23 ?? {},
      T3:  T3  ?? {},
    };

    const result = await calcJobMatch(jobCode, userSurvey);
    if (!result) {
      return res.status(404).json({ success: false, error: `jobCode '${jobCode}'에 해당하는 직업을 찾을 수 없습니다.` });
    }

    res.json({
      success: true,
      jobCode: result.job.jobCode,
      title: result.job.title,
      classification: result.job.classification,
      match_score: result.total,
      match_detail: result.detail,
    });
  } catch (error) {
    next(error);
  }
};

// ─── T2 전용 매핑 ────────────────────────────────────────────────────────────

const AB_TO_T21 = {
  AB34: 'L', AB35: 'L', AB09: 'L', AB14: 'L',
  AB04: 'M', AB08: 'M', AB07: 'M', AB13: 'M',
  AB05: 'S',
  AB41: 'A',
  AB43: 'B', AB44: 'B', AB38: 'B', AB37: 'B',
  AB26: 'I', AB20: 'I', AB23: 'I', AB28: 'I',
  AB06: 'N', AB15: 'N',
  AB10: 'T', AB01: 'T', AB32: 'T',
};

const A_TO_T21 = {
  A09: 'L', A10: 'L', A16: 'L', A25: 'L',
  A05: 'M', A17: 'M', A07: 'M', A34: 'M',
  A03: 'S', A29: 'S',
  A32: 'B', A40: 'B', A41: 'B', A36: 'B',
  A19: 'I', A21: 'I', A22: 'I', A15: 'I',
  A06: 'N', A12: 'N', A26: 'N',
  A04: 'T', A11: 'T', A24: 'T',
};

const T22_TO_KN = {
  BUS_1: 'KN14', BUS_2: 'KN10', BUS_3: 'KN08',
  BUS_4: 'KN12', BUS_5: 'KN07', BUS_6: 'KN13',
  COM_1: 'KN04', COM_2: 'KN15', COM_3: 'KN03',
  EDU_1: 'KN18', EDU_2: 'KN23',
  SAF_1: 'KN11',
  SCI_1: 'KN02', SCI_2: 'KN31', SCI_3: 'KN29',
  SCI_4: 'KN33', SCI_5: 'KN16', SCI_6: 'KN30',
  SOC_1: 'KN24', SOC_2: 'KN22', SOC_3: 'KN27',
  SOC_4: 'KN19', SOC_5: 'KN26', SOC_6: 'KN21', SOC_7: 'KN25',
  TEC_1: 'KN09', TEC_2: 'KN01', TEC_3: 'KN32',
  TEC_4: 'KN28', TEC_5: 'KN20', TEC_6: 'KN05',
  TEC_7: 'KN17', TEC_8: 'KN06',
};

// ─── recommend-t2 점수 함수 ────────────────────────────────────────────────
//
// ⚠️ **메인 5축과 다른 알고리즘이다.** 거리(`1 - |u - j|`)가 아니라 **곱**이다
//    ("이 직업이 내가 잘하는/중시하는 것을 얼마나 요구하나").
//
// 🔑 **2026-10-05: 세 축 모두 `buildScoreMap`(직업내 순위정규화)으로 전량을 쓴다.**
//    전에는 `top5codes` 로 **상위 5개만** 봤는데, 공식 API 전환으로 전량이 적재된 뒤에는
//    버리는 양이 너무 컸다 — 업무수행능력 44개 중 5개 / 업무활동 41 중 5 / 지식 33 중 5.
//    특히 `T22_TO_KN` 은 **KN 33개 전체**를 가리키는데 조회는 상위 5개만 했다.
//
//    그 결과 가중치 64% 를 차지하는 두 축이 거의 작동하지 않았다(실측 80,550쌍):
//      T22  0점 **49.3%** / 서로 다른 값 **19개**   (matched ÷ 고른 개수 = 작은 정수의 비)
//      T23  0점 4.9%      / 서로 다른 값 **8개**
//      T21  0점 0.2%      / 6,489개  ← 이 축만 건강했다
//
//    전량 + 순위정규화로 바꾼 뒤(이 구현 실측):
//      T22  0점 0.3% / 979개   T23  0점 0.1% / 263개
//      TOP5 도달 302 → **334**   TOP30 497 → **528**   TOP100 537
//      사용자간 ρ 0.152 → **0.088**(낮을수록 개인화 良)
//      T21 단독 TOP30 66 → **197** ← 미뤄뒀던 T21 절대백분위 편향도 함께 해소
//
//    ℹ️ 설계 검토 때 쓴 프로토타입보다 수치가 조금 다르다(TOP5 345 / ρ 0.060 / T23 409개).
//       프로토타입은 **메인 5축의 맵·가중치**(`T21_AB_MAP`, `T23_WEIGHTS`)를 썼고,
//       이 구현은 **t2 전용 맵·가중치**(`AB_TO_T21`, `A_TO_T21`, priority 1.0/0.6/0.3)를 유지한다.
//       t2 의 고유 설계를 건드리지 않는 쪽을 택했다 — 바꾼 것은 **전량 사용과 척도**뿐이다.
//
//    ⚠️ **T22·T23 만 바꾸면 오히려 나빠진다**(TOP30 497→441, TOP100 조차 507).
//       현행 T21 의 절대 백분위 편향이 남아 지배하기 때문이다. 세 축을 함께 바꿔야 한다.
//
//    ⚠️ 표시 점수가 좁아진다 — 종합 sd 0.130 → 0.089. "매칭도 N%" 가 50%대에 더 몰리고
//       상위권이 79% → 69% 로 보인다. 순위는 더 개인화되지만 숫자는 덜 인상적이다.
//       사용자가 알고서 택했다(2026-10-05).
function calcT21ScoreT2(job, userT21) {
  const ab = buildScoreMap(job.details?.업무수행능력?.중요도?.직업간);
  const a  = buildScoreMap(job.details?.업무활동?.중요도?.직업간);

  // 코드 → T21 그룹으로 모은다. 상위 5개가 아니라 **전량**이다.
  const byGroup = {};
  for (const [code, v] of Object.entries(ab)) {
    const g = AB_TO_T21[code];
    if (g) (byGroup[g] = byGroup[g] || []).push(v);
  }
  for (const [code, v] of Object.entries(a)) {
    const g = A_TO_T21[code];
    if (g) (byGroup[g] = byGroup[g] || []).push(v);
  }

  let total = 0, weightSum = 0;
  for (const [g, scores] of Object.entries(byGroup)) {
    const jobScore = scores.reduce((x, y) => x + y, 0) / scores.length;   // 이미 0~1
    const userScore = userT21[g] ?? 0;
    total += jobScore * userScore;
    weightSum += userScore;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

// 사용자가 고른 흥미 분야(KN 코드)에 대해 **그 직업이 얼마나 그 지식을 요구하나**.
// ⚠️ 전에는 "직업의 상위 5개 지식에 내 관심이 들어 있나"(집합 포함)였다. 33개 중 5개만 봐서
//    절반이 0점이었고 값이 19종류뿐이었다. 지금은 전량에서 점수를 읽어 평균한다.
function calcT22ScoreT2(job, userKnCodes) {
  if (!userKnCodes?.length) return 0;
  const map = buildScoreMap(job.details?.지식?.중요도?.직업간);
  let sum = 0, n = 0;
  for (const kn of userKnCodes) {
    const v = map[kn];
    if (v === undefined) continue;        // 그 직업에 없는 지식 코드는 **센 수에서도 뺀다**
    sum += v; n++;
  }
  return n > 0 ? sum / n : 0;
}

// 사용자 가치관 1~3순위에 대해 **그 직업이 그 가치를 얼마나 충족하나**.
// ⚠️ 전에는 "직업의 상위 5개 가치관에 들어 있나"(집합 포함)여서 값이 8종류뿐이었다.
//    9개 전량에서 점수를 읽는다. 가중치는 t2 전용(메인 5축의 T23_WEIGHTS 와 값이 다르다).
function calcT23ScoreT2(job, userVaPriorities) {
  const map = buildScoreMap(job.details?.가치관?.중요도?.직업간);
  const weights = { priority_1: 1.0, priority_2: 0.6, priority_3: 0.3 };
  let total = 0, weightSum = 0;
  for (const [priority, vaCode] of Object.entries(userVaPriorities)) {
    if (!weights[priority] || !vaCode) continue;
    const v = map[vaCode];
    if (v === undefined) continue;        // 직업에 없는 VA 는 가중치에서도 뺀다
    total += v * weights[priority];
    weightSum += weights[priority];
  }
  return weightSum > 0 ? total / weightSum : 0;
}

// ─── GET /api/job/recommend-t2/:survey_id ────────────────────────────────────

const getJobRecommendT2BySurveyId = async (req, res, next) => {
  try {
    const { survey_id } = req.params;

    const surveyResult = await SurveyResult.findOne({ survey_id }).lean();
    if (!surveyResult) {
      return res.status(404).json({
        success: false,
        error: `survey_id '${survey_id}'에 해당하는 검사 결과를 찾을 수 없습니다.`,
      });
    }

    const userT21 = calcGroupScores(surveyResult.answers?.T21);

    const checked = surveyResult.answers?.T22?.checked ?? [];
    const userKnCodes = checked
      .map(itemId => T22_TO_KN[itemId.replace(/^T22_/, '')])
      .filter(Boolean);

    const t23 = surveyResult.answers?.T23 ?? {};
    const userVaPriorities = {
      priority_1: T23_VA_MAP[t23.priority_1] ?? null,
      priority_2: T23_VA_MAP[t23.priority_2] ?? null,
      priority_3: T23_VA_MAP[t23.priority_3] ?? null,
    };

    const Job = getJobModel();
    const jobs = await Job.find({}, {
      jobCode: 1, title: 1, classification: 1, salary: 1, jobSatisfaction: 1,
      dataSource: 1, 'work24.jobCd': 1, 'work24.jobNm': 1,   // 공유 그룹 접기용
      'details.업무수행능력.중요도.직업간': 1,
      'details.업무활동.중요도.직업간':    1,
      'details.지식.중요도.직업간':        1,
      'details.가치관.중요도.직업간':      1,
      _id: 0,
    }).lean();

    const results = [];
    for (const job of jobs) {
      const t21 = calcT21ScoreT2(job, userT21);
      const t22 = calcT22ScoreT2(job, userKnCodes);
      const t23Score = calcT23ScoreT2(job, userVaPriorities);
      const exact = t21 * 0.36 + t22 * 0.36 + t23Score * 0.28;
      const score = round3(exact);
      results.push({
        _exact: exact,              // 정렬 전용. 응답 직전에 제거한다
        _groupKey: job.dataSource === 'work24-shared' ? (job.work24?.jobCd ?? null) : null,
        _groupName: job.work24?.jobNm ?? null,
        jobCode: job.jobCode,
        title: job.title,
        classification: job.classification,
        salary: job.salary ?? null,
        jobSatisfaction: job.jobSatisfaction ?? null,
        t2_match_score: score,
        t2_match_detail: { T21: round3(t21), T22: round3(t22), T23: round3(t23Score) },
      });
    }

    // ⚠️ 메인 경로와 같은 이유로 **원점수**로 정렬한다 — `round3` 로 자르고 정렬하면
    //    동점이 배열 순서(MongoDB 문서 순서)로 갈리고, 순서가 안정적이라 늘 같은 직업이 이긴다.
    //    남는 동점(공유 그룹)은 직업코드로 끊어 결정적으로 만든다.
    results.sort((a, b) => (b._exact - a._exact) || a.jobCode.localeCompare(b.jobCode));

    // 메인 경로와 같이 공유 그룹을 한 자리로 접는다 — 접지 않으면 전문의 13종이 5자리를 독식한다.
    const collapsed = collapseSharedGroups(results);
    for (const r of collapsed) { delete r._exact; delete r._groupKey; delete r._groupName; }

    res.json({ success: true, survey_id, count: Math.min(collapsed.length, 5), data: collapsed.slice(0, 5) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getJobRecommendBySurveyId, postJobRecommend, getJobMatchScore, postJobMatchScore, getJobRecommendT2BySurveyId,
  // 아래는 **검증·테스트 전용 노출**이다. 라우트에서 쓰지 않는다.
  // 점수 로직을 스크립트에서 다시 구현하면 원본과 조용히 갈라지므로 같은 함수를 부른다.
  __test__: {
    calcTotalMatch, buildUserSurvey, getT3Parts, buildScoreMap,
    // recommend-t2 전용 — 메인 5축과 **다른 알고리즘**이다(거리 아님, 곱). 별도로 검증해야 한다.
    calcT21ScoreT2, calcT22ScoreT2, calcT23ScoreT2, calcGroupScores, T22_TO_KN,
    collapseSharedGroups,
    // 분석 전용 — 순위정규화를 끄면 전환 전(직업간 백분위 그대로) 동작이 된다
    setRankNormalize: (v) => { RANK_NORMALIZE = !!v; },
  },
};
