/**
 * '되는 길' 직접 쓴 글 점검(2026-11-14) — 읽기만 한다.
 *   node --env-file=.env scripts/job-way-check.js
 * 보는 것: config/jobWayOverrides.json 의 직업 코드가 DB 에 있고 이름이 같은지, 통합조사 묶음(work24-shared)인지,
 *          글에 다른 구성원의 이름이 '○○이 되기 위해서는' 꼴로 들어 있지 않은지, basis·sources 모양.
 *          그리고 묶음 가운데 아직 남의 이름 글이 그대로 나가는 직업(덮어쓴 것은 빼고)을 찍는다 — 직업 데이터를 다시 실은 뒤 볼 것.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const O = require('../config/jobWayOverrides.json');
const n = (s) => String(s ?? '').replace(/[\s·∙‧ㆍ()]/g, '');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const jobs = await mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info')
    .find({ dataSource: 'work24-shared' }, { projection: { _id: 0, jobCode: 1, title: 1, 'work24.jobCd': 1, 'work24.way': 1 } }).toArray();
  await mongoose.disconnect();
  const byCode = new Map(jobs.map((j) => [j.jobCode, j]));
  let bad = 0;
  for (const [code, o] of Object.entries(O.items)) {
    const j = byCode.get(code);
    if (!j) { bad++; console.log(`✗ ${code} ${o.title}: 통합조사 직업에 없다`); continue; }
    if (j.title.trim() !== o.title) { bad++; console.log(`✗ ${code}: 이름이 다르다(${j.title} / ${o.title})`); }
    if (!['law', 'general'].includes(o.basis) || !Array.isArray(o.sources) || (o.basis === 'law' && !o.sources.length)) { bad++; console.log(`✗ ${code} ${o.title}: basis·sources`); }
    if (!o.way || o.way.length < 150) { bad++; console.log(`✗ ${code} ${o.title}: 글이 너무 짧다`); }
  }
  // 덮어쓰지 않은 묶음 직업 가운데, 글 앞머리에 같은 묶음 다른 직업의 이름이 나오고 제 이름은 없는 것
  const groups = new Map(); for (const j of jobs) groups.set(j.work24.jobCd, [...(groups.get(j.work24.jobCd) ?? []), j]);
  const left = [];
  for (const list of groups.values()) for (const j of list) {
    if (O.items[j.jobCode] || !j.work24.way) continue;
    const w = n(j.work24.way);
    const mine = w.includes(n(j.title).slice(0, 4));
    const other = list.find((x) => x !== j && w.slice(0, 40).includes(n(x.title).slice(0, 4)));
    if (!mine && other) left.push(`${j.title}(← ${other.title})`);
  }
  console.log(`직접 쓴 글 ${Object.keys(O.items).length}개 · 통합조사 직업 ${jobs.length}개 · 아직 남의 이름 글이 나가는 직업 ${left.length}개${left.length ? ': ' + left.join(', ') : ''}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
