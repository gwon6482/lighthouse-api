// 추출 결과 → 직업별 인재상 집계 — 진로설계 '예시 DB' 3단계.
//   node scripts/recruit-aggregate.js --in temp/recruit-extract-pilot.jsonl --out temp/job-requirements-pilot.json
//
// 직업마다 카테고리(자격·지식·기술·경험·전공·업무)별로 "몇 건의 공고 중 몇 %가 요구하는가"를 센다.
//   - relevant=false(박람회 안내 등)는 분모에서 뺀다
//   - 이름 정규화는 가볍게(공백·대소문자·괄호 보충설명). 같은 것으로 보이는 표기 중 가장 흔한 것을 대표로 쓴다
//   - 자격은 공식 자격 목록(config/work24CertList.json)에 있는지 표시한다(official). 목록 밖은 벤더 자격일 수도, 지어낸 것일 수도 있다
const fs = require('fs');
const path = require('path');
const CERTS = require('../config/work24CertList.json').certs;

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const key = (s) => String(s).toLowerCase().replace(/\(.*?\)|\s|·|ms\s?/g, '').replace(/[^0-9a-z가-힣+#.]/g, '');
const certKeys = new Set(CERTS.map((c) => key(c.name)));
const isOfficial = (name) => {
  const k = key(name);
  if (certKeys.has(k)) return true;
  for (const c of certKeys) if (c.length >= 4 && (k.startsWith(c) || c.startsWith(k))) return true; // '사회복지사2급' ↔ '사회복지사'
  return false;
};

// 직무 역량과 무관한 행정 조건 — 추출 지시에도 불구하고 가벼운 모델이 가끔 흘린다(2026-10-19 Lite 에서 사회복지사 운전면허 5%)
const NOISE = /운전면허|차량\s*소지|자차|고용촉진|장려금|보훈|취업지원대상/;

const CATS = ['qualifications', 'knowledge', 'skills', 'experiences', 'majors', 'duties'];

(async () => {
  const rows = fs.readFileSync(path.resolve(arg('in', 'temp/recruit-extract-pilot.jsonl')), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const minShare = Number(arg('min', 0.03)); // 3% 미만은 버린다(한두 건짜리 잡음)
  const jobs = new Map();
  for (const r of rows) {
    for (const jc of r.jobCodes ?? []) {
      if (!jobs.has(jc)) jobs.set(jc, { jobCode: jc, posts: 0, irrelevant: 0, counts: Object.fromEntries(CATS.map((c) => [c, new Map()])) });
      const j = jobs.get(jc);
      if (!r.relevant) { j.irrelevant++; continue; }
      j.posts++;
      for (const c of CATS) {
        const seenInPost = new Set();
        for (const raw of r[c] ?? []) {
          const name = typeof raw === 'string' ? raw : raw.name;
          const k = key(name);
          if (!k || seenInPost.has(k) || NOISE.test(name)) continue; // 한 공고에서 같은 항목은 한 번만
          seenInPost.add(k);
          const m = j.counts[c];
          if (!m.has(k)) m.set(k, { n: 0, names: new Map(), required: 0 });
          const e = m.get(k);
          e.n++;
          e.names.set(name, (e.names.get(name) ?? 0) + 1);
          if (raw?.type === 'required') e.required++;
        }
      }
    }
  }
  const out = [...jobs.values()].map((j) => ({
    jobCode: j.jobCode, posts: j.posts, irrelevant: j.irrelevant,
    ...Object.fromEntries(CATS.map((c) => [c, [...j.counts[c].values()]
      .map((e) => {
        const name = [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { name, count: e.n, share: +(e.n / j.posts).toFixed(3), ...(c === 'qualifications' ? { required: e.required, official: isOfficial(name) } : {}) };
      })
      .filter((x) => x.share >= minShare && x.count >= 2)
      .sort((a, b) => b.count - a.count)])),
  }));
  fs.writeFileSync(path.resolve(arg('out', 'temp/job-requirements-pilot.json')), JSON.stringify(out, null, 1));
  for (const j of out) {
    console.log(`\n## ${j.jobCode} — 공고 ${j.posts}건(무관 ${j.irrelevant})`);
    for (const c of CATS) console.log(`  ${c}: ${j[c].slice(0, 8).map((x) => `${x.name} ${Math.round(x.share * 100)}%${x.official === false ? '(목록외)' : ''}`).join(', ')}`);
  }
})();
