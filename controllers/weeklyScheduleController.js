const WeeklySchedule = require('../models/WeeklySchedule');
const CareerPlan = require('../models/CareerPlan');

// 본인 plan 인지 확인 (소유권 검증)
async function ensureOwnedPlan(planId, userUid) {
  return await CareerPlan.findOne({ planId, userUid });
}

// GET /api/career-plan/:planId/weekly-schedule
// 그 plan 의 모든 주간 일정 (weekStart desc 정렬)
const listSchedules = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const schedules = await WeeklySchedule
      .find({ planId, userUid: req.user.uid })
      .sort({ weekStart: -1 });

    res.json({ success: true, schedules: schedules.map(s => s.toObject()) });
  } catch (err) {
    next(err);
  }
};

// GET /api/career-plan/:planId/weekly-schedule/:weekStart
// 특정 주 1건 조회. 없으면 null 반환 (404 아님 — 클라이언트가 "아직 미생성" 판단)
const getSchedule = async (req, res, next) => {
  try {
    const { planId, weekStart } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const schedule = await WeeklySchedule.findOne({
      planId, userUid: req.user.uid, weekStart
    });

    res.json({ success: true, schedule: schedule ? schedule.toObject() : null });
  } catch (err) {
    next(err);
  }
};

// POST /api/career-plan/:planId/weekly-schedule
// body: { weekStart, weekEnd, items? }
// 이미 같은 weekStart 가 있으면 409 (중복 생성 방지 — 갱신은 PUT 사용)
const createSchedule = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { weekStart, weekEnd, items } = req.body;

    if (!weekStart || !weekEnd) {
      return res.status(400).json({ success: false, error: 'weekStart, weekEnd 필수' });
    }

    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const existing = await WeeklySchedule.findOne({ planId, userUid: req.user.uid, weekStart });
    if (existing) {
      return res.status(409).json({ success: false, error: '해당 주의 일정이 이미 존재합니다', schedule: existing.toObject() });
    }

    const schedule = await WeeklySchedule.create({
      planId,
      userUid:   req.user.uid,
      weekStart,
      weekEnd,
      items:     Array.isArray(items) ? items : []
    });

    res.status(201).json({ success: true, schedule: schedule.toObject() });
  } catch (err) {
    next(err);
  }
};

// PUT /api/career-plan/:planId/weekly-schedule/:weekStart
// 부분 업데이트: items / weekEnd / reviewNote / status / reviewedAt
const updateSchedule = async (req, res, next) => {
  try {
    const { planId, weekStart } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const allowed = ['weekEnd', 'items', 'reviewNote', 'status'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    // status 가 'reviewed' 로 바뀌면 reviewedAt 자동 기록 (이미 있으면 보존)
    if (update.status === 'reviewed') {
      update.reviewedAt = new Date();
    }

    const schedule = await WeeklySchedule.findOneAndUpdate(
      { planId, userUid: req.user.uid, weekStart },
      { $set: update },
      { new: true }
    );
    if (!schedule) return res.status(404).json({ success: false, error: '주간 일정을 찾을 수 없습니다' });

    res.json({ success: true, schedule: schedule.toObject() });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/career-plan/:planId/weekly-schedule/:weekStart
const deleteSchedule = async (req, res, next) => {
  try {
    const { planId, weekStart } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const result = await WeeklySchedule.deleteOne({
      planId, userUid: req.user.uid, weekStart
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '주간 일정을 찾을 수 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule
};
