/**
 * 추천 도달가능성 분석
 *
 * 묻는 것: **"이 직업을 TOP-N 에 올리는 사용자 프로파일 u 가 존재하는가?"**
 *
 * ⚠️ `survey_data.survey_results` 를 쓰지 않는다. **88건 전부 더미다**
 *    (respondent_id 가 users 에 0건 / `test_1_김원칙` 류 페르소나 / seed_test_responses.js).
 *    실사용자 검사 응답은 아직 없다. 표본 기반 평가는 쓸 수 없다.
 *
 * 대신 **가능한 사용자 프로파일 공간**을 무작위로 훑는다. 여기서 나오는 결론은
 * **채점 함수 + 직업 데이터만으로** 성립하므로 응답 표본과 무관하다.
 * 어떤 프로파일로도 TOP-N 에 못 드는 직업이 있다면 그건 표본 문제가 아니라
 * **채점 함수의 성질**, 즉 구조적 배제다.
 *
 * ⚠️ 표본 수를 "실사용자 중 몇 %" 로 읽지 말 것. u 를 균등 추출하므로
 *    도달 **가능 여부**만 말할 수 있고 **빈도**는 말할 수 없다.
 *
 * ⚠️ 점수 로직을 재구현하지 말 것. job.details 를 변형해 원본 함수를 호출한다.
 *
 * 사용법:
 *   node scripts/recommend-reachability.js            # 기본 1200 프로파일
 *   N=3000 node scripts/recommend-reachability.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { __test__ } = require('../controllers/recommendController');
const { calcTotalMatch, getT3Parts } = __test__;
const { T1_PS_MAP, T21_AB_MAP, T22_HOLLAND_MAP, T23_VA_MAP } = require('../config/matchingMaps');

const CATS = ['성격', '흥미', '가치관', '업무수행능력', '업무활동', '업무환경'];
const clone = (o) => JSON.parse(JSON.stringify(o));

// 비교군은 **순위정규화를 끄는** 방식이어야 한다.
// ⚠️ job.details 를 압축하는 식으로는 비교군이 안 된다 — buildScoreMap 이 다시 순위를 매기므로
//    값을 어떻게 눌러도 순위가 같으면 결과가 똑같이 나온다(실제로 그렇게 틀렸었다).
const { setRankNormalize } = __test__;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const T1G = Object.keys(T1_PS_MAP);
const T21G = Object.keys(T21_AB_MAP);
const T22C = Object.keys(T22_HOLLAND_MAP);
const T23L = Object.keys(T23_VA_MAP);
const T3P = ['T3_PHY', 'T3_PEO', 'T3_COM', 'T3_RES', 'T3_STR', 'T3_FLX'];

function randomUser(rnd) {
  const nCat = 1 + Math.floor(rnd() * 3);
  const cats = [...T22C].sort(() => rnd() - 0.5).slice(0, nCat);
  const vs = [...T23L].sort(() => rnd() - 0.5).slice(0, 3);
  return {
    T1: Object.fromEntries(T1G.map(g => [g, rnd()])),
    T21: Object.fromEntries(T21G.map(g => [g, rnd()])),
    T22: { checked: cats.flatMap(c => Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => `${c}_${i + 1}`)) },
    T23: { priority_1: vs[0], priority_2: vs[1], priority_3: vs[2] },
    T3: Object.fromEntries(T3P.map(p => [p, 1 + Math.floor(rnd() * 5)])),
  };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const JOBS = await mongoose.connection.getClient().db('job_data').collection('job_info').find({}).toArray();
  const t3Parts = await getT3Parts();
  const byCode = Object.fromEntries(JOBS.map(j => [j.jobCode, j.title]));
  const N = Number(process.env.N || 1200);

  const run = (label, jobs) => {
    const rnd = mulberry32(42);
    const best = new Map(JOBS.map(j => [j.jobCode, Infinity]));
    for (let i = 0; i < N; i++) {
      const us = randomUser(rnd);
      jobs.map(j => ({ c: j.jobCode, t: calcTotalMatch(us, j, t3Parts).total }))
        .sort((a, b) => b.t - a.t)
        .forEach((x, k) => { if (k + 1 < best.get(x.c)) best.set(x.c, k + 1); });
    }
    const reach = k => [...best.values()].filter(v => v <= k).length;
    console.log(`  ${label.padEnd(22)} TOP5 ${String(reach(5)).padStart(3)}   TOP10 ${String(reach(10)).padStart(3)}   TOP30 ${String(reach(30)).padStart(3)}   TOP100 ${String(reach(100)).padStart(3)}`);
    return best;
  };

  console.log(`── 도달가능성 (무작위 프로파일 ${N}개, 시드 고정, 직업 ${JOBS.length}건) ──`);
  console.log('   "이 직업을 TOP-N 에 올리는 u 가 하나라도 있었나"\n');
  setRankNormalize(false);
  const lvl = run('전환 전(직업간 백분위)', JOBS);
  setRankNormalize(true);
  const now = run('현행(순위정규화)', JOBS);

  const stuck = [...now.entries()].filter(([, v]) => v > 30);
  console.log(`\n  현행에서 TOP30 에 한 번도 못 든 직업: ${stuck.length}건`);
  stuck.forEach(([c, v]) => console.log(`    ${byCode[c]} — 최고 ${v === Infinity ? '진입 없음' : v + '위'}`));

  const worst = [...lvl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const gone = [...lvl.entries()].filter(([, v]) => v > 30).length;
  console.log(`  전환 전에 TOP30 에 한 번도 못 들던 직업: ${gone}건 → 현행 ${stuck.length}건`);
  console.log('\n  전환 전에 가장 불리했던 8건 (그때 → 현행):');
  worst.forEach(([c, v]) => console.log(`    ${byCode[c].padEnd(26)} ${String(v).padStart(3)}위 → ${String(now.get(c)).padStart(3)}위`));

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
