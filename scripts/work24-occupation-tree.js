// 고용24 채용 직종코드 트리 → config/work24OccupationTree.json
//   node --env-file=.env scripts/work24-occupation-tree.js
//
// 왜 필요한가: 채용정보(210L01)는 6자리 세분류(occupation=133200)로 찾지만,
// 공채속보(210L21)는 **중분류(3자리, 024 소프트웨어)·대분류(2자리)** 로만 걸린다(6자리는 0건, 2026-10-16 실측).
// 세분류 → 중분류는 코드 앞자리로 알 수 없다(012100 의 상위는 011) — 공통코드 트리의 superCd 가 정본이다.
// 직종코드 개편 때 다시 돌린다(키: WORK24_KEY_COMMON_CODE).
const fs = require('fs');
const path = require('path');

(async () => {
  const qs = new URLSearchParams({ returnType: 'XML', target: 'CMCD', authKey: process.env.WORK24_KEY_COMMON_CODE, dtlGb: '2' });
  const xml = await (await fetch(`https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo21L01.do?${qs}`)).text();
  const names = {};
  const parent = {};
  // ⚠️ 코드에 영문자가 섞인다 — 대분류에 중분류가 10개 이상이면 10번째부터 '01A'·'02B' 처럼 이어진다(14개, 2026-11-09 실측).
  //    전에는 (\d+) 로 받아 그 중분류가 통째로 빠졌고, 그 아래 세분류는 상위 코드 없이 남았다(직업 83개가 직무에 연결 안 됨).
  //    채용정보 occupation·공채속보 jobsCd 둘 다 '01A' 를 그대로 받는다(같은 날 실측)
  // ⚠️ 같은 세분류가 여러 중분류 밑에 **중복으로** 실려 있다(79개 — 보육교사 = 교사 031 · 보육 038).
  //    parent 는 응답에서 마지막에 나온 것이라 맞는다는 보장이 없다(한식 조리사 → 제과·제빵 118).
  //    전부 parents 에 남기고, 직무로 묶을 때 쓸 하나는 services/jobGroups.js PARENT_OVERRIDE 에서 고른다
  const parents = {};
  for (const m of xml.matchAll(/<jobsCd>([0-9A-Z]+)<\/jobsCd><jobsNm>([^<]*)<\/jobsNm>(?:<superCd>([0-9A-Z]+)<\/superCd>)?/g)) {
    names[m[1]] = m[2];
    if (!m[3]) continue;
    parent[m[1]] = m[3];
    (parents[m[1]] ??= []).includes(m[3]) || parents[m[1]].push(m[3]);
  }
  const multi = Object.fromEntries(Object.entries(parents).filter(([, ps]) => ps.length > 1));
  const top = Object.keys(names).filter((c) => c.length === 2).length;
  const mid = Object.keys(names).filter((c) => c.length === 3).length;
  if (top < 10 || mid < 50) throw new Error(`트리가 비정상(대 ${top} · 중 ${mid}) — 키·응답을 확인할 것`);
  const out = { generatedAt: new Date().toISOString().slice(0, 10), names, parent, parents: multi };
  fs.writeFileSync(path.join(__dirname, '../config/work24OccupationTree.json'), JSON.stringify(out));
  console.log(`대 ${top} · 중 ${mid} · 전체 ${Object.keys(names).length} · 상위가 여럿인 코드 ${Object.keys(multi).length}`);
})();
