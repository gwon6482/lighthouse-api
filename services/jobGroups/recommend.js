// 직무 추천 — 결과지 '나에게 맞는 직무 3가지'(2026-11-09). 검토 시안 https://claude.ai/artifact/8rzj7uxZajqRPFj53YXj26
//
// 왜: 직업 Top 5 를 테스터들이 '엉뚱하다·뜬금없다·비현실적'이라 했다. 직업 하나를 콕 집는 게 문제라 직무 단위로 넓혔다.
// 직업 점수(537개)는 직업 추천과 **같은 것**을 쓴다(recommendController.scoreJobs). 직무는 그 점수를 묶어 다시 보는 층이다.
//
// 🚨 크기 편향 — 직무 점수를 소속 직업들의 max(또는 평균)로 그냥 내면 **큰 직무가 누구에게나 뜬다**
//    (무작위 응답 300개: 상위 10개 직무가 Top 3 자리의 33~45% 를 차지. 고르게 퍼지면 10%).
//    → 직무마다 '무작위 응답에서 나오는 max 점수' 분포를 미리 재 두고(config/jobGroupNullStats.json)
//      사용자의 max 를 그 분포의 **표준점수**로 바꿔 고른다.
//    ⚠️ 백분위로 바꾸지 말 것 — 실제 응답은 무작위보다 한쪽으로 뚜렷해서 상위 직무가 전부 100 으로 포화되고 다시 크기순이 된다.
// 🚨 고르기와 늘어놓기는 기준이 다르다 — 고르기 = 표준점수, 순서 = 카드 막대 종합(결과지 총점과 같은 .2/.7/.1).
//    표준점수 순서로 늘어놓으면 1위 카드 막대가 2위보다 낮아 보였다(시안 2 에서 실제로 그랬다).
// ⚠️ 정확도는 검증 전이다(현직자 응답 1건). 직무 Top 3 의 우연 적중률이 3% 라 현직자 30명 안팎이면 가를 수 있다.
const { T1_PS_MAP, T21_AB_MAP, T21_A_MAP, T22_HOLLAND_MAP, T23_VA_MAP } = require('../../config/matchingMaps');
const { scoreJobs, buildScoreMap, weightedJobScore, collapseSharedGroups } = require('../../controllers/recommendController');
const { TREE, groupOf, groupInfo } = require('./codes');
const NULL_STATS = require('../../config/jobGroupNullStats.json');

const PICK = 3;
const PER_TOP = 2;    // 같은 대분류(채용 직종 2자리)는 2개까지 — 세 장이 서로 다른 방향으로 보이게
const REPS = 3;       // 카드의 대표 직업 수 = 막대 평균을 내는 직업 수
const REASONS = 2;    // 이유 문장에 넣는 수 — "특히 A와 B가 잘 맞아요"

const round3 = (n) => Math.round(n * 1000) / 1000;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// 분포에 없는 직무(트리·직업 데이터를 다시 만들고 분포는 안 다시 만든 경우) — 전체 평균으로 견준다. 직무마다 한 번만 경고
const POOLED = { m: mean(Object.values(NULL_STATS.groups).map((s) => s.m)), sd: mean(Object.values(NULL_STATS.groups).map((s) => s.sd)) };
const warned = new Set();
function statOf(code) {
  const s = NULL_STATS.groups[code];
  if (s) return s;
  if (!warned.has(code)) {
    warned.add(code);
    console.warn(`[jobGroups] 직무 ${code} 의 분포 없음 — scripts/job-group-null-stats.js 를 다시 돌릴 것`);
  }
  return POOLED;
}

// 재능/흥미/가치관 막대 = (T21×.25 + T22×.25 + T23×.2) / .7 — 앱 결과지 calcT2Score 와 같은 식
const t2Of = (d) => (d.T21 * 0.25 + d.T22 * 0.25 + d.T23 * 0.2) / 0.7;
const fitOf = (d) => 0.2 * d.T1 + 0.7 * t2Of(d) + 0.1 * d.T3;

// ── 이유 ─────────────────────────────────────────────────────────────────
// 후보 = 사용자가 결과지에서 본 이름(성격 Top 3 · 재능 Top 3 · 가치관 1~3순위 · 관심 분야 상위 2개).
// 대표 직업들이 그 항목을 **중요하게 쓰는지** 본다. 두 기준을 다 넘어야 한다:
//   ① 그 직업 안에서 중요한 편(순위정규화 값)  ② 다른 직업보다 높은 편(직업간 백분위 + .12)
//   순위만 보면 생산직의 2등 흥미 '사회형'처럼 절대값은 낮은 항목이 이유로 뽑혔다(시안 때 실제로 그랬다).
const PASS = 0.58;
const PASS_INTEREST = 0.7;   // 관심 분야는 흥미 6유형으로 거칠게 옮겨져 엇나가기 쉽다(수리원에 '교육 및 상담') → 기준을 높인다

function itemMaps(job) {
  const d = job.details || {};
  const both = (k) => {
    const items = d[k]?.['중요도']?.['직업간'] ?? [];
    const rank = buildScoreMap(items);
    return Object.fromEntries(items.map(({ code, score }) => [code, Math.min(rank[code] ?? 0, score / 100 + 0.12)]));
  };
  return { PS: both('성격'), AB: both('업무수행능력'), A: both('업무활동'), HOL: both('흥미'), VA: both('가치관') };
}

function reasonCandidates(analysis) {
  const out = [];
  (analysis?.personality?.top3 ?? []).forEach((f, i) => out.push({
    axis: 'T1', code: f.code, name: f.name, rank: i,
    score: (mp) => weightedJobScore(T1_PS_MAP[f.code] ?? [], mp.PS),
  }));
  (analysis?.talent?.top3 ?? []).forEach((t, i) => out.push({
    axis: 'T21', code: t.code, name: t.name, rank: i,
    score: (mp) => (weightedJobScore(T21_AB_MAP[t.code] ?? [], mp.AB) + weightedJobScore(T21_A_MAP[t.code] ?? [], mp.A)) / 2,
  }));
  ['priority_1', 'priority_2', 'priority_3'].forEach((k, i) => {
    const v = analysis?.values?.[k];
    const va = v && T23_VA_MAP[v.code];
    if (va) out.push({ axis: 'T23', code: v.code, name: v.name, rank: i, score: (mp) => mp.VA[va] ?? 0 });
  });
  // 관심 분야는 많이 고른 순으로 2개(결과지 '나는 … 에서' 문장도 가장 많이 고른 분야를 쓴다)
  Object.entries(analysis?.interest?.by_category ?? {})
    .sort((a, b) => (b[1].items?.length ?? 0) - (a[1].items?.length ?? 0))
    .slice(0, 2)
    .forEach(([cat, c], i) => out.push({
      axis: 'T22', code: cat, name: c.name, rank: i,
      score: (mp) => weightedJobScore(T22_HOLLAND_MAP[cat] ?? [], mp.HOL),
    }));
  return out;
}

const keyOf = (c) => `${c.axis}:${c.code}`;

function pickReasons(cands, reps, used) {
  const maps = reps.map(itemMaps);
  const ok = cands
    .map((c) => ({ ...c, js: mean(maps.map((mp) => c.score(mp))) }))
    .filter((c) => c.js >= (c.axis === 'T22' ? PASS_INTEREST : PASS))
    // 같은 값이면 사용자 쪽 순위가 높은 항목(1순위 가치관 등)을 앞에. 앞 카드에서 쓴 이유는 뒤로
    .map((c) => ({ ...c, val: c.js + 0.03 * (2 - c.rank) - (used.has(keyOf(c)) ? 0.08 : 0) }))
    .sort((a, b) => b.val - a.val);
  // 앞 카드에서 쓴 이유는 빼고 고른다 — 세 장이 같은 말을 되풀이하지 않게. 모자랄 때만 다시 쓴다
  const fresh = ok.filter((c) => !used.has(keyOf(c)));
  const pick = [];
  for (const c of fresh) if (pick.length < REASONS && !pick.some((p) => p.axis === c.axis)) pick.push(c);   // 되도록 서로 다른 영역
  for (const c of fresh) if (pick.length < REASONS && !pick.includes(c)) pick.push(c);
  for (const c of ok) if (pick.length < REASONS && !pick.includes(c)) pick.push(c);
  // 기준을 넘는 게 없으면 억지로 채우지 않는다 — 카드는 이유 문장 없이 막대만 보인다
  pick.forEach((p) => used.add(keyOf(p)));
  return pick.map(({ axis, code, name }) => ({ axis, code, name }));
}

// ── 직무 고르기 ─────────────────────────────────────────────────────────────

/**
 * @param scored  scoreJobs() 결과(점수순 정렬)
 * @param analysis  buildSurveyAnalysis() 결과 — 이유 문장의 이름이 결과지와 같아야 한다
 * @returns 화면 순서대로의 직무 카드
 *   { code, name, fullName, match_detail{T1,T21,T22,T23,T3}, reasons[{axis,code,name}], jobs[{jobCode,title,members?}], jobCount }
 *   jobs 는 이 직무의 직업 전부(나와 맞는 순, 공유 그룹은 한 자리). 앞 3개가 카드의 '대표 직업'이고 막대는 그 3개의 평균이다
 */
function pickJobGroups(scored, analysis, { limit = PICK } = {}) {
  const byGroup = new Map();   // scored 가 점수순이라 직무 안도 점수순이 된다
  for (const s of scored) {
    const g = groupOf(s.job);
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(s);
  }

  const ranked = [...byGroup.entries()]
    .map(([code, list]) => {
      const st = statOf(code);
      return { code, list, z: (list[0].totalExact - st.m) / st.sd };
    })
    .sort((a, b) => (b.z - a.z) || a.code.localeCompare(b.code));

  const chosen = [];
  for (const g of ranked) {
    if (chosen.length >= limit) break;
    if (chosen.filter((c) => TREE.parent[c.code] === TREE.parent[g.code]).length >= PER_TOP) continue;
    chosen.push(g);
  }

  const cards = chosen.map(({ code, list }) => {
    // 고용24가 한 직업으로 묶어 조사한 공유 그룹(전문의 13종 등)은 직업 추천과 같이 한 자리로 접는다
    const entries = collapseSharedGroups(list.map((s) => ({
      jobCode: s.job.jobCode,
      title: s.job.title,
      _s: s,
      _groupKey: s.job.dataSource === 'work24-shared' ? (s.job.work24?.jobCd ?? null) : null,
      _groupName: s.job.work24?.jobNm ?? null,
    })));
    const reps = entries.slice(0, REPS);
    const avg = (k) => round3(mean(reps.map((e) => e._s.detail[k])));
    const detail = { T1: avg('T1'), T21: avg('T21'), T22: avg('T22'), T23: avg('T23'), T3: avg('T3') };
    const { top, ...info } = groupInfo(code);
    return {
      ...info,
      match_detail: detail,
      jobs: entries.map(({ jobCode, title, members }) => (members ? { jobCode, title, members } : { jobCode, title })),
      jobCount: list.length,   // 공유 그룹을 풀어 센 실제 직업 수 — 화면의 '직업 N개 모두 보기'
      _reps: reps.map((e) => e._s.job),
      _fit: fitOf(detail),
    };
  }).sort((a, b) => b._fit - a._fit);

  // 이유는 **화면 순서대로** 골라야 '앞 카드와 겹치지 않게'가 맞는다
  const cands = reasonCandidates(analysis);
  const used = new Set();
  return cards.map(({ _reps, _fit, ...card }) => ({ ...card, reasons: pickReasons(cands, _reps, used) }));
}

async function recommendJobGroups(userSurvey, analysis, opts) {
  return pickJobGroups(await scoreJobs(userSurvey), analysis, opts);
}

module.exports = { recommendJobGroups, pickJobGroups };
