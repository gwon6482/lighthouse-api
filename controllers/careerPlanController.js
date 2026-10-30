const crypto = require('crypto');
const CareerPlan = require('../models/CareerPlan');
const { cleanMethod } = CareerPlan;
const PublicCareerPlan = require('../models/PublicCareerPlan');
const User = require('../models/User');
const { purgePlan } = require('../services/userPurge');
const { resetUpcomingSchedules } = require('../services/scheduleReset');

// 프로젝트의 실행 설정 — ⚠️ 2026-10-29 전까지 추가·일괄·수정 모두 이 필드를 버려서 모든 프로젝트가 0분·보통·알림 꺼짐으로
// 저장됐다(모델엔 있었다). 앱은 템플릿 '주 3회 60분'을 보여 주고 저장하면 0분이 되던 것.
const PRIORITIES = ['high', 'normal', 'low'];
function projectSettings(src, { partial = false } = {}) {
  const out = {};
  const put = (k, v) => { if (!partial || src[k] !== undefined) out[k] = v; };
  put('duration', Math.max(0, Math.min(1440, Math.round(Number(src.duration) || 0))));
  put('priority', PRIORITIES.includes(src.priority) ? src.priority : 'normal');
  put('notification', !!src.notification);
  put('missedNotification', src.missedNotification === undefined ? true : !!src.missedNotification);
  put('notificationTime', typeof src.notificationTime === 'string' ? src.notificationTime.slice(0, 5) : '');
  put('memo', typeof src.memo === 'string' ? src.memo.slice(0, 2000) : '');
  return out;
}

// 레거시 month 라벨('2026.03' / '2026년 3월' / '2026-03')을 계획 시작주 기준 주차로 환산.
// 2026-08-27 타임라인 주차 전환 이전에 저장된 계획을 읽을 때만 쓴다.
function _weekFromLegacyMonth(monthStr, startDate) {
  if (!monthStr || !startDate) return 1;
  const m = String(monthStr).match(/(\d{4})\s*[년.\-]\s*(\d{1,2})/);
  const sd = String(startDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !sd) return 1;
  const monthFirstDay = new Date(+m[1], +m[2] - 1, 1);
  const start = new Date(+sd[1], +sd[2] - 1, +sd[3]);
  const days = Math.floor((monthFirstDay - start) / 86400000);
  if (days < 0) return 1;            // 계획 시작 전 달이면 1주차로 당긴다
  return Math.floor(days / 7) + 1;
}

// DB { week, projectIds } → FE { week, projects: Project[] } 변환.
// week 가 없는 레거시 문서는 month 로부터 환산해서 내려준다.
function _withPopulatedTimeline(plan) {
  const obj = plan.toObject();
  const projectMap = {};
  for (const p of obj.projects) projectMap[p.id] = p;
  obj.timeline = (obj.timeline || [])
    .map(slot => ({
      week:     slot.week != null ? slot.week : _weekFromLegacyMonth(slot.month, obj.startDate),
      projects: (slot.projectIds || []).map(id => projectMap[id]).filter(Boolean)
    }))
    .filter(slot => slot.projects.length > 0)
    .sort((a, b) => a.week - b.week);
  return obj;
}

// ── STEP 1: POST /api/career-plan ────────────────────────────
// 계획 초안 생성. name/targetJob/startDate/endDate/reviewDay 받음
const createPlan = async (req, res, next) => {
  try {
    const { name, targetJob, startDate, endDate, reviewDay, paceKey, paceHours } = req.body;
    const plan = await CareerPlan.create({
      userUid: req.user.uid,
      name:      name      || '',
      targetJob: targetJob || '',
      startDate: startDate || '',
      endDate:   endDate   || '',
      reviewDay: reviewDay || '',
      paceKey:   ['light', 'steady', 'focus', 'full', 'allin'].includes(paceKey) ? paceKey : '',
      paceHours: Number.isFinite(Number(paceHours)) && paceHours !== null && paceHours !== '' ? Number(paceHours) : null,
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
    const allowed = ['name', 'targetJob', 'startDate', 'endDate', 'reviewDay', 'status', 'paceKey', 'paceHours'];
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
    // 시작 요일(reviewDay)이 바뀌면 주 경계가 바뀐다(2026-10-30~ 한 주 = 시작 요일부터 7일)
    if (update.startDate !== undefined || update.endDate !== undefined || update.reviewDay !== undefined) {
      await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게
    }

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
    // 딸린 주간 일정·실행 기록·커리큘럼 완료·인증사진까지 함께(services/userPurge.purgePlan)
    const deleted = await purgePlan(req.user.uid, planId);
    if (!deleted) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.json({ success: true, message: '계획이 삭제되었습니다', deleted });
  } catch (err) {
    next(err);
  }
};

// ── STEP 2: POST /api/career-plan/:planId/projects ───────────
// 프로젝트 추가
const addProject = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { id, name, category, goal, days, startTime, endTime, curriculum, method, methodDetail } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, error: 'name과 category는 필수입니다' });
    }

    const project = {
      id:         id || crypto.randomUUID(),
      name,
      category,
      goal:       goal       || '',
      days:       days       || [],
      startTime:  startTime  || '',
      endTime:    endTime    || '',
      curriculum: curriculum || [],
      ...projectSettings(req.body),
      ...cleanMethod(method, methodDetail),
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

// ── POST /api/career-plan/:planId/projects/bulk ──────────────
// 프로젝트 일괄 등록 (붙여넣기 후 일괄 동기화용)
const bulkAddProjects = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { projects } = req.body;

    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ success: false, error: 'projects는 비어있지 않은 배열이어야 합니다' });
    }

    const normalized = projects.map(p => ({
      id:         p.id || crypto.randomUUID(),
      name:       p.name || '',
      category:   p.category || 'knowledge',
      goal:       p.goal || '',
      days:       p.days || [],
      startTime:  p.startTime || '',
      endTime:    p.endTime || '',
      curriculum: p.curriculum || [],
      ...projectSettings(p),
      ...cleanMethod(p.method, p.methodDetail),
    })).filter(p => p.name && p.category);

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $push: { projects: { $each: normalized } } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    res.status(201).json({ success: true, projects: normalized, plan });
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
    for (const [k, v] of Object.entries(projectSettings(req.body, { partial: true }))) setFields[`projects.$.${k}`] = v;
    // 진행 방식은 정리해서 함께 바꾼다(방식을 보내지 않으면 그대로 둔다)
    if (req.body.method !== undefined) {
      const { method, methodDetail } = cleanMethod(req.body.method, req.body.methodDetail);
      setFields['projects.$.method'] = method;
      setFields['projects.$.methodDetail'] = methodDetail;
    }

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid, 'projects.id': projId },
      { $set: setFields },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '프로젝트를 찾을 수 없습니다' });
    if (req.body.days !== undefined || req.body.curriculum !== undefined) {
      await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게
    }

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
    await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게

    res.json({ success: true, message: '프로젝트가 삭제되었습니다', plan: _withPopulatedTimeline(plan) });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/career-plan/:planId/routines ───────────────────
// 루틴 추가
const addRoutine = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { id, name, days, duration, notificationTime, notification, memo } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'name은 필수입니다' });
    }

    const routine = {
      id:               id || crypto.randomUUID(),
      name,
      days:             days             || [],
      duration:         duration         ?? 30,
      notificationTime: notificationTime || '09:00',
      notification:     notification     ?? false,
      memo:             memo             || ''
    };

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $push: { routines: routine } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게

    res.status(201).json({ success: true, routine, plan });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/career-plan/:planId/routines/:routineId ─────────
// 루틴 수정
const updateRoutine = async (req, res, next) => {
  try {
    const { planId, routineId } = req.params;
    const allowed = ['name', 'days', 'duration', 'notificationTime', 'notification', 'memo'];
    const setFields = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) setFields[`routines.$.${key}`] = req.body[key];
    }

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid, 'routines.id': routineId },
      { $set: setFields },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '루틴을 찾을 수 없습니다' });
    if (req.body.days !== undefined) {
      await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게
    }

    const updated = plan.routines.find(r => r.id === routineId);
    res.json({ success: true, routine: updated, plan });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/career-plan/:planId/routines/:routineId ──────
// 루틴 삭제
const deleteRoutine = async (req, res, next) => {
  try {
    const { planId, routineId } = req.params;

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $pull: { routines: { id: routineId } } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게

    res.json({ success: true, message: '루틴이 삭제되었습니다', plan });
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

    // FE TimelineSlot { week, projects: Project[] } → DB { week, projectIds: string[] }
    // week 가 유효하지 않은 슬롯은 버린다(구 클라이언트의 month 전송 등).
    const dbTimeline = timeline
      .map(slot => ({
        week:       Number(slot.week),
        projectIds: (slot.projects ?? []).map(p => p.id).filter(Boolean)
      }))
      .filter(slot => Number.isInteger(slot.week) && slot.week >= 1 && slot.projectIds.length > 0)
      .sort((a, b) => a.week - b.week);

    const plan = await CareerPlan.findOneAndUpdate(
      { planId, userUid: req.user.uid },
      { $set: { timeline: dbTimeline, status: 'active' } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    await resetUpcomingSchedules(planId, req.user.uid).catch((e) => console.warn('[schedule-reset]', e?.message)) // 바뀐 계획으로 이번 주부터 다시 만들게

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
  bulkAddProjects,
  updateProject,
  deleteProject,
  addRoutine,
  updateRoutine,
  deleteRoutine,
  saveTimeline,
  getTemplates
};
