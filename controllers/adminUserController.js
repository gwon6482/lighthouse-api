// 관리자용 회원 관리 — 목록 조회와 영구 삭제.
// `/api/admin` 전체가 server.js 에서 adminAuth(x-admin-key) 뒤에 있다. 이 파일은 그 전제를 쓴다.
//
// ⚠️ 이 API 가 브라우저에서 직접 불리면 안 된다. 어드민 앱의 서버 프록시
//    (`src/app/api/proxy/[...path]/route.ts`)가 NextAuth 세션을 검증한 뒤 서버에서 키를 주입한다.
const mongoose = require('mongoose');
const User = require('../models/User');
const { purgeUser } = require('../services/userPurge');

// 목록에 붙일 '딸린 데이터 건수'. 페이지의 uid 들을 한 번에 묶어 집계한다.
// ⚠️ 유저마다 countDocuments 를 돌리면 N+1 이다. 컬렉션당 1회씩, 총 4회로 끝낸다.
async function countsByUid(uids) {
  if (uids.length === 0) return {};
  const db = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
  const collections = {
    careerPlans: 'career_plans',
    weeklySchedules: 'weekly_schedules',
    achievementRecords: 'achievement_records',
    curriculumCompletions: 'curriculum_completions'
  };

  const out = {};
  for (const uid of uids) out[uid] = { careerPlans: 0, weeklySchedules: 0, achievementRecords: 0, curriculumCompletions: 0 };

  for (const [key, name] of Object.entries(collections)) {
    const rows = await db.collection(name).aggregate([
      { $match: { userUid: { $in: uids } } },
      { $group: { _id: '$userUid', n: { $sum: 1 } } }
    ]).toArray();
    for (const r of rows) {
      if (out[r._id]) out[r._id][key] = r.n;
    }
  }
  return out;
}

// GET /api/admin/users
// 쿼리: page, limit(최대 100), search(이메일·이름 부분일치), provider(local|kakao|google), isActive(true|false)
const listUsers = async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 20;
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const filter = {};

    if (req.query.provider) {
      filter['authProviders.provider'] = req.query.provider;
    }
    if (req.query.isActive === 'true') filter.isActive = true;
    if (req.query.isActive === 'false') filter.isActive = false;

    const search = (req.query.search || '').trim();
    if (search) {
      // ⚠️ 사용자 입력을 정규식에 그대로 넣으면 `(` 같은 문자로 터지고 ReDoS 도 가능하다. 이스케이프한다.
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      filter.$or = [{ email: re }, { name: re }];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter, {
      uid: 1, email: 1, name: 1, age: 1, gender: 1, authProviders: 1,
      isActive: 1, createdAt: 1, lastLoginAt: 1, surveyResults: 1,
      bookmarkedJobs: 1, targetCareer: 1, onboarding: 1, _id: 0
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const counts = await countsByUid(users.map((u) => u.uid));

    res.json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      },
      data: users.map((u) => ({
        uid: u.uid,
        email: u.email || null,
        name: u.name || null,
        age: u.age ?? null,
        gender: u.gender || null,
        providers: (u.authProviders || []).map((p) => p.provider),
        isActive: u.isActive !== false,
        hasOnboarding: !!u.onboarding,
        createdAt: u.createdAt || null,
        lastLoginAt: u.lastLoginAt || null,
        counts: {
          surveyResults: (u.surveyResults || []).length,
          bookmarkedJobs: (u.bookmarkedJobs || []).length,
          hasTargetCareer: !!(u.targetCareer && u.targetCareer.ref),
          ...(counts[u.uid] || {})
        }
      }))
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/users/:uid
// **되돌릴 수 없다.** 본인 탈퇴와 같은 경로(services/userPurge)를 타므로 삭제 범위가 갈라지지 않는다.
const deleteUser = async (req, res, next) => {
  try {
    const { uid } = req.params;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'uid 가 필요합니다' });
    }

    const result = await purgeUser(uid);
    if (!result) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    // 누가 지워졌는지 로그에 남긴다 — 되돌릴 수 없는 작업이라 흔적이 필요하다.
    // ⚠️ 이메일은 마스킹한다. 컨테이너 로그는 보존 3일이지만 그대로 평문을 남길 이유는 없다.
    const masked = result.user.email
      ? result.user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : '(이메일 없음)';
    console.log(`[admin] 회원 삭제 uid=${uid} email=${masked} deleted=${JSON.stringify(result.deleted)}`);

    res.json({
      success: true,
      message: '계정과 관련 데이터가 모두 삭제되었습니다',
      deleted: result.deleted
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listUsers, deleteUser };
