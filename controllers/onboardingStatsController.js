const User = require('../models/User');

// GET /api/admin/onboarding/stats
//
// 회원가입 3~5단계(Q1~Q3) 답변 분포. `/api/admin` 이라 adminAuth(x-admin-key)를 이미 거친다.
//
// ⚠️ **분모를 전체 유저 수로 잡으면 안 된다.** onboarding 필드는 2026-09-09 에 생겼고
//    그 전 가입자에겐 필드 자체가 없다(스키마 default: undefined). 비율의 분모는 항상
//    `answered`(= 답변이 있는 유저)다. `total` 은 참고용으로만 같이 준다.
//
// ⚠️ 문항·선택지 문구는 여기에 두지 않는다. 값은 숫자 코드뿐이고 해석표는
//    models/User.js 의 OnboardingSchema 주석과 FE SignupWizardPage 가 정본이다.
//    문구를 이 API 에 복사해두면 FE 가 문구를 바꿨을 때 조용히 어긋난다.
const getOnboardingStats = async (req, res, next) => {
  try {
    const ANSWERED = { onboarding: { $exists: true } };

    const [total, answered] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments(ANSWERED),
    ]);

    // 코드값이 하나도 안 나온 선택지도 0 으로 나와야 화면이 안 흔들린다.
    const zeros = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 0]));

    const fill = (rows, n) => {
      const out = zeros(n);
      for (const r of rows) {
        if (r._id !== null && r._id !== undefined && out[r._id] !== undefined) out[r._id] = r.count;
      }
      return out;
    };

    const countBy = (field) =>
      User.aggregate([
        { $match: { ...ANSWERED, [field]: { $ne: null } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      ]);

    const [statusRows, selfRows, concernRows] = await Promise.all([
      countBy('onboarding.status'),
      countBy('onboarding.selfAwareness'),
      // Q2 는 복수 선택이라 배열을 펼쳐서 센다.
      // ⚠️ 합계가 answered 를 넘는 것이 정상이다 — '응답자 수'가 아니라 '선택 수'다.
      User.aggregate([
        { $match: { ...ANSWERED, 'onboarding.concerns': { $ne: null } } },
        { $unwind: '$onboarding.concerns' },
        { $group: { _id: '$onboarding.concerns', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        total,                       // 전체 유저(참고용). 비율 계산에 쓰지 말 것
        answered,                    // 분모로 쓸 값
        byStatus: fill(statusRows, 4),            // Q1 1~4
        byConcern: fill(concernRows, 6),          // Q2 1~6 (복수 선택 → 합계 > answered 가능)
        bySelfAwareness: fill(selfRows, 3),       // Q3 1~3
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getOnboardingStats };
