// 관리자용 회원 관리 — 목록 조회와 영구 삭제.
// `/api/admin` 전체가 server.js 에서 adminAuth(x-admin-key) 뒤에 있다. 이 파일은 그 전제를 쓴다.
//
// ⚠️ 이 API 가 브라우저에서 직접 불리면 안 된다. 어드민 앱의 서버 프록시
//    (`src/app/api/proxy/[...path]/route.ts`)가 NextAuth 세션을 검증한 뒤 서버에서 키를 주입한다.
const mongoose = require('mongoose');
const User = require('../models/User');
const { purgeUser, resetUserToStage, RESET_STAGES } = require('../services/userPurge');
const SurveyResult = require('../models/SurveyResult');
const CareerPlan = require('../models/CareerPlan');
const WeeklySchedule = require('../models/WeeklySchedule');
const AchievementRecord = require('../models/AchievementRecord');
const CurriculumCompletion = require('../models/CurriculumCompletion');

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

// GET /api/admin/users/:uid
// 회원 상세 — 가입 설문 / 자기이해 검사 / 진로 설계를 한 번에 모아 준다.
//
// ⚠️ 가입 설문(onboarding)은 **숫자 코드만** 저장돼 있다. 선택지 문구의 정본은
//    FE `SignupWizardPage.vue` 이고, 해석표는 어드민 화면이 들고 있다.
//    여기서 문구로 바꿔 내리면 FE 가 문구를 고쳤을 때 조용히 어긋난다.
const getUserDetail = async (req, res, next) => {
  try {
    const { uid } = req.params;
    // ⚠️ passwordHash 를 projection 에서 빼면 `!!user.passwordHash` 가 **항상 false** 가 된다.
    //    읽어 와서 유무만 판정하고, 응답에는 값을 절대 싣지 않는다(아래 응답 구성은 화이트리스트다).
    const user = await User.findOne({ uid }, { __v: 0 }).lean();
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    // 자기이해 검사. survey_id 와 respondent_id 양쪽으로 찾는다
    // (respondent_id 는 클라이언트가 보낸 값이라 비어 있을 수 있다).
    const surveyIds = Array.isArray(user.surveyResults) ? user.surveyResults : [];
    const surveyFilter = surveyIds.length > 0
      ? { $or: [{ survey_id: { $in: surveyIds } }, { respondent_id: uid }] }
      : { respondent_id: uid };
    const surveys = await SurveyResult.find(surveyFilter, {
      survey_id: 1, submitted_at: 1, T1_result: 1,
      'raw_payload.answer_type': 1, answers: 1, _id: 0
    }).sort({ submitted_at: -1 }).lean();

    // 진로 설계. 응답이 비대해지지 않게 요약만 싣는다 — 프로젝트·타임라인 원문은 뺀다.
    const plans = await CareerPlan.find({ userUid: uid }, {
      planId: 1, name: 1, targetJob: 1, startDate: 1, endDate: 1, reviewDay: 1,
      status: 1, projects: 1, routines: 1, createdAt: 1, _id: 0
    }).sort({ createdAt: -1 }).lean();

    const [weeklySchedules, achievementRecords, curriculumCompletions] = await Promise.all([
      WeeklySchedule.countDocuments({ userUid: uid }),
      AchievementRecord.countDocuments({ userUid: uid }),
      CurriculumCompletion.countDocuments({ userUid: uid })
    ]);

    res.json({
      success: true,
      data: {
        profile: {
          uid: user.uid,
          email: user.email || null,
          name: user.name || null,
          age: user.age ?? null,
          gender: user.gender || null,
          providers: (user.authProviders || []).map((p) => ({
            provider: p.provider,
            connectedAt: p.connectedAt || null
          })),
          hasPassword: !!user.passwordHash,   // toJSON 이 아니라 lean 이라 직접 판단한다
          isActive: user.isActive !== false,
          createdAt: user.createdAt || null,
          updatedAt: user.updatedAt || null,
          lastLoginAt: user.lastLoginAt || null,
          settings: user.settings || null,
          deviceCount: (user.devices || []).length
        },
        // 회원가입 설문 — 숫자 코드 원본 그대로
        onboarding: user.onboarding || null,
        // 자기이해 검사
        surveys: surveys.map((s) => ({
          surveyId: s.survey_id,
          submittedAt: s.submitted_at || null,
          answerType: s.raw_payload?.answer_type || null,
          // 어느 영역을 풀었는지만 — 응답 원문은 너무 크다
          areas: s.answers ? Object.keys(s.answers) : [],
          t1: s.T1_result
            ? {
                typeCode: s.T1_result.type_code || null,
                fullName: s.T1_result.full_name || null,
                baseName: s.T1_result.base_name || null,
                modifier: s.T1_result.modifier || null
              }
            : null
        })),
        // 진로 탐색
        exploration: {
          bookmarkedJobs: user.bookmarkedJobs || [],
          recommendedJobs: user.recommendedJobs || [],
          targetCareer: user.targetCareer && user.targetCareer.ref ? user.targetCareer : null
        },
        // 진로 설계·달성
        design: {
          plans: plans.map((p) => ({
            planId: p.planId,
            name: p.name || null,
            targetJob: p.targetJob || null,
            startDate: p.startDate || null,
            endDate: p.endDate || null,
            reviewDay: p.reviewDay || null,
            status: p.status,
            projectCount: (p.projects || []).length,
            routineCount: (p.routines || []).length,
            createdAt: p.createdAt || null
          })),
          weeklySchedules,
          achievementRecords,
          curriculumCompletions
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:uid/reset  { stage: 'design' | 'survey' | 'signup' }
// 계정은 남기고 해당 단계 **이후**의 데이터를 지운다. 되돌릴 수 없다.
const resetUser = async (req, res, next) => {
  try {
    const { uid } = req.params;
    const { stage } = req.body || {};

    if (!RESET_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: `stage 는 ${RESET_STAGES.join(' | ')} 중 하나여야 합니다`
      });
    }

    const result = await resetUserToStage(uid, stage);
    if (!result) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const masked = result.user.email
      ? result.user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : '(이메일 없음)';
    console.log(`[admin] 회원 리셋 uid=${uid} email=${masked} stage=${stage} cleared=${JSON.stringify(result.cleared)}`);

    // 이메일 계정은 위저드로 돌아가지 않는다 — 호출부가 사용자에게 알릴 수 있게 실어 보낸다.
    const providers = (result.user.authProviders || []).map((p) => p.provider);
    const socialOnly = providers.some((p) => p !== 'local') && !providers.includes('local');

    res.json({
      success: true,
      message: '리셋이 완료되었습니다',
      stage,
      cleared: result.cleared,
      wizardWillShow: stage === 'signup' ? socialOnly : null
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
};

module.exports = { listUsers, getUserDetail, deleteUser, resetUser };
