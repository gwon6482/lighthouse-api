/**
 * 추천 정확도 측정 — Recall@K · MRR
 *
 * 묻는 것: **실무자의 검사 결과를 추천에 넣으면, 그 사람의 실제 직업이 상위에 나오는가?**
 * 이것이 추천의 **유일한 직접 평가지표**다. 설계 정본은 공유 docs
 * `research/survey-collection-design.md`.
 *
 * ⚠️ 지금까지의 검증은 전부 **도달가능성**(프로파일 공간)이었다. 그건
 *    "구조적 배제가 없다" 만 보장하고 **정확도가 아니다.** 이 스크립트가 정확도를 잰다.
 *
 * ⚠️ `survey_results`(88건)는 **쓰지 않는다. 전부 더미다.**
 *    `survey_results_research` 의 `completed:true` + `role:practitioner` 만 쓴다.
 *
 * ⚠️ 점수 로직을 **재구현하지 않는다.** 컨트롤러의 `__test__` 를 그대로 부른다 —
 *    재구현하면 원본과 조용히 갈라져 "측정값이 운영과 다른" 최악이 된다.
 *
 * 사용법:
 *   node scripts/research-recall.js
 *   node scripts/research-recall.js --include-suspect   # 품질 의심 응답까지 포함
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { __test__ } = require('../controllers/recommendController');
const {
  calcTotalMatch, buildUserSurvey, getT3Parts, collapseSharedGroups,
  calcT21ScoreT2, calcT22ScoreT2, calcT23ScoreT2, calcGroupScores, T22_TO_KN,
} = __test__;
const { T23_VA_MAP } = require('../config/matchingMaps');

// ── 지표 정의를 **여기서 고정한다** ─────────────────────────────────────────
// ⚠️ 결과를 보고 K 를 고르면 **무엇을 하든 좋아 보이게** 만들 수 있다.
//    데이터가 오기 전에 박아두는 것이 요점이다.
const KS = [1, 3, 5, 10, 30];

// 분석에 필요한 최소 표본 (설계 문서의 하한).
// 미달이면 **수치를 내되 "기준선으로 쓸 수 없다"고 분명히 말한다.**
const MIN_N_FOR_BASELINE = 100;

/**
 * 공유 그룹은 **그룹 단위로 판정**한다.
 * 전문의 13종은 `details` 가 바이트 단위로 같아 점수가 완전히 동일하다 —
 * 개별 구분이 **원리적으로 불가능**하므로 "피부과의사가 1위냐" 를 묻는 것은 무의미하다.
 * 운영 추천도 그룹을 한 자리로 접어 보여준다(`collapseSharedGroups`).
 * → 접힌 항목이 **응답자의 직업을 포함하면 적중**으로 센다.
 */
function rankOfJob(scoredSorted, targetJobCode) {
  const collapsed = collapseSharedGroups(scoredSorted);
  for (let i = 0; i < collapsed.length; i++) {
    const e = collapsed[i];
    const covered = e.members?.length ? e.members.map((m) => m.jobCode) : [e.jobCode];
    if (covered.includes(targetJobCode)) return { rank: i + 1, grouped: covered.length > 1 };
  }
  return { rank: null, grouped: false };
}

function summarize(ranks, weights) {
  const n = ranks.length;
  if (!n) return null;
  const w = weights || ranks.map(() => 1);
  const wsum = w.reduce((a, b) => a + b, 0);
  const out = { n, recall: {}, mrr: null, medianRank: null };
  for (const k of KS) {
    let hit = 0;
    ranks.forEach((r, i) => { if (r != null && r <= k) hit += w[i]; });
    out.recall[k] = Math.round((hit / wsum) * 1000) / 10;   // %
  }
  let rr = 0;
  ranks.forEach((r, i) => { rr += (r != null ? 1 / r : 0) * w[i]; });
  out.mrr = Math.round((rr / wsum) * 1000) / 1000;
  const found = ranks.filter((r) => r != null).sort((a, b) => a - b);
  out.medianRank = found.length ? found[Math.floor(found.length / 2)] : null;
  out.notFound = ranks.filter((r) => r == null).length;
  return out;
}

const fmt = (s, label) => {
  if (!s) return `  ${label}: 표본 없음`;
  const rec = KS.map((k) => `@${k} ${String(s.recall[k]).padStart(5)}%`).join('  ');
  return `  ${label.padEnd(26)} n=${String(s.n).padStart(4)}  ${rec}   MRR ${s.mrr}  중앙순위 ${s.medianRank ?? '-'}`;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const cl = mongoose.connection.getClient();
  const jd = cl.db(process.env.JOB_DATA_DB || 'job_data');
  const sd = cl.db(process.env.SURVEY_DATA_DB || 'survey_data');

  const includeSuspect = process.argv.includes('--include-suspect');

  const JOBS = await jd.collection('job_info').find({}).toArray();
  const t3Parts = await getT3Parts();

  const filter = { completed: true, 'respondent.role': 'practitioner' };
  if (!includeSuspect) filter['quality.suspect'] = { $ne: true };
  const RES = await sd.collection('survey_results_research').find(filter).toArray();

  console.log('── 추천 정확도 (Recall@K · MRR) ──');
  console.log(`   직업 ${JOBS.length}건 / 실무자 완주 응답 ${RES.length}건`
    + (includeSuspect ? '  (품질 의심 포함)' : '  (품질 의심 제외)'));
  console.log(`   무작위 기준선: TOP5 는 약 ${(5 / collapseSharedGroups(JOBS.map((j) => ({
    jobCode: j.jobCode, title: j.title,
    _groupKey: j.dataSource === 'work24-shared' ? (j.work24?.jobCd ?? null) : null,
    _groupName: j.work24?.jobNm ?? null,
  }))).length * 100).toFixed(1)}%\n`);

  if (RES.length === 0) {
    console.log('  ⚠️ 실무자 응답이 없다. 수집 전이다.');
    console.log(`  ⚠️ 기준선으로 쓰려면 **${MIN_N_FOR_BASELINE}명** 이 필요하다`);
    console.log('     (Recall 오차 ±10%p. 그 이하면 알고리즘 변경 효과를 판정할 수 없다)');
    console.log('\n  지표 정의는 이미 고정했다: K = ' + KS.join(', ') + ' / 공유그룹은 그룹 단위 판정');
    await mongoose.disconnect();
    return;
  }

  // ── 메인 5축 ──
  const mainRanks = []; const fitW = []; const groupedHits = [];
  const t2Ranks = [];
  const perPrimary = {};

  for (const r of RES) {
    const target = r.respondent?.jobCode;
    if (!target) continue;
    const us = buildUserSurvey(r);

    const scored = JOBS.map((j) => {
      const m = calcTotalMatch(us, j, t3Parts);
      return {
        jobCode: j.jobCode, title: j.title, _exact: m.totalExact,
        _groupKey: j.dataSource === 'work24-shared' ? (j.work24?.jobCd ?? null) : null,
        _groupName: j.work24?.jobNm ?? null,
      };
    }).sort((a, b) => (b._exact - a._exact) || a.jobCode.localeCompare(b.jobCode));

    const { rank, grouped } = rankOfJob(scored, target);
    mainRanks.push(rank);
    groupedHits.push(grouped);
    // ⚠️ 적합감은 **필터가 아니라 가중치**다. 낮은 적합감을 버리면 선택 편향이 생긴다.
    //    없으면 1(중립)로 둔다 — 0 으로 두면 그 응답이 사라진다.
    fitW.push(r.respondent?.fitScore ? r.respondent.fitScore / 5 : 1);

    const p = r.respondent?.jobPrimary || '(미분류)';
    (perPrimary[p] = perPrimary[p] || []).push(rank);

    // ── recommend-t2 (다른 알고리즘 — 곱 형태) ──
    const uT = calcGroupScores(r.answers?.T21);
    const uK = (r.answers?.T22?.checked ?? [])
      .map((i) => T22_TO_KN[String(i).replace(/^T22_/, '')]).filter(Boolean);
    const t23 = r.answers?.T23 ?? {};
    const uV = {
      priority_1: T23_VA_MAP[t23.priority_1] ?? null,
      priority_2: T23_VA_MAP[t23.priority_2] ?? null,
      priority_3: T23_VA_MAP[t23.priority_3] ?? null,
    };
    const t2scored = JOBS.map((j) => ({
      jobCode: j.jobCode, title: j.title,
      _exact: calcT21ScoreT2(j, uT) * 0.36 + calcT22ScoreT2(j, uK) * 0.36 + calcT23ScoreT2(j, uV) * 0.28,
      _groupKey: j.dataSource === 'work24-shared' ? (j.work24?.jobCd ?? null) : null,
      _groupName: j.work24?.jobNm ?? null,
    })).sort((a, b) => (b._exact - a._exact) || a.jobCode.localeCompare(b.jobCode));
    t2Ranks.push(rankOfJob(t2scored, target).rank);
  }

  console.log('── 메인 5축 (/api/job/recommend) ──');
  console.log(fmt(summarize(mainRanks), '전체'));
  console.log(fmt(summarize(mainRanks, fitW), '적합감 가중'));
  console.log();
  console.log('── recommend-t2 (다른 알고리즘) ──');
  console.log(fmt(summarize(t2Ranks), '전체'));
  console.log();

  const g = groupedHits.filter(Boolean).length;
  if (g) console.log(`  ℹ️ 공유 그룹으로 판정된 적중 ${g}건 — 그룹 내 개별 구분은 원리적으로 불가능하다\n`);

  console.log('── 직업 대분류별 ──');
  Object.entries(perPrimary).sort((a, b) => b[1].length - a[1].length).forEach(([p, rs]) => {
    const s = summarize(rs);
    console.log(fmt(s, p.length > 24 ? p.slice(0, 24) : p));
  });

  if (RES.length < MIN_N_FOR_BASELINE) {
    console.log(`\n  🚨 표본 ${RES.length}명 < ${MIN_N_FOR_BASELINE}명.`);
    console.log('     수치는 참고용이다. **기준선으로 쓰거나 "개선됐다"고 말하지 말 것** —');
    console.log('     Recall 오차가 변화량보다 크다.');
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
