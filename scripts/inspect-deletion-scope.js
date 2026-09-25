// 읽기 전용 — 회원 탈퇴 하드 삭제의 범위와 잔여물을 점검한다. 아무것도 수정하지 않는다.
//
// 쓰는 때:
//  1) 2026-09-25 하드 삭제 전환 **이전**에 소프트 삭제된 계정(isActive:false)이 얼마나 남았는지.
//     그 계정들은 로그인이 막혀 있어 스스로 탈퇴를 호출할 수 없다 → 일회성 정리가 필요하다.
//  2) 삭제 대상 컬렉션에 고아 데이터(참조하는 유저가 없는 문서)가 있는지.
//
//   node scripts/inspect-deletion-scope.js
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const client = mongoose.connection.getClient();
  const ud = client.db(process.env.USER_DATA_DB || 'user_data');
  const sd = client.db(process.env.SURVEY_DATA_DB || 'survey_data');
  const jd = client.db(process.env.JOB_DATA_DB || 'job_data');

  const users = ud.collection('users');
  const total = await users.countDocuments();
  const inactive = await users.find({ isActive: false }, {
    projection: { uid: 1, email: 1, name: 1, createdAt: 1, authProviders: 1 },
  }).toArray();

  console.log(`총 유저 ${total}명 / isActive:false ${inactive.length}명`);
  console.log('(isActive:false = 하드 삭제 전환 이전의 소프트 삭제 잔여물. 로그인이 막혀 스스로 못 지운다)\n');

  const mask = (e) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1***$2') : '(없음)');
  for (const u of inactive) {
    const provider = (u.authProviders || []).map((p) => p.provider).join(',') || 'local';
    console.log(`  uid=${u.uid} provider=${provider} email=${mask(u.email)} name=${u.name || '-'}`);
  }
  if (inactive.length > 0) console.log();

  // 유효한 uid 집합 — 고아 판정용
  const liveUids = new Set(
    (await users.find({}, { projection: { uid: 1 } }).toArray()).map((u) => u.uid)
  );

  console.log('── userUid 기준 컬렉션 (고아 = 참조하는 유저 없음) ──');
  for (const name of ['career_plans', 'weekly_schedules', 'achievement_records', 'curriculum_completions']) {
    const col = ud.collection(name);
    const n = await col.countDocuments();
    const uids = await col.distinct('userUid');
    const orphanUids = uids.filter((x) => x && !liveUids.has(x));
    let orphanDocs = 0;
    if (orphanUids.length > 0) orphanDocs = await col.countDocuments({ userUid: { $in: orphanUids } });
    console.log(`  ${name.padEnd(24)} 총 ${String(n).padStart(5)}건 / 고아 ${orphanDocs}건 (uid ${orphanUids.length}개)`);
  }

  const withPhoto = await ud.collection('achievement_records')
    .countDocuments({ photoUrl: { $exists: true, $nin: ['', null] } });
  console.log(`  achievement_records.photoUrl 있음 ${withPhoto}건 (S3 정리 대상)\n`);

  console.log('── survey_data.survey_results ──');
  const sr = sd.collection('survey_results');
  console.log(`  총 ${await sr.countDocuments()}건`);
  console.log(`  respondent_id 있음 ${await sr.countDocuments({ respondent_id: { $exists: true, $ne: null } })}건`);
  console.log('  (respondent_id 는 클라이언트가 보내는 값이라 비어 있을 수 있다 —');
  console.log('   삭제는 User.surveyResults 의 survey_id 와 OR 로 건다)\n');

  console.log('── job_data.job_reviews (익명화 대상) ──');
  const jr = jd.collection('job_reviews');
  console.log(`  총 ${await jr.countDocuments()}건`);
  console.log(`  submitterEmail 남아있음 ${await jr.countDocuments({ submitterEmail: { $exists: true, $nin: ['', null] } })}건`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
