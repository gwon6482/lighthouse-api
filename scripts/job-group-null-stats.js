/**
 * 직무 추천 크기 보정 분포 → config/jobGroupNullStats.json   (services/jobGroups/recommend.js 가 읽는다)
 *   node --env-file=.env scripts/job-group-null-stats.js
 *
 * 묻는 것: **"아무렇게나 답한 사람에게 이 직무의 max 점수는 보통 얼마인가"**
 *   직업이 많은 직무일수록 max 가 저절로 높다(뽑기를 많이 하는 셈). 그대로 견주면 큰 직무가 누구에게나 뜬다.
 *   직무마다 무작위 응답 400개의 max 분포(평균·표준편차)를 재 두고, 사용자 점수를 그 분포의 표준점수로 바꿔 고른다.
 *
 * 언제 다시 돌리나 — 아래 셋 중 하나가 바뀌면:
 *   ① 직업 데이터(job_info 재적재)  ② 직무 연결(work24-occupation-tree.js 재생성, codes.js PARENT_OVERRIDE)
 *   ③ 채점 식(recommendController.calcTotalMatch)
 *   안 돌려도 깨지지는 않는다(분포 없는 직무는 전체 평균으로 견주고 경고만 남긴다). 다만 보정이 어긋난다.
 *
 * ⚠️ 무작위 응답은 **실사용자 분포가 아니다**(recommend-reachability.js 와 같은 생성기). 보정의 기준선일 뿐이다.
 * ⚠️ 점수 로직을 재구현하지 말 것 — 원본 calcTotalMatch 를 부른다.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { __test__ } = require('../controllers/recommendController');
const { calcTotalMatch, getT3Parts } = __test__;
const { T1_PS_MAP, T21_AB_MAP, T22_HOLLAND_MAP, T23_VA_MAP } = require('../config/matchingMaps');
const { TREE, groupOf, groupInfo, occupationCodeOf, PARENT_OVERRIDE } = require('../services/jobGroups/codes');

const N = 400;
const SEED = 7;
const OUT = path.join(__dirname, '../config/jobGroupNullStats.json');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// recommend-reachability.js 와 같은 생성기
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

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sdOf = (a, m) => Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
const r5 = (n) => Math.round(n * 1e5) / 1e5;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const JOBS = await mongoose.connection.getClient().db(process.env.JOB_DATA_DB || 'job_data').collection('job_info').find({}).toArray();
  const t3Parts = await getT3Parts();

  const GROUP = new Map(JOBS.map((j) => [j.jobCode, groupOf(j)]));
  const mapped = JOBS.filter((j) => GROUP.get(j.jobCode));
  const size = {};
  for (const j of mapped) size[GROUP.get(j.jobCode)] = (size[GROUP.get(j.jobCode)] || 0) + 1;
  console.log(`직업 ${JOBS.length} · 직무 연결 ${mapped.length} · 직무 ${Object.keys(size).length}/${Object.keys(TREE.names).filter((c) => c.length === 3).length}`);
  const unmapped = JOBS.filter((j) => !GROUP.get(j.jobCode));
  if (unmapped.length) console.log(`  연결 없음: ${unmapped.map((j) => `${j.title}(${j.jobCode})`).join(', ')}`);

  // 직무별 max 점수 — 공유 그룹 구성원은 점수가 같아 max 에 영향이 없다
  const groupMax = (us) => {
    const best = {};
    for (const j of mapped) {
      const g = GROUP.get(j.jobCode);
      const s = calcTotalMatch(us, j, t3Parts).totalExact;
      if (!(g in best) || s > best[g]) best[g] = s;
    }
    return best;
  };

  const t0 = Date.now();
  const samples = {};
  const rnd = mulberry32(SEED);
  for (let i = 0; i < N; i++) for (const [g, v] of Object.entries(groupMax(randomUser(rnd)))) (samples[g] ??= []).push(v);
  const groups = Object.fromEntries(Object.entries(samples).sort(([a], [b]) => a.localeCompare(b)).map(([g, a]) => {
    const m = mean(a);
    return [g, { m: r5(m), sd: r5(sdOf(a, m) || 1e-6), n: size[g] }];
  }));
  console.log(`무작위 ${N}개 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);

  // 구조 확인 — 다른 무작위 150개로 실제 고르는 규칙(표준점수 + 대분류당 2개)의 쏠림. 고르게 퍼지면 상위 10개 점유 ≈ 10%
  {
    const rnd2 = mulberry32(99);
    const M = 150;
    const cnt = {};
    for (let i = 0; i < M; i++) {
      const ranked = Object.entries(groupMax(randomUser(rnd2)))
        .map(([g, v]) => ({ g, z: (v - groups[g].m) / groups[g].sd }))
        .sort((a, b) => b.z - a.z || a.g.localeCompare(b.g));
      const chosen = [];
      for (const x of ranked) {
        if (chosen.length >= 3) break;
        if (chosen.filter((c) => TREE.parent[c] === TREE.parent[x.g]).length >= 2) continue;
        chosen.push(x.g);
      }
      chosen.forEach((g) => { cnt[g] = (cnt[g] || 0) + 1; });
    }
    const s = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const share = Math.round(s.slice(0, 10).reduce((a, [, v]) => a + v, 0) / (M * 3) * 100);
    console.log(`구조 확인(무작위 ${M}개): Top 3 에 든 직무 ${s.length}/${Object.keys(groups).length} · 상위 10개 점유 ${share}% · 최다 ${groupInfo(s[0][0]).name} ${Math.round(s[0][1] / M * 100)}%`);
  }

  // 검토용 — 세분류가 여러 직무 밑에 실린 직업과 지금 고른 직무(codes.js PARENT_OVERRIDE 를 볼 때)
  const multi = mapped.filter((j) => TREE.parents?.[occupationCodeOf(j)]);
  if (multi.length) {
    console.log(`\n상위가 여럿인 세분류에 걸린 직업 ${multi.length}개(→ 고른 직무, * = 손으로 고름):`);
    for (const j of multi) {
      const occ = occupationCodeOf(j);
      console.log(`  ${j.title} [${occ}] → ${GROUP.get(j.jobCode)} ${groupInfo(GROUP.get(j.jobCode)).name}${PARENT_OVERRIDE[occ] ? ' *' : ''}  (후보 ${TREE.parents[occ].join('·')})`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'scripts/job-group-null-stats.js 가 만든다. 직무별 무작위 응답 max 점수의 평균(m)·표준편차(sd), n = 직업 수',
    profiles: N, seed: SEED, jobs: JOBS.length, mapped: mapped.length,
    groups,
  }, null, 1));
  console.log(`\n저장: ${path.relative(process.cwd(), OUT)}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
