const User = require('../models/User');
const SurveyResult = require('../models/SurveyResult');
const CareerPlan = require('../models/CareerPlan');
const WeeklySchedule = require('../models/WeeklySchedule');
const AchievementRecord = require('../models/AchievementRecord');
const CurriculumCompletion = require('../models/CurriculumCompletion');
const JobReview = require('../models/JobReview');
const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { s3Client, UPLOAD_BUCKET, UPLOAD_PREFIX } = require('../config/s3');
const mongoose = require('mongoose');

// job_data DB 모델 (중복 컴파일 방지)
const getJobInfoModel = () => {
  const db = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data');
  try {
    return db.model('JobInfo');
  } catch {
    return db.model('JobInfo', new mongoose.Schema({}, { strict: false }), 'job_info');
  }
};

// GET /api/user/profile
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }
    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// PUT /api/user/profile
// 수정 가능 필드: settings (중첩 병합), 향후 nickname 등 추가 예정
const updateProfile = async (req, res, next) => {
  try {
    const { settings } = req.body;

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    if (settings !== undefined) {
      if (settings.notifications !== undefined) {
        if (settings.notifications.push !== undefined) {
          user.settings.notifications.push = settings.notifications.push;
        }
        if (settings.notifications.email !== undefined) {
          user.settings.notifications.email = settings.notifications.email;
        }
      }
      if (settings.language !== undefined) user.settings.language = settings.language;
      if (settings.theme !== undefined) user.settings.theme = settings.theme;
    }

    await user.save();
    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// 인증사진 S3 정리.
// 키가 `<prefix>/achievements/<uid>/<uuid>.<ext>` 라서 uid 접두사로 통째로 지울 수 있다.
// DB 의 photoUrl 을 훑지 않는 이유: 업로드(presigned)만 되고 기록이 안 남은 **고아 파일**도
// 같은 접두사 아래 있어서, 접두사 기준이라야 빠짐없이 지워진다.
async function deleteUserUploads(uid) {
  const Prefix = `${UPLOAD_PREFIX}/achievements/${uid}/`;
  let deleted = 0;
  let ContinuationToken;

  do {
    const listed = await s3Client.send(new ListObjectsV2Command({
      Bucket: UPLOAD_BUCKET, Prefix, ContinuationToken
    }));
    const objects = (listed.Contents || []).map((o) => ({ Key: o.Key }));

    if (objects.length > 0) {
      // DeleteObjects 는 1회 1000개가 상한이다. ListObjectsV2 도 기본 1000개라 그대로 맞는다.
      const res = await s3Client.send(new DeleteObjectsCommand({
        Bucket: UPLOAD_BUCKET, Delete: { Objects: objects, Quiet: true }
      }));
      if (res.Errors && res.Errors.length > 0) {
        throw new Error(`S3 삭제 실패 ${res.Errors.length}건: ${res.Errors[0].Message}`);
      }
      deleted += objects.length;
    }
    ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return deleted;
}

// DELETE /api/user
// **하드 삭제** — 계정과 딸린 데이터를 영구 삭제한다.
//
// 2026-09-25 소프트 삭제(isActive=false)에서 전환. 두 가지 이유가 있다.
//  1) 개인정보처리방침이 "탈퇴 시 지체 없이 파기"라고 공개돼 있는데 문서가 그대로 남아 있었다.
//     보유기간 경과·목적 달성 시 파기는 법 제21조 의무라 문구만 고쳐서 해결될 문제가 아니었다.
//  2) 문서가 남으면 **같은 소셜 계정으로 재가입할 때 충돌한다**(authProviders 가 살아있으므로).
//
// ⚠️ 삭제 순서: 딸린 것 먼저, `users` 문서를 **맨 마지막**에. 중간에 실패하면 계정이 남아 있어
//    같은 토큰으로 재시도할 수 있다. 반대로 하면 재인증이 불가능해져 고아 데이터만 남는다.
// ⚠️ 트랜잭션은 쓰지 않는다. S3 는 어차피 트랜잭션에 못 들어가고, DB 3개(user_data/survey_data/
//    job_data)에 걸쳐 있어 얻는 것보다 복잡도가 크다. 순서와 재시도 가능성으로 대신한다.
const deleteAccount = async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const deleted = {};

    // 1) S3 인증사진. DB 기록을 지우기 전에 먼저 — 기록이 사라지면 대조할 방법이 없다.
    deleted.photos = await deleteUserUploads(uid);

    // 2) 검사 결과. survey_id 로 걸리는 것과 respondent_id 로 걸리는 것을 **둘 다** 본다.
    //    respondent_id 는 클라이언트가 보낸 값이라 비어 있을 수 있어 한쪽만 믿으면 놓친다.
    const surveyIds = Array.isArray(user.surveyResults) ? user.surveyResults : [];
    const surveyFilter = surveyIds.length > 0
      ? { $or: [{ survey_id: { $in: surveyIds } }, { respondent_id: uid }] }
      : { respondent_id: uid };
    deleted.surveyResults = (await SurveyResult.deleteMany(surveyFilter)).deletedCount;

    // 3) 직업 후기는 **지우지 않고 익명화**한다. 후기 본문은 다른 이용자가 보는 공개 정보이고,
    //    개인을 식별하는 것은 submitterEmail 하나뿐이다. 그것만 비우면 개인정보는 남지 않는다.
    //    (이메일 없는 소셜 계정은 연결고리 자체가 없어 대상이 없다)
    deleted.reviewsAnonymized = user.email
      ? (await JobReview.updateMany({ submitterEmail: user.email }, { $set: { submitterEmail: '' } })).modifiedCount
      : 0;

    // 4) 진로설계·달성 데이터
    deleted.achievementRecords = (await AchievementRecord.deleteMany({ userUid: uid })).deletedCount;
    deleted.curriculumCompletions = (await CurriculumCompletion.deleteMany({ userUid: uid })).deletedCount;
    deleted.weeklySchedules = (await WeeklySchedule.deleteMany({ userUid: uid })).deletedCount;
    deleted.careerPlans = (await CareerPlan.deleteMany({ userUid: uid })).deletedCount;

    // 5) 계정 문서 — 반드시 마지막
    await User.deleteOne({ uid });

    res.json({ success: true, message: '계정과 관련 데이터가 모두 삭제되었습니다', deleted });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/survey-results
// 설문 완료 후 survey_id를 유저에 연결
const addSurveyResult = async (req, res, next) => {
  try {
    const { survey_id } = req.body;
    if (!survey_id) {
      return res.status(400).json({ success: false, error: 'survey_id가 필요합니다' });
    }

    const survey = await SurveyResult.findOne({ survey_id });
    if (!survey) {
      return res.status(404).json({ success: false, error: '존재하지 않는 survey_id입니다' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    if (user.surveyResults.includes(survey_id)) {
      return res.status(409).json({ success: false, error: '이미 연결된 survey_id입니다' });
    }

    user.surveyResults.push(survey_id);
    await user.save();

    res.status(201).json({
      success: true,
      surveyResults: user.surveyResults,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/survey-results
// 유저에 연결된 설문 결과 목록 조회 (메타 정보 포함)
const getSurveyResults = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    if (user.surveyResults.length === 0) {
      return res.json({ success: true, surveyResults: [] });
    }

    const results = await SurveyResult.find(
      { survey_id: { $in: user.surveyResults } },
      { survey_id: 1, submitted_at: 1, T1_result: 1, _id: 0 }
    ).lean();

    res.json({ success: true, surveyResults: results });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/bookmarks
const getBookmarks = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    if (user.bookmarkedJobs.length === 0) {
      return res.json({ success: true, bookmarkedJobs: [] });
    }

    // job_data DB에서 직업 상세정보 조회
    const JobInfo = getJobInfoModel();
    const jobs = await JobInfo.find(
      { jobCode: { $in: user.bookmarkedJobs } },
      { jobCode: 1, title: 1, classification: 1, salary: 1, jobSatisfaction: 1, _id: 0 }
    ).lean();

    res.json({ success: true, bookmarkedJobs: jobs });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/bookmarks/:jobCode
const addBookmark = async (req, res, next) => {
  try {
    const { jobCode } = req.params;

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    if (user.bookmarkedJobs.includes(jobCode)) {
      return res.status(409).json({ success: false, error: '이미 북마크된 직업입니다' });
    }

    // jobCode 유효성 확인
    const JobInfo = getJobInfoModel();
    const job = await JobInfo.findOne({ jobCode }).lean();
    if (!job) {
      return res.status(404).json({ success: false, error: '존재하지 않는 직업 코드입니다' });
    }

    user.bookmarkedJobs.push(jobCode);
    await user.save();

    res.status(201).json({ success: true, bookmarkedJobs: user.bookmarkedJobs });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/user/bookmarks/:jobCode
const removeBookmark = async (req, res, next) => {
  try {
    const { jobCode } = req.params;

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const idx = user.bookmarkedJobs.indexOf(jobCode);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '북마크되지 않은 직업입니다' });
    }

    user.bookmarkedJobs.splice(idx, 1);
    await user.save();

    res.json({ success: true, bookmarkedJobs: user.bookmarkedJobs });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/recommended-jobs
const saveRecommendedJobs = async (req, res, next) => {
  try {
    const { jobCodes } = req.body;
    if (!Array.isArray(jobCodes)) {
      return res.status(400).json({ success: false, error: 'jobCodes 배열이 필요합니다' });
    }
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }
    user.recommendedJobs = jobCodes.slice(0, 30);
    await user.save();
    res.json({ success: true, recommendedJobs: user.recommendedJobs });
  } catch (err) {
    next(err);
  }
};

// GET /api/user/target-career — 목표 진로 조회
// refType === 'jobCode'이면 job_info에서 직업 정보도 함께 반환
const getTargetCareer = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const tc = user.targetCareer;
    if (!tc?.ref) {
      return res.json({ success: true, targetCareer: null });
    }

    if (tc.refType === 'jobCode') {
      const JobInfo = getJobInfoModel();
      const job = await JobInfo.findOne(
        { jobCode: tc.ref },
        { jobCode: 1, title: 1, classification: 1 }
      ).lean();
      return res.json({
        success: true,
        targetCareer: {
          refType: 'jobCode',
          ref: tc.ref,
          title: job?.title ?? tc.ref,
          classification: job?.classification ?? null,
        },
      });
    }

    // custom 타입 (추후 custom_career 컬렉션 조회로 교체)
    return res.json({
      success: true,
      targetCareer: { refType: 'custom', ref: tc.ref, title: null },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/user/target-career — 목표 진로 설정/변경/삭제
// body: { refType: 'jobCode'|'custom', ref: string } 또는 null (삭제)
const setTargetCareer = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const body = req.body; // null이면 삭제
    if (body === null || body === undefined || !body.ref) {
      user.targetCareer = undefined;
      await user.save();
      return res.json({ success: true, targetCareer: null });
    }

    const { refType, ref } = body;
    if (!['jobCode', 'custom'].includes(refType)) {
      return res.status(400).json({ success: false, error: 'refType은 jobCode 또는 custom이어야 합니다' });
    }
    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ success: false, error: 'ref 값이 필요합니다' });
    }

    if (refType === 'jobCode') {
      const JobInfo = getJobInfoModel();
      const exists = await JobInfo.exists({ jobCode: ref });
      if (!exists) {
        return res.status(404).json({ success: false, error: '존재하지 않는 jobCode입니다' });
      }
    }

    user.targetCareer = { refType, ref };
    await user.save();

    res.json({ success: true, targetCareer: { refType, ref } });
  } catch (err) {
    next(err);
  }
};

// POST /api/user/devices — FCM 기기 토큰 등록/갱신
const registerDevice = async (req, res, next) => {
  try {
    const { deviceToken, platform, deviceId } = req.body;
    if (!deviceToken || !platform || !deviceId) {
      return res.status(400).json({ success: false, error: 'deviceToken, platform, deviceId가 필요합니다' });
    }
    if (!['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({ success: false, error: 'platform은 ios, android, web 중 하나여야 합니다' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const existingIdx = user.devices.findIndex(d => d.deviceId === deviceId);
    if (existingIdx >= 0) {
      // 기존 기기 토큰 갱신
      user.devices[existingIdx].deviceToken = deviceToken;
      user.devices[existingIdx].platform = platform;
      user.devices[existingIdx].lastActiveAt = new Date();
    } else {
      user.devices.push({ deviceToken, platform, deviceId });
    }

    await user.save();
    res.status(201).json({ success: true, devices: user.devices });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/user/devices/:deviceId — 기기 토큰 제거 (로그아웃 시)
const removeDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    const before = user.devices.length;
    user.devices = user.devices.filter(d => d.deviceId !== deviceId);

    if (user.devices.length === before) {
      return res.status(404).json({ success: false, error: '등록되지 않은 기기입니다' });
    }

    await user.save();
    res.json({ success: true, devices: user.devices });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile, updateProfile, deleteAccount,
  addSurveyResult, getSurveyResults,
  getBookmarks, addBookmark, removeBookmark,
  saveRecommendedJobs,
  getTargetCareer, setTargetCareer,
  registerDevice, removeDevice,
};
