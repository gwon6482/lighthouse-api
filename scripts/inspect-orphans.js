// 읽기 전용 — survey_results 와 S3 의 고아 데이터를 성격별로 분류한다. 아무것도 수정하지 않는다.
// ⚠️ 버킷/DB 는 로컬 .env 가 아니라 **프로덕션 값**을 명시적으로 쓴다.
//    config/s3.js 의 기본값은 lighthouse-career-fe 라서 그대로 두면 엉뚱한 버킷을 본다
//    (프로덕션은 deploy.yml 이 S3_UPLOAD_BUCKET=lighthouse-uploads 를 주입한다).
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const PROD_BUCKET = 'lighthouse-uploads';
const PROD_PREFIX = 'uploads';
const s3 = new S3Client({ region: 'ap-northeast-2' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const client = mongoose.connection.getClient();
  const ud = client.db('user_data');
  const sd = client.db('survey_data');

  const users = await ud.collection('users')
    .find({}, { projection: { uid: 1, surveyResults: 1 } }).toArray();
  const liveUids = new Set(users.map((u) => u.uid));
  const claimed = new Set(users.flatMap((u) => u.surveyResults || []));

  const all = await sd.collection('survey_results')
    .find({}, { projection: { survey_id: 1, respondent_id: 1, submitted_at: 1 } }).toArray();
  const orphans = all.filter((d) =>
    !claimed.has(d.survey_id) && (!d.respondent_id || !liveUids.has(d.respondent_id)));

  // 성격별 분류 — 무엇이 '지워도 되는 개인정보'인지 가른다
  const bucket = { seed: [], guest: [], uuid: [], other: [] };
  for (const d of orphans) {
    const r = d.respondent_id || '';
    if (/^test_\d+_/.test(r)) bucket.seed.push(d);
    else if (/^user_\d+$/.test(r)) bucket.guest.push(d);
    else if (UUID_RE.test(r)) bucket.uuid.push(d);       // ← 삭제된 실계정의 잔여물일 수 있다
    else bucket.other.push(d);
  }

  console.log(`유저 ${users.length}명 / survey_results 총 ${all.length}건 / 고아 ${orphans.length}건\n`);
  console.log('── 고아의 성격별 분류 ──');
  console.log(`  시드 데이터  (test_N_이름)  ${bucket.seed.length}건  → scripts/seed_test_responses.js 산물. 개인정보 아님`);
  console.log(`  비회원 응답  (user_<숫자>)  ${bucket.guest.length}건  → 로그인 없이 제출된 검사. 계정과 무관`);
  console.log(`  UUID 형식                  ${bucket.uuid.length}건  ★ 삭제된 실계정 잔여물 가능성`);
  console.log(`  기타                       ${bucket.other.length}건`);

  for (const [label, arr] of [['UUID', bucket.uuid], ['기타', bucket.other]]) {
    if (arr.length === 0) continue;
    console.log(`\n  [${label}] 상세:`);
    for (const d of arr.slice(0, 20)) {
      console.log(`    respondent_id=${d.respondent_id} survey_id=${d.survey_id} submitted=${d.submitted_at ? new Date(d.submitted_at).toISOString().slice(0,10) : '-'}`);
    }
  }

  // S3 — 프로덕션 버킷
  console.log(`\n── S3 ${PROD_BUCKET}/${PROD_PREFIX}/achievements/ ──`);
  const perUid = {};
  let token, total = 0;
  try {
    do {
      const r = await s3.send(new ListObjectsV2Command({
        Bucket: PROD_BUCKET, Prefix: `${PROD_PREFIX}/achievements/`, ContinuationToken: token,
      }));
      for (const o of r.Contents || []) {
        total++;
        const m = o.Key.match(/achievements\/([^/]+)\//);
        const uid = m ? m[1] : '(형식불일치)';
        perUid[uid] = perUid[uid] || { n: 0, bytes: 0 };
        perUid[uid].n++; perUid[uid].bytes += o.Size || 0;
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  } catch (e) {
    console.log(`  ⚠️ 조회 실패: ${e.name} ${e.message}`);
  }
  console.log(`  객체 ${total}개 / uid 폴더 ${Object.keys(perUid).length}개`);
  let on = 0, ob = 0;
  for (const [uid, v] of Object.entries(perUid)) {
    const live = liveUids.has(uid);
    if (!live) { on += v.n; ob += v.bytes; }
    console.log(`    ${uid}  ${String(v.n).padStart(3)}개 ${(v.bytes/1024).toFixed(0)}KB  [${live ? 'LIVE' : '★고아'}]`);
  }
  console.log(`  → 고아 객체 ${on}개 (${(ob/1024).toFixed(0)}KB)`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
