const crypto = require('crypto');
const CareerPlan = require('../models/CareerPlan');
const PublicCareerPlan = require('../models/PublicCareerPlan');
const User = require('../models/User');

// DB { month, projectIds } → FE { month, projects: Project[] } 변환
function _withPopulatedTimeline(plan) {
  const obj = plan.toObject();
  const projectMap = {};
  for (const p of obj.projects) projectMap[p.id] = p;
  obj.timeline = (obj.timeline || []).map(slot => ({
    month:    slot.month,
    projects: (slot.projectIds || []).map(id => projectMap[id]).filter(Boolean)
  }));
  return obj;
}

// ── STEP 1: POST /api/career-plan ────────────────────────────
// 계획 초안 생성. name/targetJob/duties/startDate/endDate 받음
const createPlan = async (req, res, next) => {
  try {
    const { name, targetJob, duties, startDate, endDate } = req.body;
    const plan = await CareerPlan.create({
      userUid: req.user.uid,
      name:      name      || '',
      targetJob: targetJob || '',
      duties:    duties    || [],
      startDate: startDate || '',
      endDate:   endDate   || '',
      status: 'draft'
    });

    // User.careerDesigns 에 planId 추가
    await User.updateOne(
      { uid: req.user.uid },
      { $addToSet: { careerDesigns: plan.planId } }
    );

    res.status(201).json({ success: true, plan });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/career-plan/:planId ─────────────────────────────
// 기본 정보 수정 (name, targetJob, duties, startDate, endDate, status)
const updatePlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const allowed = ['name', 'targetJob', 'duties', 'startDate', 'endDate', 'status'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $set: update },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/career-plan ─────────────────────────────────────
// 내 계획 목록 (최신순) — 목록에는 timeline 생략
const getMyPlans = async (req, res, next) => {
  try {
    const plans = await CareerPlan.find({ userUid: req.user.uid }).sort({ createdAt: -1 });
    res.json({ success: true, plans: plans.map(p => p.toObject()) });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/career-plan/:planId ─────────────────────────────
// 상세 조회 — timeline을 FE 형식으로 populate해서 반환
const getPlan = async (req, res, next) => {
  try {
    const plan = await CareerPlan.findOne({ planId: req.params.planId, userUid: req.user.uid });
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    res.json({ success: true, plan: _withPopulatedTimeline(plan) });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/career-plan/:planId ─────────────────────────
const deletePlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await CareerPlan.findOneAndDelete({ planId, userUid: req.user.uid });
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    await User.updateOne(
      { uid: req.user.uid },
      { $pull: { careerDesigns: planId } }
    );

    res.json({ success: true, message: '계획이 삭제되었습니다' });
  } catch (err) {
    next(err);
  }
};

// ── STEP 2: POST /api/career-plan/:planId/projects ───────────
// 프로젝트 추가
const addProject = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { name, category, goal, days, startTime, endTime, curriculum } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, error: 'name과 category는 필수입니다' });
    }

    const project = {
      id: crypto.randomUUID(),
      name,
      category,
      goal:       goal       || '',
      days:       days       || [],
      startTime:  startTime  || '',
      endTime:    endTime    || '',
      curriculum: curriculum || []
    };

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $push: { projects: project } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.status(201).json({ success: true, project, plan });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/career-plan/:planId/projects/:projId ────────────
// 프로젝트 수정
const updateProject = async (req, res, next) => {
  try {
    const { planId, projId } = req.params;
    const allowed = ['name', 'category', 'goal', 'days', 'startTime', 'endTime', 'curriculum'];
    const setFields = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) setFields[`projects.$.${key}`] = req.body[key];
    }

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid, 'projects.id': projId },
      { $set: setFields },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '프로젝트를 찾을 수 없습니다' });

    const updated = plan.projects.find(p => p.id === projId);
    res.json({ success: true, project: updated, plan });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/career-plan/:planId/projects/:projId ─────────
// 프로젝트 삭제 (timeline projectIds에서도 제거)
const deleteProject = async (req, res, next) => {
  try {
    const { planId, projId } = req.params;

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      {
        $pull: {
          projects: { id: projId },
          'timeline.$[].projectIds': projId
        }
      },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.json({ success: true, message: '프로젝트가 삭제되었습니다', plan: _withPopulatedTimeline(plan) });
  } catch (err) {
    next(err);
  }
};

// ── STEP 3: PUT /api/career-plan/:planId/timeline ────────────
// FE가 보내는 { month, projects: Project[] } 형식을
// DB 저장 형식 { month, projectIds: string[] } 로 변환해 저장
const saveTimeline = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { timeline } = req.body;

    if (!Array.isArray(timeline)) {
      return res.status(400).json({ success: false, error: 'timeline은 배열이어야 합니다' });
    }

    // FE TimelineSlot { month, projects: Project[] } → DB { month, projectIds: string[] }
    const dbTimeline = timeline.map(slot => ({
      month:      slot.month,
      projectIds: (slot.projects ?? []).map(p => p.id).filter(Boolean)
    }));

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $set: { timeline: dbTimeline, status: 'active' } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.json({ success: true, plan: _withPopulatedTimeline(plan) });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/career-plan/templates ──────────────────────────
// 공개 템플릿 목록 조회 (인증 불필요)
const getTemplates = async (req, res, next) => {
  try {
    const { q } = req.query;
    const filter = { isActive: true };
    if (q) filter.$text = { $search: q };

    const plans = await PublicCareerPlan.find(filter).sort({ likes: -1 }).limit(20);
    res.json({ success: true, plans });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createPlan,
  updatePlan,
  getMyPlans,
  getPlan,
  deletePlan,
  addProject,
  updateProject,
  deleteProject,
  saveTimeline,
  getTemplates
};
