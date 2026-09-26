// 회원 데이터 영구 삭제 — **본인 탈퇴와 관리자 삭제가 공유하는 단일 경로.**
//
// ⚠️ 삭제 대상을 늘릴 일이 생기면 반드시 여기만 고칠 것. 호출부마다 따로 지우면
//    컬렉션이 추가됐을 때 한쪽만 고쳐져 조용히 갈라진다(고아 데이터가 남는다).
//
// 2026-09-25 소프트 삭제(isActive=false)에서 전환했다. 개인정보처리방침이 "탈퇴 시 지체 없이
// 파기"라고 공개돼 있는데 문서가 그대로 남아 있었고(법 제21조 파기 의무), 소프트 삭제는
// 같은 소셜 계정 재가입 충돌의 원인이기도 했다.
const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const User = require('../models/User');
const SurveyResult = require('../models/SurveyResult');
const CareerPlan = require('../models/CareerPlan');
const WeeklySchedule = require('../models/WeeklySchedule');
const AchievementRecord = require('../models/AchievementRecord');
const CurriculumCompletion = require('../models/CurriculumCompletion');
const JobReview = require('../models/JobReview');
const { s3Client, UPLOAD_BUCKET, UPLOAD_PREFIX } = require('../config/s3');

// 인증사진 S3 정리.
// 키가 `<prefix>/achievements/<uid>/<uuid>.<ext>` 라서 uid 접두사로 통째로 지울 수 있다.
// ⚠️ DB 의 photoUrl 을 훑지 않는 이유: presigned 업로드만 되고 기록이 안 남은 **고아 파일**도
//    같은 접두사 아래 있어서, 접두사 기준이라야 빠짐없이 지워진다.
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

// 유저 한 명과 딸린 데이터를 전부 지운다. 찾지 못하면 null 을 돌려준다(호출부가 404 를 낸다).
//
// ⚠️ 삭제 순서: 딸린 것 먼저, `users` 문서를 **맨 마지막**에. 중간에 실패하면 계정이 남아 있어
//    재시도할 수 있다. 반대로 하면 재인증이 불가능해져 고아 데이터만 남는다.
// ⚠️ 트랜잭션은 쓰지 않는다. S3 는 트랜잭션에 못 들어가고, DB 3개(user_data/survey_data/
//    job_data)에 걸쳐 있어 얻는 것보다 복잡도가 크다. 순서와 재시도 가능성으로 대신한다.
async function purgeUser(uid) {
  const user = await User.findOne({ uid });
  if (!user) return null;

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

  return { deleted, user };
}

// 단계별 리셋 — 계정은 남기고 특정 단계 **이후**의 데이터만 지운다.
//
// 테스트용이다. 같은 소셜 계정으로는 재가입이 불가능해서(providerId 가 같으면 같은 계정),
// 가입 플로우를 다시 밟으려면 계정을 지우거나 이 리셋이 필요하다.
//
// 단계는 **누적**이다 — 앞 단계로 되돌리면 그 뒤 단계의 데이터도 전부 사라진다.
//   design  : 진로설계 이후 (계획·일정·달성기록·커리큘럼·인증사진)
//   survey  : 자기이해 검사 이후 (검사결과·추천직업·북마크·목표진로) + design
//   signup  : 가입 위저드 이후 (이름·나이·성별·가입설문) + survey + design
//
// ⚠️ **`signup` 리셋이 위저드를 다시 띄우는 것은 소셜 계정뿐이다.**
//    앱 진입 가드(`shared/router/app.ts`)가 `socialOnly && !onboarding.answeredAt` 일 때만
//    위저드로 보낸다. 이메일 계정은 onboarding 을 지워도 /main/before 로 간다.
//    가드를 "local 이 없으면 소셜"로 뒤집으면 authProviders 가 빈 옛 계정이 위저드에 갇힌다.
const RESET_STAGES = ['design', 'survey', 'signup'];

async function resetUserToStage(uid, stage) {
  if (!RESET_STAGES.includes(stage)) {
    throw Object.assign(new Error(`알 수 없는 단계: ${stage}`), { status: 400 });
  }

  const user = await User.findOne({ uid });
  if (!user) return null;

  const cleared = {};

  // ── design 단계: 진로설계·달성 데이터 (모든 리셋에 공통으로 포함된다)
  cleared.photos = await deleteUserUploads(uid);
  cleared.achievementRecords = (await AchievementRecord.deleteMany({ userUid: uid })).deletedCount;
  cleared.curriculumCompletions = (await CurriculumCompletion.deleteMany({ userUid: uid })).deletedCount;
  cleared.weeklySchedules = (await WeeklySchedule.deleteMany({ userUid: uid })).deletedCount;
  cleared.careerPlans = (await CareerPlan.deleteMany({ userUid: uid })).deletedCount;

  const unset = {};
  const set = {};

  // ── survey 단계: 검사 결과와 그 파생물
  if (stage === 'survey' || stage === 'signup') {
    const surveyIds = Array.isArray(user.surveyResults) ? user.surveyResults : [];
    const filter = surveyIds.length > 0
      ? { $or: [{ survey_id: { $in: surveyIds } }, { respondent_id: uid }] }
      : { respondent_id: uid };
    cleared.surveyResults = (await SurveyResult.deleteMany(filter)).deletedCount;

    set.surveyResults = [];
    set.recommendedJobs = [];
    set.bookmarkedJobs = [];
    unset.targetCareer = 1;
  }

  // ── signup 단계: 위저드에서 받는 것들
  if (stage === 'signup') {
    unset.name = 1;
    unset.age = 1;
    unset.gender = 1;
    unset.onboarding = 1;   // 앱 가드가 보는 값(answeredAt)이 여기 들어 있다
  }

  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  if (Object.keys(update).length > 0) {
    // ⚠️ save() 가 아니라 updateOne 이다. save() 는 문서 전체 검증을 다시 돌려서,
    //    옛 계정에 스키마와 어긋난 값이 하나라도 있으면 리셋 자체가 실패한다.
    await User.updateOne({ uid }, update);
  }

  return { cleared, user, stage };
}

module.exports = { purgeUser, deleteUserUploads, resetUserToStage, RESET_STAGES };
