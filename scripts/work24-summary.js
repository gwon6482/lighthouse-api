#!/usr/bin/env node
/**
 * 갱신 결과 요약. 월간 워크플로 끝에서 돌려 **로그만 보고 상태를 알 수 있게** 한다.
 * 읽기 전용 — 아무것도 바꾸지 않는다.
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const jd = mongoose.connection.getClient().db(process.env.JOB_DATA_DB || 'job_data');
  const info = jd.collection('job_info');

  const total = await info.countDocuments();
  const bySrc = await info.aggregate([{ $group: { _id: '$dataSource', n: { $sum: 1 } } }]).toArray();
  const raw = await jd.collection('work24_raw').countDocuments();
  const backups = (await jd.listCollections().toArray())
    .map((c) => c.name).filter((n) => n.startsWith('job_info_backup_')).sort();

  console.log('=== Work24 갱신 결과 ===');
  console.log(`  job_info      ${total}건`);
  console.log(`  work24_raw    ${raw}건`);
  console.log(`  dataSource    ${bySrc.map((x) => `${x._id ?? '(없음)'} ${x.n}`).join(' / ')}`);
  console.log(`  백업          ${backups.join(', ') || '(없음)'}`);

  // 품질 지표 — 하나라도 튀면 갱신이 잘못된 것이다.
  const noDetails = await info.countDocuments({ $or: [{ details: null }, { details: {} }] });
  const noSalary = await info.countDocuments({ 'salary.median': null });
  const entity = await info.countDocuments({ $or: [{ duties: { $regex: '&#' } }, { 'work24.way': { $regex: '&#' } }] });
  const newest = await info.find({}, { projection: { lastUpdated: 1, _id: 0 } }).sort({ lastUpdated: -1 }).limit(1).toArray();

  console.log('\n  품질 지표 (전부 0 이어야 정상)');
  console.log(`    details 없음     ${noDetails}`);
  console.log(`    salary 없음      ${noSalary}`);
  console.log(`    엔티티(&#) 잔존  ${entity}`);
  console.log(`    최종 갱신        ${newest[0]?.lastUpdated ?? '(없음)'}`);

  // 조사년도 분포 — 원본이 갱신됐는지 보는 신호
  const years = await info.aggregate([
    { $group: { _id: '$work24.salarySurveyYear', n: { $sum: 1 } } }, { $sort: { _id: -1 } },
  ]).toArray();
  console.log(`    임금 조사년도    ${years.map((y) => `${y._id ?? '없음'}:${y.n}`).join(' ')}`);

  const bad = noDetails + noSalary + entity;
  await mongoose.disconnect();
  if (bad > 0) { console.error(`\n✗ 품질 지표에 이상 ${bad}건`); process.exit(1); }
  console.log('\n✓ 정상');
})().catch((e) => { console.error(e); process.exit(1); });
