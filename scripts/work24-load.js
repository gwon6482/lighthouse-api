#!/usr/bin/env node
/**
 * work24_raw → job_info 적재. **swap 방식**이라 실패해도 서비스가 살아 있다.
 *
 *   1) job_info_new 에 537건 생성 (기존 job_info 는 손대지 않는다)
 *   2) 검증 — 건수·필수필드·샘플 대조
 *   3) 통과 시  job_info → job_info_backup_YYYYMMDD,  job_info_new → job_info
 *   4) 실패 시  job_info_new 만 버린다
 *
 * 사용:
 *   node scripts/work24-load.js --dry     # 1~2 단계만. 교체하지 않는다
 *   node scripts/work24-load.js           # 전체 실행
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { buildResolver } = require('../services/work24/attrResolver');
const { transform } = require('../services/work24/transform');
const M = require('../services/work24/jobMapping.json');

const DRY = process.argv.includes('--dry');
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const c = mongoose.connection.getClient();
  const jd = c.db(process.env.JOB_DATA_DB || 'job_data');
  const attrs = await c.db(process.env.REFERENCE_DATA_DB || 'reference_data')
    .collection('career_attributes').find({}, { projection: { category: 1, code: 1, name: 1, _id: 0 } }).toArray();
  const R = buildResolver(attrs);

  const rawByCd = Object.fromEntries((await jd.collection('work24_raw').find({}).toArray()).map((d) => [d.jobCd, d]));
  const current = await jd.collection('job_info').find({}).toArray();
  console.log(`기존 job_info ${current.length}건 / work24_raw ${Object.keys(rawByCd).length}건`);

  // ── 전망 본문의 첫 문장이 **형제 직업 이름**으로 시작하는 문제 ──────────────
  //
  // 고용24는 여러 직업을 하나로 묶어 조사하면서(예: 전문의 13종 → '전문의사')
  // 전망 본문을 **묶음 중 한 직업 이름**으로 써 둔다. 그래서 피부과의사 페이지에
  //   "향후 10년간 **내과의사**의 고용은 다소 증가할 것으로 전망된다"
  // 가 그대로 뜬다. 화면 안내는 '전문의사 기준'이라고 하는데 본문은 '내과의사'라 앞뒤가 안 맞는다.
  //
  // → **첫 문장의 이름만** 대표 직업명(jobNm)으로 바꾼다. 본문 나머지는 건드리지 않는다.
  //
  // ⚠️ 전면 치환은 하지 말 것. 실측해보면 이름이 다른 176건 중 대부분은 고칠 대상이 아니다:
  //    · 우리 title 쪽이 오타인 경우 — title '바텐터' vs 본문 '바텐더'
  //    · 본문이 더 자연스러운 경우 — title '법무사 및 집행관' vs 본문 '법무사'(8회)
  //    치환하면 오히려 문장이 틀리거나 어색해진다.
  //
  // ⚠️ 그래서 조건을 좁힌다: **공유 직업**이면서 본문 이름이 **우리 직업목록에 실재하는
  //    다른 직업**일 때만. 이게 "형제 직업 이름이 박힌" 경우다. 실측 30건.
  const norm = (x) => String(x || '').replace(/[\s·・‧/\-()]/g, '');
  const ourTitles = new Set(current.map((c) => norm(c.title)));
  const LEAD_RE = /(향후\s*\d+년간\s*)([가-힣A-Za-z0-9·\s]{2,20}?)(의\s*고용)/;
  let leadFixed = 0;
  const fixProspectLead = (doc) => {
    const t = doc.work24?.prospect?.text;
    if (!t || doc.dataSource !== 'work24-shared') return;
    const mm = t.match(LEAD_RE);
    if (!mm) return;
    const lead = mm[2].trim();
    const nm = doc.work24.jobNm;
    if (!nm || norm(lead) === norm(nm) || norm(lead) === norm(doc.title)) return;
    if (!ourTitles.has(norm(lead))) return;        // 표기 차이는 건드리지 않는다
    doc.work24.prospect.text = t.replace(LEAD_RE, `$1${nm}$3`);
    doc.work24.prospect.leadRenamedFrom = lead;    // 무엇을 바꿨는지 남긴다
    leadFixed++;
  };

  // 같은 jobCd 를 공유하는 우리 직업 수 — dataSource 판정에 쓴다
  const shareCount = {};
  for (const m of Object.values(M.mapping)) shareCount[m.jobCd] = (shareCount[m.jobCd] || 0) + 1;

  const docs = []; const problems = []; let unresolvedTotal = 0;
  for (const cur of current) {
    const m = M.mapping[cur.jobCode];
    if (!m) {
      // 매핑 없음 = 크롤링본 유지. 경기심판 1건.
      docs.push({ ...cur, dataSource: 'crawled' });
      continue;
    }
    const raw = rawByCd[m.jobCd];
    if (!raw) { problems.push(`${cur.jobCode} ${cur.title}: work24_raw 에 ${m.jobCd} 없음`); docs.push({ ...cur, dataSource: 'crawled' }); continue; }

    const { patch, unresolved } = transform(raw, R);
    unresolvedTotal += unresolved.length;
    docs.push({
      ...cur,                       // _id · jobCode · title · classification 유지
      ...patch,                     // overview·duties·details·salary·만족도·자격증·전공·work24
      dataSource: shareCount[m.jobCd] > 1 ? 'work24-shared' : 'work24',
      // 같은 원본을 쓰는 형제 직업. 화면에서 "상위 직업군 기준" 안내에 쓸 수 있다.
      sharedWith: shareCount[m.jobCd] > 1
        ? Object.entries(M.mapping).filter(([code, x]) => x.jobCd === m.jobCd && code !== cur.jobCode).map(([, x]) => x.ours)
        : [],
      lastUpdated: new Date(),
    });
  }

  docs.forEach(fixProspectLead);
  console.log(`  전망 첫 문장 직업명 정정: ${leadFixed}건 (형제 직업명 → 대표 직업명)`);

  // ── 검증 ──
  const bySrc = docs.reduce((a, d) => (a[d.dataSource] = (a[d.dataSource] || 0) + 1, a), {});
  const noDetails = docs.filter((d) => !d.details || !Object.keys(d.details).length).length;
  const noSalary = docs.filter((d) => d.salary?.median == null).length;
  const noTitle = docs.filter((d) => !d.title).length;
  console.log(`\n=== 검증 ===`);
  console.log(`  생성 ${docs.length}건 (기존 ${current.length})  dataSource: ${JSON.stringify(bySrc)}`);
  console.log(`  details 없음 ${noDetails} / salary.median 없음 ${noSalary} / title 없음 ${noTitle}`);
  console.log(`  미해결 속성 ${unresolvedTotal}건`);
  problems.forEach((p) => console.log(`  ⚠️ ${p}`));

  const fatal = docs.length !== current.length || noTitle > 0 || noDetails > 1;
  if (fatal) { console.error('\n✗ 검증 실패 — 중단한다'); process.exit(1); }
  console.log('  ✓ 검증 통과');

  if (DRY) { console.log('\n--dry 이므로 교체하지 않는다.'); await mongoose.disconnect(); return; }

  // ── swap ──
  await jd.collection('job_info_new').drop().catch(() => {});
  await jd.collection('job_info_new').insertMany(docs);
  console.log(`\njob_info_new 생성 ${await jd.collection('job_info_new').countDocuments()}건`);

  const backup = `job_info_backup_${stamp}`;
  await jd.collection(backup).drop().catch(() => {});
  await jd.collection('job_info').rename(backup);

  // ⚠️ 백업은 갱신할 때마다 쌓인다(월 1회 × 3MB). 최신 2개만 남기고 정리한다.
  //    단 **전환 전 크롤링본(20260926)은 영구 보존**한다 — 되돌릴 마지막 수단이다.
  const KEEP_FOREVER = 'job_info_backup_20260926';
  const all = (await jd.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => n.startsWith('job_info_backup_') && n !== KEEP_FOREVER)
    .sort();                       // 이름이 날짜라 사전순 = 시간순
  for (const old of all.slice(0, -2)) {
    await jd.collection(old).drop().catch(() => {});
    console.log(`  오래된 백업 삭제: ${old}`);
  }
  await jd.collection('job_info_new').rename('job_info');
  // ⚠️ rename 은 인덱스를 함께 옮긴다. 원본에 jobCode 인덱스가 있었다면 백업 쪽으로 갔으므로
  //    새 job_info 에 다시 만들어 준다.
  await jd.collection('job_info').createIndex({ jobCode: 1 }, { unique: true });
  console.log(`swap 완료: 백업 ${backup} / 신규 job_info ${await jd.collection('job_info').countDocuments()}건`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
