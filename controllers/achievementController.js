const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const AchievementRecord = require('../models/AchievementRecord');
const CurriculumCompletion = require('../models/CurriculumCompletion');
const CareerPlan = require('../models/CareerPlan');
const { s3Client, UPLOAD_BUCKET, UPLOAD_PREFIX, publicUrlForKey } = require('../config/s3');

// 본인 plan 인지 확인 (소유권 검증) — weeklyScheduleController 와 동일 패턴
async function ensureOwnedPlan(planId, userUid) {
  return await CareerPlan.findOne({ planId, userUid });
}

// ── 달성 기록 ────────────────────────────────────────────────

// GET /api/career-plan/:planId/achievements?from=&to=
// from/to (YYYY-MM-DD) 범위 조회. 없으면 전체. doneAt desc (피드) 정렬.
const listAchievements = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { from, to } = req.query;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const query = { planId, userUid: req.user.uid };
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }

    const records = await AchievementRecord.find(query).sort({ date: -1, doneAt: -1 });
    res.json({ success: true, records: records.map(r => r.toObject()) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/career-plan/:planId/achievements/:date/:itemType/:itemId
// upsert. body 로 받은 필드를 그대로 반영 (단순 done 토글 ~ 전체 인증 기록).
const upsertAchievement = async (req, res, next) => {
  try {
    const { planId, date, itemType, itemId } = req.params;
    if (!['project', 'routine'].includes(itemType)) {
      return res.status(400).json({ success: false, error: 'itemType 은 project|routine' });
    }
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const allowed = [
      'done', 'itemName', 'itemCategory', 'duration', 'elapsedSec',
      'doneAt', 'photoUrl', 'difficulty', 'note', 'curriculumWeek'
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    const record = await AchievementRecord.findOneAndUpdate(
      { userUid: req.user.uid, planId, date, itemType, itemId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, record: record.toObject() });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/career-plan/:planId/achievements/:date/:itemType/:itemId
const deleteAchievement = async (req, res, next) => {
  try {
    const { planId, date, itemType, itemId } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    await AchievementRecord.deleteOne({ userUid: req.user.uid, planId, date, itemType, itemId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ── 커리큘럼 완료 ────────────────────────────────────────────

// GET /api/career-plan/:planId/curriculum
const listCurriculum = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const items = await CurriculumCompletion.find({ planId, userUid: req.user.uid });
    res.json({ success: true, items: items.map(i => i.toObject()) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/career-plan/:planId/curriculum/:projectId/:week/:idx
// body: { done: boolean }. done=false 면 삭제(토글 off), 그 외 upsert.
const upsertCurriculum = async (req, res, next) => {
  try {
    const { planId, projectId } = req.params;
    const week = Number(req.params.week);
    const idx = Number(req.params.idx);
    if (Number.isNaN(week) || Number.isNaN(idx)) {
      return res.status(400).json({ success: false, error: 'week, idx 는 숫자' });
    }
    const plan = await ensureOwnedPlan(planId, req.user.uid);
    if (!plan) return res.status(404).json({ success: false, error: '계획을 찾을 수 없습니다' });

    const done = req.body.done !== false;   // 기본 true
    const filter = { userUid: req.user.uid, planId, projectId, week, idx };

    if (!done) {
      await CurriculumCompletion.deleteOne(filter);
      return res.json({ success: true, done: false });
    }

    const item = await CurriculumCompletion.findOneAndUpdate(
      filter,
      { $set: { done: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, item: item.toObject() });
  } catch (err) {
    next(err);
  }
};

// ── S3 presigned 업로드 ──────────────────────────────────────

// POST /api/career-plan/uploads/presign
// body: { contentType }  → { uploadUrl, fileUrl, key }
// 클라이언트는 uploadUrl 로 PUT(같은 Content-Type) 후 fileUrl 을 기록에 저장.
const presignUpload = async (req, res, next) => {
  try {
    const contentType = req.body.contentType || 'image/jpeg';
    const ext = contentType === 'image/png' ? 'png'
      : contentType === 'image/webp' ? 'webp'
      : 'jpg';
    const key = `${UPLOAD_PREFIX}/achievements/${req.user.uid}/${crypto.randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: key,
      ContentType: contentType
    });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });  // 5분

    res.json({
      success: true,
      uploadUrl,
      fileUrl: publicUrlForKey(key),
      key
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listAchievements,
  upsertAchievement,
  deleteAchievement,
  listCurriculum,
  upsertCurriculum,
  presignUpload
};
