#!/usr/bin/env node
/**
 * 고용24 직업정보 전량 수집 → job_data.work24_raw 에 **원문 그대로** 적재.
 *
 * 변환(코드 매핑·스키마 정규화)은 하지 않는다. 원문을 남겨야
 * 나중에 변환 규칙이 바뀌어도 **재수집 없이 다시 만들 수 있다.**
 *
 * 사용:
 *   WORK24_KEY=... MONGODB_URI=... node scripts/work24-collect.js
 *   node scripts/work24-collect.js --resume     # 이미 받은 건 건너뛴다
 *   node scripts/work24-collect.js --limit 10   # 소량 시험
 *
 * ⚠️ 480직업 × 7섹션 = 3,360 호출, 약 24분(초당 ~2.5회).
 *    한도가 공개돼 있지 않아 client.js 가 스스로 속도를 억제한다. 병렬화하지 말 것.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { fetchJobList, fetchJobDetailAll } = require('../services/work24/jobApi');
const jobMapping = require('../services/work24/jobMapping.json');

const args = process.argv.slice(2);
const RESUME = args.includes('--resume');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : null; })();

(async () => {
  if (!process.env.WORK24_KEY) throw new Error('WORK24_KEY 미설정');
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const db = mongoose.connection.getClient().db(process.env.JOB_DATA_DB || 'job_data');
  const raw = db.collection('work24_raw');
  await raw.createIndex({ jobCd: 1 }, { unique: true });

  // 우리 매핑이 실제로 쓰는 API 직업만 받는다. 492 전부 받을 이유가 없다.
  const needed = [...new Set(Object.values(jobMapping.mapping).map((m) => m.jobCd))];
  console.log(`매핑이 참조하는 API 직업: ${needed.length}종`);

  // 목록도 한 번 받아 이름·분류를 같이 저장한다(나중 대조용).
  const { list } = await fetchJobList();
  const meta = Object.fromEntries(list.map((j) => [j.jobCd, j]));
  const missing = needed.filter((cd) => !meta[cd]);
  if (missing.length) console.warn(`⚠️ 목록에 없는 jobCd ${missing.length}건: ${missing.slice(0, 5).join(', ')}`);

  let targets = needed;
  if (RESUME) {
    const done = new Set((await raw.find({}, { projection: { jobCd: 1 } }).toArray()).map((d) => d.jobCd));
    targets = needed.filter((cd) => !done.has(cd));
    console.log(`--resume: 완료 ${done.size}건 건너뜀 → 남은 ${targets.length}건`);
  }
  if (LIMIT) targets = targets.slice(0, LIMIT);

  const t0 = Date.now();
  let ok = 0; const failed = [];
  for (const [i, jobCd] of targets.entries()) {
    try {
      const detail = await fetchJobDetailAll(jobCd);
      await raw.replaceOne(
        { jobCd },
        { jobCd, meta: meta[jobCd] ?? null, detail, collectedAt: new Date() },
        { upsert: true },
      );
      ok++;
    } catch (err) {
      failed.push({ jobCd, error: err.message });
      console.error(`  ✗ ${jobCd}: ${err.message}`);
    }
    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      const el = (Date.now() - t0) / 1000;
      const eta = targets.length > i + 1 ? ((el / (i + 1)) * (targets.length - i - 1) / 60).toFixed(1) : '0';
      console.log(`  ${i + 1}/${targets.length}  성공 ${ok} 실패 ${failed.length}  경과 ${(el / 60).toFixed(1)}분  남은 ~${eta}분`);
    }
  }

  console.log(`\n완료: 성공 ${ok} / 실패 ${failed.length} / 총 ${(Date.now() - t0) / 1000 / 60 | 0}분`);
  if (failed.length) {
    console.log('실패 목록(=> --resume 으로 재시도 가능):');
    failed.forEach((f) => console.log(`  ${f.jobCd}: ${f.error}`));
  }
  console.log(`work24_raw 총 ${await raw.countDocuments()}건`);
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
