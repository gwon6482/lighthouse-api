/**
 * 전환 전 크롤링본의 직업 설명을 **원천 컬렉션으로 승격**한다.
 *   job_data.job_info_backup_20260926  →  job_data.job_text_crawled
 *
 * 왜 필요한가:
 * 고용24 공식 API 는 여러 직업을 묶어 조사한 그룹(work24-shared 85건)에 대해
 * **그룹 대표 1명의 설명만** 준다. 그래서 중고등학교 교장 페이지에 "초등학교에서…",
 * 항공운송사무원에 "선박 사업체에서…", 원자력공학기술자에 "태양광발전시스템의…" 이 실린다.
 * 실측: 85건에 대해 서로 다른 overview 가 **29개**(= 그룹 수)뿐이다.
 *
 * 전환 전 크롤링본은 **85건 모두 직업별 고유 설명**을 갖고 있었다(overview 85 / duties 85).
 * 그래서 이 두 필드만 크롤링본을 쓴다.
 *
 * ⚠️ 백업 컬렉션을 직접 읽게 하지 않는다. 백업은 '되돌릴 수단'이지 **적재 의존 대상이 아니다.**
 *    백업을 지우거나 이름을 바꾸는 순간 월간 갱신이 조용히 망가진다.
 *    그래서 별도 컬렉션으로 옮겨 원천으로 삼는다.
 *
 * 한 번만 실행하면 된다. 이후 월간 갱신은 job_text_crawled 를 읽는다.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const SRC = 'job_info_backup_20260926';
const DST = 'job_text_crawled';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const jd = mongoose.connection.getClient().db(process.env.JOB_DATA_DB || 'job_data');

  const names = (await jd.listCollections().toArray()).map((c) => c.name);
  if (!names.includes(SRC)) throw new Error(`${SRC} 가 없다. 크롤링본 백업이 사라졌다면 이 작업은 불가능하다.`);

  const src = await jd.collection(SRC).find({}).toArray();
  const docs = src
    .filter((j) => j.jobCode && (j.overview || j.duties?.length))
    .map((j) => ({
      jobCode: j.jobCode,
      title: j.title ?? null,
      overview: j.overview ?? null,
      duties: Array.isArray(j.duties) ? j.duties : [],
      source: SRC,
      seededAt: new Date(),
    }));

  console.log(`${SRC} ${src.length}건 → 설명 보유 ${docs.length}건`);
  const ovUniq = new Set(docs.map((d) => d.overview)).size;
  console.log(`  서로 다른 overview ${ovUniq}개 (직업별로 고유할수록 좋다)`);

  if (process.argv.includes('--dry')) { console.log('--dry 이므로 쓰지 않는다.'); await mongoose.disconnect(); return; }

  await jd.collection(DST).deleteMany({});
  await jd.collection(DST).insertMany(docs);
  await jd.collection(DST).createIndex({ jobCode: 1 }, { unique: true });
  console.log(`✓ ${DST} 에 ${docs.length}건 적재`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
