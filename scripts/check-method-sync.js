#!/usr/bin/env node
// 영역 × 진행 방식 동기화 검사 — 직업인 조사(랜딩)와 실제 서비스(앱)·서버가 같은 분류를 쓰는지 (사용자 원칙 2026-10-26)
//
// 쓰는 법(로컬, 세 레포가 나란히 있을 때):  node scripts/check-method-sync.js [--app ../lighthouse-test] [--landing ../lighthouse-landing]
// 비교: API config/projectMethods.js(정본) ↔ 앱 projectMethods.ts(METHODS_BY_CATEGORY) ↔ 랜딩 useCareerPath.ts(KINDS·PREP_METHODS)
// 다르면 exit 1. 분류를 바꾼 작업은 끝내기 전에 이걸 돌릴 것.
const fs = require('fs');
const path = require('path');
const api = require('../config/projectMethods');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(__dirname, '..', '..');
const APP = path.resolve(arg('app', path.join(root, 'lighthouse-test')), 'packages/core/src/modules/career-design/composables/projectMethods.ts');
const LANDING = path.resolve(arg('landing', path.join(root, 'lighthouse-landing')), 'composables/useCareerPath.ts');

const problems = [];
const same = (label, a, b) => {
  const A = [...a].sort().join(','), B = [...b].sort().join(',');
  if (A !== B) problems.push(`${label}\n    API : ${[...a].join(', ')}\n    상대: ${[...b].join(', ')}`);
};

// ── 앱: METHODS_BY_CATEGORY 블록에서 영역별 목록 ──
const app = fs.readFileSync(APP, 'utf8');
const block = app.slice(app.indexOf('export const METHODS_BY_CATEGORY'), app.indexOf('}', app.indexOf('export const METHODS_BY_CATEGORY')));
const appByCat = {};
for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) appByCat[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
same('영역 목록(앱)', api.CATEGORIES, Object.keys(appByCat));
for (const c of api.CATEGORIES) {
  if (JSON.stringify(api.METHODS_BY_CATEGORY[c]) !== JSON.stringify(appByCat[c] ?? [])) {
    problems.push(`영역 '${c}' 방식(순서 포함)\n    API: ${api.METHODS_BY_CATEGORY[c].join(', ')}\n    앱 : ${(appByCat[c] ?? []).join(', ')}`);
  }
}
const appMethods = new Set(Object.values(appByCat).flat());
same('방식 전체(앱)', api.PROJECT_METHODS, appMethods);

// ── 랜딩: KINDS 의 value·method, PREP_METHODS ──
const land = fs.readFileSync(LANDING, 'utf8');
const kindsBlock = land.slice(land.indexOf('export const KINDS'), land.indexOf('export const PREP_METHODS'));
const kinds = [...kindsBlock.matchAll(/value: '(\w+)'.*?method: (null|'(\w+)')/g)].map((m) => ({ value: m[1], method: m[3] ?? null }));
same('조사 종류(랜딩 KINDS)', api.CONTRIBUTION_KINDS, kinds.map((k) => k.value));
for (const k of kinds) {
  const want = api.TARGET_KINDS.includes(k.value) ? null : k.value;
  if (k.method !== want) problems.push(`랜딩 종류 '${k.value}' 의 method 는 ${want} 여야 한다(지금 ${k.method})`);
}
const prepStart = land.indexOf('= [', land.indexOf('export const PREP_METHODS'));   // 타입 표기 '[]' 를 건너뛴다
const prepBlock = land.slice(prepStart, land.indexOf('\n]', prepStart));
same('자격증·어학 준비 방식(랜딩 PREP_METHODS)', api.PREP_METHODS, [...prepBlock.matchAll(/value: '(\w+)'/g)].map((m) => m[1]));

if (problems.length) {
  console.error(`❌ 동기화 어긋남 ${problems.length}건\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`✅ 동기화 OK — 영역 ${api.CATEGORIES.length} · 방식 ${api.PROJECT_METHODS.length} · 조사 종류 ${api.CONTRIBUTION_KINDS.length}`);
