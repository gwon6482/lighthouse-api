/**
 * 직업 장문 텍스트 전수 점검
 *
 * 대상 4개: overview / duties[] / work24.way / work24.prospect.text
 *
 * 고용24 원문을 그대로 싣기 때문에 **내용 오류가 섞여 들어온다.**
 * 2026-09-28 에 전망 본문이 형제 직업 이름으로 시작하는 것(30건)을 찾아 고쳤다.
 * 그런 류가 또 없는지 기계적으로 훑는다.
 *
 * 사용법: node scripts/audit-job-text.js [--samples N]
 */
require('dotenv').config();
const mongoose = require('mongoose');

const SHOW = Number((process.argv.find(a => a.startsWith('--samples=')) || '').split('=')[1] || 5);
const norm = (x) => String(x || '').replace(/[\s·・‧/\-()]/g, '');

const FIELDS = [
  ['overview', (j) => (j.overview ? [j.overview] : [])],
  ['duties', (j) => (j.duties || []).filter((x) => typeof x === 'string')],
  ['way', (j) => (j.work24?.way ? [j.work24.way] : [])],
  ['prospect', (j) => (j.work24?.prospect?.text ? [j.work24.prospect.text] : [])],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const JOBS = await mongoose.connection.getClient().db('job_data').collection('job_info').find({}).toArray();
  const titles = JOBS.map((j) => ({ t: j.title, n: norm(j.title) }));
  const findings = {};
  const add = (key, job, field, detail) => {
    (findings[key] = findings[key] || []).push({ job: job.title, field, detail });
  };

  for (const j of JOBS) {
    for (const [fname, get] of FIELDS) {
      for (const raw of get(j)) {
        const t = String(raw);

        // 1) 인코딩 잔재 / 태그
        const ent = t.match(/&#x?[0-9a-fA-F]+;|&(amp|lt|gt|quot|nbsp|apos);/g);
        if (ent) add('인코딩 잔재', j, fname, [...new Set(ent)].join(' '));
        if (/<[a-zA-Z/][^>]{0,40}>/.test(t)) add('HTML 태그', j, fname, (t.match(/<[a-zA-Z/][^>]{0,40}>/g) || []).slice(0, 3).join(' '));
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) add('제어문자', j, fname, JSON.stringify(t.match(/[\u0000-\u001F]/g).slice(0, 5)));

        // 2) 공백 이상
        if (t !== t.trim()) add('앞뒤 공백', j, fname, JSON.stringify(t.slice(0, 12) + '…' + t.slice(-12)));
        if (/ {3,}/.test(t)) add('연속 공백', j, fname, '');

        // 3) 잘림 — 종결부호 없이 끝남
        const tail = t.trim().slice(-1);
        if (t.trim().length > 40 && !'.。!?」”\'")…'.includes(tail) && !/[다음임함됨움]$/.test(t.trim())) {
          add('종결부호 없이 끝남(잘림 의심)', j, fname, '…' + t.trim().slice(-34));
        }

        // 4) 플레이스홀더
        if (/^(없음|해당없음|해당 없음|미정|준비중|N\/A|-|\.)$/i.test(t.trim())) add('플레이스홀더', j, fname, t.trim());

        // 5) 같은 문장 반복
        const sents = t.split(/(?<=[.。])\s*/).map((x) => x.trim()).filter((x) => x.length > 25);
        const seen = new Map();
        for (const sn of sents) { seen.set(sn, (seen.get(sn) || 0) + 1); }
        const dup = [...seen.entries()].filter(([, c]) => c > 1);
        if (dup.length) add('같은 문장 반복', j, fname, dup[0][0].slice(0, 46) + ` ×${dup[0][1]}`);

        // 6) 다른 직업 이름이 **문장 주어 자리**에 오는 경우
        //    (본문에 다른 직업이 언급되는 건 정상이다. 정의/전망의 주어일 때만 의심한다.)
        const subj = t.match(/^\s*([가-힣A-Za-z0-9·\s]{2,20}?)(은|는|이란|란|의 고용)\s/);
        if (subj) {
          const s = norm(subj[1]);
          const other = titles.find((x) => x.n === s && x.n !== norm(j.title));
          if (other) add('첫 문장 주어가 다른 직업', j, fname, `"${subj[1].trim()}" (이 직업: ${j.title})`);
        }
      }
    }
  }

  // 7) 서로 다른 직업이 **같은 본문**을 갖는 경우 (공유 85건 외)
  const crypto = require('crypto');
  for (const [fname, get] of FIELDS) {
    const byHash = {};
    for (const j of JOBS) {
      const arr = get(j); if (!arr.length) continue;
      const h = crypto.createHash('md5').update(arr.join('\u0001')).digest('hex');
      (byHash[h] = byHash[h] || []).push(j);
    }
    const groups = Object.values(byHash).filter((g) => g.length > 1);
    const notShared = groups.filter((g) => g.some((j) => j.dataSource !== 'work24-shared'));
    if (notShared.length) {
      notShared.slice(0, 20).forEach((g) => add('공유직업이 아닌데 본문 동일', g[0], fname, g.map((x) => `${x.title}(${x.dataSource})`).join(' / ').slice(0, 110)));
    }
  }

  // ── 출력 ──
  console.log(`직업 ${JOBS.length}건 × 4개 텍스트 필드 점검\n`);
  const keys = Object.keys(findings).sort((a, b) => findings[b].length - findings[a].length);
  if (!keys.length) { console.log('  이상 없음'); }
  for (const k of keys) {
    const f = findings[k];
    console.log(`■ ${k} — ${f.length}건`);
    const byField = f.reduce((a, x) => (a[x.field] = (a[x.field] || 0) + 1, a), {});
    console.log(`    필드별: ${Object.entries(byField).map(([a, b]) => `${a} ${b}`).join(' / ')}`);
    f.slice(0, SHOW).forEach((x) => console.log(`    · ${x.job} [${x.field}] ${x.detail}`));
    console.log();
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
