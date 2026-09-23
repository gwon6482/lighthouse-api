// 읽기 전용 — 소셜(OAuth) 계정 및 딸린 데이터 현황 점검. 아무것도 수정하지 않는다.
require('dotenv').config();
const mongoose = require('mongoose');

const mask = (e) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1***$2') : '(없음)');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const db = mongoose.connection.db;
  const users = db.collection('users');

  const total = await users.countDocuments();
  const social = await users.find({
    authProviders: { $elemMatch: { provider: { $in: ['kakao', 'google'] } } },
  }).sort({ createdAt: 1 }).toArray();

  console.log(`총 유저 ${total}명 / 소셜 계정 ${social.length}건\n`);

  for (const u of social) {
    const p = u.authProviders.find((x) => ['kakao', 'google'].includes(x.provider));
    const uid = u.uid || u.userUid || String(u._id);
    const counts = {};
    for (const [col, q] of [
      ['career_plans', { userUid: uid }],
      ['weekly_schedules', { userUid: uid }],
      ['achievement_records', { userUid: uid }],
      ['curriculum_completions', { userUid: uid }],
    ]) counts[col] = await db.collection(col).countDocuments(q);

    console.log([
      `_id=${u._id}`,
      `uid=${uid}`,
      `provider=${p.provider}`,
      `providerId=${p.providerId}`,
      `email=${mask(u.email)}`,
      `name=${u.name || '(없음)'}`,
      `age=${u.age ?? '-'}/${u.gender ?? '-'}`,
      `isActive=${u.isActive}`,
      `created=${u.createdAt ? new Date(u.createdAt).toISOString() : '-'}`,
      `lastLogin=${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '-'}`,
      `onboarding=${u.onboarding ? JSON.stringify(u.onboarding) : '(없음)'}`,
      `surveyResults=${(u.surveyResults || []).length}`,
      `bookmarks=${(u.bookmarkedJobs || []).length}`,
      `plans=${counts.career_plans} weekly=${counts.weekly_schedules} ach=${counts.achievement_records} curr=${counts.curriculum_completions}`,
    ].join(' | '));
  }

  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
