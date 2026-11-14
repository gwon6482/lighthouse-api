// 진로백과 직업 검색·둘러보기(2026-11-14) — 직업 537개의 이름·분류만 메모리에 올려 두고 찾는다(DB 는 색인을 만들 때만).
//
// 왜 따로 두나: 예전 검색은 직업 이름(title)만 봤다. 그런데 진로백과 직업 이름은 고용24 표기라 생소하다
//   ('농부'는 없고 곡식작물재배원·과수작물재배원 …). 그래서 ① 2차 분류명으로도 찾고 ② 맞는 1·2차 분류를 결과에 함께 내고
//   ③ 일상어 사전(config/jobSearchAliases.js)으로 잇는다.
// ⚠️ 옛 호출(`?name=` 만)은 컨트롤러가 예전대로 처리한다 — 어드민·랜딩 연구 설문·이미 나간 앱이 '결과 없으면 404'에 기대고 있다.
const ALIASES = require('../../config/jobSearchAliases');
const { groupOf, groupInfo } = require('../jobGroups/codes');

// 비교용: 띄어쓰기·가운뎃점을 지운다. 직업 이름은 붙여 쓰고('과수작물재배원') 분류명은 띄어 쓴다('과수작물 재배원').
//   가운뎃점은 데이터에 네 가지가 섞여 있다(· ∙ ‧ ㆍ)
const norm = (s) => String(s ?? '').replace(/[\s·∙‧ㆍ・]/g, '').toLowerCase();

const ALIAS_MAP = new Map(Object.entries(ALIASES).map(([k, v]) => [norm(k), v.map(norm).filter(Boolean)]));

/** DB 에서 읽은 직업들 → 색인. jobs: [{ jobCode, title, classification, work24.keco.code }] */
function buildIndex(jobs) {
  const rows = [];
  const primaries = new Map();
  const secondaries = new Map();
  for (const j of jobs) {
    const title = String(j?.title ?? '').trim();
    if (!j?.jobCode || !title) continue;
    const primary = String(j.classification?.primary ?? '').trim();
    const secondary = String(j.classification?.secondary ?? '').trim();
    rows.push({ jobCode: j.jobCode, title, primary, secondary, nTitle: norm(title), nPrimary: norm(primary), nSecondary: norm(secondary), group: groupOf(j) });
    if (primary) primaries.set(primary, (primaries.get(primary) ?? 0) + 1);
    if (secondary) {
      const s = secondaries.get(secondary) ?? { primary, count: 0 };
      s.count += 1;
      secondaries.set(secondary, s);
    }
  }
  return { rows, primaries, secondaries };
}

const summary = (r, extra) => ({ jobCode: r.jobCode, title: r.title, classification: { primary: r.primary, secondary: r.secondary }, ...extra });

/**
 * 넓은 검색. 순서: 이름이 같음 → 이름이 그 말로 시작 → 이름에 포함 → 일상어 사전으로 걸림 → 2차 분류명으로 걸림.
 * groups: 검색어(또는 사전의 말)가 들어간 1차·2차 분류. 2차 분류의 직업은 jobs 에도 들어 있다(몇 개 안 돼서).
 *         1차 분류는 직업이 많아(10~112개) 이름만 주고, 직업은 byClassification 으로 따로 받는다.
 */
function search(index, query) {
  const q = norm(query);
  if (!q) return { jobs: [], groups: [], aliasTerms: [] };
  const aliasTerms = ALIAS_MAP.get(q) ?? [];
  const terms = [q, ...aliasTerms];
  const ranked = [];
  for (const r of index.rows) {
    let rank = null;
    if (r.nTitle === q) rank = 0;
    else if (r.nTitle.startsWith(q)) rank = 1;
    else if (r.nTitle.includes(q)) rank = 2;
    else if (aliasTerms.some((t) => r.nTitle.includes(t))) rank = 3;
    else if (terms.some((t) => r.nSecondary.includes(t))) rank = 4;
    if (rank !== null) ranked.push({ r, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank); // 같은 순위 안에서는 DB 순서(안정 정렬)
  const jobs = ranked.map(({ r, rank }) => summary(r, { matched: rank <= 2 ? 'title' : rank === 3 ? 'alias' : 'classification' }));

  const groups = [];
  for (const [name, count] of index.primaries) if (terms.some((t) => norm(name).includes(t))) groups.push({ level: 'primary', name, count });
  const secs = [];
  for (const [name, s] of index.secondaries) if (terms.some((t) => norm(name).includes(t))) secs.push({ level: 'secondary', name, primary: s.primary, count: s.count });
  secs.sort((a, b) => b.count - a.count);
  return { jobs, groups: [...groups, ...secs], aliasTerms };
}

/** 한 분류의 직업 전체. primary·secondary 는 이름 그대로(앞뒤 공백만 무시). 둘 다 주면 둘 다 맞는 것 */
function byClassification(index, { primary, secondary }) {
  return index.rows
    .filter((r) => (!primary || r.primary === primary) && (!secondary || r.secondary === secondary))
    .map((r) => summary(r));
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * 진로 둘러보기 — 서로 다른 직무(services/jobGroups, 채용 직종 중분류)에서 직업을 하나씩, count 개.
 * 직무만 무작위로 뽑으면 생산·기계 조작 직무가 많아(전체 직무의 1/3) 그쪽으로 쏠린다.
 *   그래서 대분류(13개)를 먼저 섞고 대분류마다 직무 하나 → 그 직무의 직업 하나를 뽑는다. count 가 대분류 수보다 크면 한 바퀴 더 돈다.
 * 직무에 이어지지 않은 직업은 빠진다. rand 는 테스트에서 바꿔 끼운다.
 */
function explore(index, count = 5, rand = Math.random) {
  const byTop = new Map(); // 대분류 → 직무 코드 → 직업들
  for (const r of index.rows) {
    const g = groupInfo(r.group);
    if (!g) continue;
    const top = g.top ?? '?';
    if (!byTop.has(top)) byTop.set(top, new Map());
    const groups = byTop.get(top);
    if (!groups.has(g.code)) groups.set(g.code, []);
    groups.get(g.code).push(r);
  }
  const pools = shuffle([...byTop.values()].map((groups) => shuffle([...groups.entries()], rand)), rand);
  const out = [];
  while (out.length < count && pools.some((p) => p.length)) {
    for (const p of pools) {
      if (out.length >= count) break;
      const next = p.pop();
      if (!next) continue;
      const [code, rows] = next;
      const g = groupInfo(code);
      out.push(summary(pick(rows, rand), { group: { code: g.code, name: g.name } }));
    }
  }
  return out;
}

module.exports = { norm, buildIndex, search, byClassification, explore, ALIAS_MAP };
