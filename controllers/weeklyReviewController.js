const WeeklyReview = require('../models/WeeklyReview');
const CareerPlan = require('../models/CareerPlan');

const isDateKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const PACE_KEYS = ['', 'light', 'steady', 'focus', 'full', 'allin'];

async function ownedPlan(planId, userUid) {
  return CareerPlan.findOne({ planId, userUid }, { planId: 1 }).lean();
}

// GET /api/career-plan/:planId/weekly-reviews — 마친 결산만(최신 주부터). ?all=1 이면 팝업만 본 주도
const listReviews = async (req, res, next) => {
  try {
    const { planId } = req.params;
    if (!(await ownedPlan(planId, req.user.uid))) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    const q = { planId, userUid: req.user.uid };
    if (req.query.all !== '1') q.completedAt = { $ne: null };
    const reviews = await WeeklyReview.find(q).sort({ weekStart: -1 }).lean();
    res.json({ success: true, reviews });
  } catch (err) { next(err); }
};

// GET /api/career-plan/:planId/weekly-reviews/:weekStart — 없으면 null
const getReview = async (req, res, next) => {
  try {
    const { planId, weekStart } = req.params;
    if (!(await ownedPlan(planId, req.user.uid))) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    const review = await WeeklyReview.findOne({ planId, userUid: req.user.uid, weekStart }).lean();
    res.json({ success: true, review: review ?? null });
  } catch (err) { next(err); }
};

// PUT /api/career-plan/:planId/weekly-reviews/:weekStart — 있으면 고치고 없으면 만든다
// body: { weekEnd, weekNo, prompted:true } 또는 결산 마침 { complete:true, satisfaction, note, pledge, feel, paceFrom, paceTo, endDateFrom, endDateTo, stats }
const upsertReview = async (req, res, next) => {
  try {
    const { planId, weekStart } = req.params;
    if (!isDateKey(weekStart)) return res.status(400).json({ success: false, error: 'weekStart 는 YYYY-MM-DD' });
    if (!(await ownedPlan(planId, req.user.uid))) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });
    const b = req.body || {};
    const set = {};
    if (isDateKey(b.weekEnd)) set.weekEnd = b.weekEnd;
    if (Number.isInteger(b.weekNo)) set.weekNo = b.weekNo;
    if (b.prompted) set.promptedAt = new Date();
    if (b.complete) {
      const sat = Number(b.satisfaction);
      if (!(sat >= 1 && sat <= 5)) return res.status(400).json({ success: false, error: '만족도는 1~5' });
      set.completedAt = new Date();
      set.satisfaction = Math.round(sat);
      set.note = String(b.note ?? '').slice(0, 200);
      set.pledge = String(b.pledge ?? '').slice(0, 200);
      set.feel = ['tight', 'fit', 'loose'].includes(b.feel) ? b.feel : '';
      set.paceFrom = PACE_KEYS.includes(b.paceFrom) ? b.paceFrom : '';
      set.paceTo = PACE_KEYS.includes(b.paceTo) ? b.paceTo : '';
      set.endDateFrom = isDateKey(b.endDateFrom) ? b.endDateFrom : '';
      set.endDateTo = isDateKey(b.endDateTo) ? b.endDateTo : '';
      const s = b.stats || {};
      const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
      set.stats = {
        planned: num(s.planned), done: num(s.done), percent: Math.min(100, num(s.percent)),
        fullDays: num(s.fullDays), workDays: num(s.workDays), minutes: num(s.minutes), photos: num(s.photos), streak: num(s.streak),
        progressBefore: Math.min(100, num(s.progressBefore)), progressAfter: Math.min(100, num(s.progressAfter)), gainItems: num(s.gainItems),
      };
    }
    const review = await WeeklyReview.findOneAndUpdate(
      { planId, userUid: req.user.uid, weekStart },
      { $set: set, $setOnInsert: { planId, userUid: req.user.uid, weekStart } },
      { new: true, upsert: true },
    ).lean();
    res.json({ success: true, review });
  } catch (err) { next(err); }
};

module.exports = { listReviews, getReview, upsertReview };
