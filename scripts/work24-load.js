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
  await jd.collection('job_info_new').rename('job_info');
  // ⚠️ rename 은 인덱스를 함께 옮긴다. 원본에 jobCode 인덱스가 있었다면 백업 쪽으로 갔으므로
  //    새 job_info 에 다시 만들어 준다.
  await jd.collection('job_info').createIndex({ jobCode: 1 }, { unique: true });
  console.log(`swap 완료: 백업 ${backup} / 신규 job_info ${await jd.collection('job_info').countDocuments()}건`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
