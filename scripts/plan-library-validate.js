// data/plan-library 검사(2026-11-13) — 직업 계획이 보편 프로젝트·분류·앱 영역과 어긋나지 않는지 본다.
//   node scripts/plan-library-validate.js          오류가 있으면 1 로 끝난다
// 보는 것: id 중복, 분류(type·subtype)·계열·영역·진행 방식, 주차(1 이상)·할 일(1~4개), ref 가 가리키는 프로젝트의 존재,
//         세부 카테고리 id 가 priority-jobs.json 과 같은지, 전공자 제외 항목에 이유(skip)가 있는지
const fs = require('fs');
const path = require('path');
const { CATEGORIES, METHODS_BY_CATEGORY } = require('../config/projectMethods');
const DIR = path.join(__dirname, '../data/plan-library');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

const tax = read('taxonomy.json');
const common = read('common-projects.json').items;
const priority = read('priority-jobs.json').jobs;
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const types = Object.fromEntries(tax.types.map((t) => [t.id, t]));
const LEVELS = ['입문', '중급', '심화'];

function checkProject(where, p) {
  const t = types[p.type];
  if (!t) err(where, `type '${p.type}'`); else if (!t.subtypes[p.subtype]) err(where, `subtype '${p.subtype}'`);
  if (!CATEGORIES.includes(p.category)) err(where, `category '${p.category}'`);
  else if (!METHODS_BY_CATEGORY[p.category].includes(p.method)) err(where, `method '${p.method}' 는 ${p.category} 에서 못 고른다`);
  if (!LEVELS.includes(p.level)) err(where, `level '${p.level}'`);
  if (!(p.daysPerWeek >= 1 && p.daysPerWeek <= 7)) err(where, 'daysPerWeek');
  if (!(p.minutesPerSession >= 20 && p.minutesPerSession <= 600)) err(where, 'minutesPerSession');
  if (!p.name || !p.goal) err(where, 'name·goal');
  if (!Array.isArray(p.phases) || !p.phases.length) err(where, 'phases 없음');
  for (const ph of p.phases || []) {
    if (!(ph.weeks >= 1)) err(where, `phase '${ph.title}' weeks`);
    if (!ph.title || !Array.isArray(ph.items) || ph.items.length < 1 || ph.items.length > 4) err(where, `phase '${ph.title}' items`);
  }
}
const weeksOf = (p) => p.phases.reduce((s, ph) => s + ph.weeks, 0);

const cp = new Map();
for (const p of common) {
  if (!/^cp\.[a-z0-9-]+$/.test(p.id)) err(p.id, 'id 모양');
  if (cp.has(p.id)) err(p.id, '중복');
  cp.set(p.id, p);
  checkProject(p.id, p);
  if (!tax.scopes[p.scope]) err(p.id, `scope '${p.scope}'`);
  if (p.scope === 'all' ? p.families.length : !p.families.length) err(p.id, 'scope 와 families 가 어긋남');
  for (const f of p.families) if (!tax.families[f]) err(p.id, `family '${f}'`);
}
for (const [fam, ids] of Object.entries(tax.bundles)) {
  if (!tax.families[fam]) err('bundles', `family '${fam}'`);
  for (const id of ids) if (!cp.has(id)) err(`bundles.${fam}`, `없는 보편 프로젝트 ${id}`);
}
// 1차 100개 + 이후 단계에서 옮겨 온 계획. 대표 직업·함께 덮는 직업을 통틀어 한 직업은 한 번만 나와야 한다
const allCodes = priority.flatMap((j) => [j.jobCode, ...j.covers.map((c) => c.jobCode)]);
if (priority.length < 100 || new Set(allCodes).size !== allCodes.length) err('priority-jobs', '100개 미만이거나 직업이 겹침');
for (const j of priority) for (const c of j.covers) if (c.track && !j.tracks.some((t) => t.id === c.track)) err('priority-jobs', `${j.title}: 함께 덮는 직업의 세부 카테고리 ${c.track} 없음`);

const byCode = new Map(priority.map((j) => [j.jobCode, j]));
const usedCommon = new Map();
const localNames = new Map();
const rows = [];
const planFiles = fs.readdirSync(path.join(DIR, 'plans')).filter((f) => f.endsWith('.json'));
for (const f of planFiles) {
  const plan = read(`plans/${f}`);
  const w = `plans/${f}`;
  const pj = byCode.get(plan.jobCode);
  if (!pj) { err(w, '우선순위 목록에 없는 직업'); continue; }
  if (f !== `${plan.jobCode}.json`) err(w, '파일 이름과 jobCode 가 다름');
  const local = new Map();
  for (const p of plan.projects) {
    if (!/^p\.[a-z0-9-]+$/.test(p.id)) err(w, `id 모양 ${p.id}`);
    if (local.has(p.id)) err(w, `중복 ${p.id}`);
    local.set(p.id, p);
    checkProject(`${w} ${p.id}`, p);
    localNames.set(p.name, [...(localNames.get(p.name) || []), plan.displayName]);
  }
  const trackIds = pj.tracks.map((t) => t.id);
  if (JSON.stringify(Object.keys(plan.byTrack).sort()) !== JSON.stringify([...trackIds].sort())) err(w, '세부 카테고리가 우선순위 목록과 다름');
  const resolve = (it) => (it.ref.startsWith('cp.') ? cp.get(it.ref) : local.get(it.ref));
  const used = new Set();
  const checkItems = (label, items) => {
    for (const it of items) {
      const p = resolve(it);
      if (!p) { err(w, `${label}: 없는 프로젝트 ${it.ref}`); continue; }
      if (typeof it.step !== 'number') err(w, `${label} ${it.ref}: step`);
      if (it.major === false && !it.skip) err(w, `${label} ${it.ref}: 전공자 제외인데 이유(skip)가 없음`);
      used.add(it.ref);
      if (it.ref.startsWith('cp.')) usedCommon.set(it.ref, (usedCommon.get(it.ref) || new Set()).add(plan.displayName));
    }
  };
  checkItems('common', plan.common);
  for (const [tid, items] of Object.entries(plan.byTrack)) checkItems(tid, items);
  for (const id of local.keys()) if (!used.has(id)) err(w, `쓰이지 않는 프로젝트 ${id}`);
  // 요약: 세부 카테고리마다 필수 프로젝트 수와 주차 합(순서대로 하나씩 한다고 볼 때 — 실제 기간은 앱의 '속도 고르기'가 정한다)
  const summarize = (items) => {
    const must = items.filter((it) => !it.optional);
    const sum = (list) => list.reduce((s, it) => s + weeksOf(resolve(it)), 0);
    return { n: must.length, weeks: sum(must), major: must.filter((it) => it.major !== false).length, majorWeeks: sum(must.filter((it) => it.major !== false)), opt: items.length - must.length };
  };
  const tracks = trackIds.length ? trackIds : [null];
  for (const tid of tracks) {
    const items = [...plan.common, ...(tid ? plan.byTrack[tid] : [])].sort((a, b) => a.step - b.step);
    const steps = items.map((it) => it.step);
    if (new Set(steps).size !== steps.length) err(w, `${tid ?? '공통'}: step 이 겹침`);
    rows.push({ job: plan.displayName, track: tid ? pj.tracks.find((t) => t.id === tid).name : '-', ...summarize(items) });
  }
}
console.log(`보편 프로젝트 ${common.length}개 · 계획 대상 ${priority.length}개(덮는 직업 ${allCodes.length}/537) · 계획 ${planFiles.length}개(${rows.length}갈래)`);
if (fs.existsSync(path.join(DIR, 'backlog.json'))) { const left = read('backlog.json').waves.flatMap((w) => w.bundles).filter((b) => !b.done); console.log(`남은 계획 ${left.length}개` + (left.length ? ` — 다음 묶음 ${left[0].batch}` : '')); }
if (process.argv.includes('--table')) for (const r of rows) console.log(`  ${r.job} / ${r.track}: 비전공 ${r.n}개 ${r.weeks}주 · 전공 ${r.major}개 ${r.majorWeeks}주 · 선택 ${r.opt}개`);
const dup = [...localNames.entries()].filter(([, jobs]) => new Set(jobs).size > 1);
if (dup.length) console.log('여러 직업에 같은 이름의 직업 프로젝트 → 보편 프로젝트로 올릴 후보:', dup.map(([n, j]) => `${n}(${[...new Set(j)].join('·')})`).join(', '));
console.log(`계획에서 쓰인 보편 프로젝트 ${usedCommon.size}/${common.length}개`);
if (errors.length) { console.error(`\n오류 ${errors.length}건`); errors.forEach((e) => console.error(' - ' + e)); process.exit(1); }
console.log('오류 없음');
