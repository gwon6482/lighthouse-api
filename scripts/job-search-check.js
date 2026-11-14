/**
 * 직업 검색·둘러보기 점검(2026-11-14) — 읽기만 한다.
 *   node --env-file=.env scripts/job-search-check.js [검색어 …]
 *
 * 보는 것
 *   ① 일상어 사전(config/jobSearchAliases.js)의 '찾을 말'이 직업 이름·분류명에 하나도 안 걸리는 줄(죽은 줄) → 있으면 1 로 끝난다
 *   ② 일상어가 직업 이름에 이미 그대로 들어 있는지(사전이 결과를 넓히기만 하는지 볼 참고)
 *   ③ 둘러보기: 직무에 이어진 직업 수, 2,000번 뽑았을 때 한 번도 안 나온 직무
 *   ④ 인자로 준 검색어의 결과
 * 직업 데이터를 다시 싣거나 사전을 고친 뒤 돌릴 것.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const ALIASES = require('../config/jobSearchAliases');
const { norm, buildIndex, search, explore } = require('../services/jobSearch');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data');
  const jobs = await db.collection('job_info')
    .find({}, { projection: { jobCode: 1, title: 1, 'classification.primary': 1, 'classification.secondary': 1, 'work24.keco.code': 1, _id: 0 } }).toArray();
  await mongoose.disconnect();
  const index = buildIndex(jobs);
  console.log(`직업 ${index.rows.length}개 · 1차 분류 ${index.primaries.size}개 · 2차 분류 ${index.secondaries.size}개`);

  let dead = 0;
  for (const [word, terms] of Object.entries(ALIASES)) {
    for (const t of terms) {
      const n = norm(t);
      const hit = index.rows.some((r) => r.nTitle.includes(n) || r.nSecondary.includes(n) || r.nPrimary.includes(n));
      if (!hit) { dead++; console.log(`  ✗ 죽은 줄: ${word} → '${t}' 에 걸리는 직업·분류가 없다`); }
    }
    const own = index.rows.filter((r) => r.nTitle.includes(norm(word))).length;
    const res = search(index, word);
    console.log(`  ${word}: 직업 ${res.jobs.length}개(이름에 그대로 ${own}) · 분류 ${res.groups.length}개`);
  }

  const linked = index.rows.filter((r) => r.group).length;
  const seen = new Map();
  const allGroups = new Set(index.rows.map((r) => r.group).filter(Boolean));
  for (let i = 0; i < 2000; i++) {
    const picks = explore(index, 5);
    if (picks.length !== 5 || new Set(picks.map((p) => p.group.code)).size !== 5) { console.log('  ✗ 둘러보기: 5개가 아니거나 직무가 겹침', picks); dead++; break; }
    for (const p of picks) seen.set(p.group.code, (seen.get(p.group.code) ?? 0) + 1);
  }
  console.log(`둘러보기: 직무에 이어진 직업 ${linked}/${index.rows.length}개 · 직무 ${allGroups.size}개 가운데 2,000번(10,000장)에 나온 직무 ${seen.size}개`);

  for (const q of process.argv.slice(2)) {
    const r = search(index, q);
    console.log(`\n'${q}' → 직업 ${r.jobs.length}개 · 분류 ${r.groups.length}개`);
    console.log('  분류:', r.groups.map((g) => `${g.name}(${g.level === 'primary' ? '1차' : '2차'} ${g.count})`).join(', ') || '-');
    console.log('  직업:', r.jobs.slice(0, 20).map((j) => `${j.title}[${j.matched[0]}]`).join(', ') + (r.jobs.length > 20 ? ' …' : ''));
  }
  process.exit(dead ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
