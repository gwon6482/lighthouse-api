// 예술·디자인·방송관리자 템플릿만 추가(비파괴) — 전체 재시드 없이 해당 플랜만 upsert.
// 사용: node scripts/apply-art-plan.js
require('dotenv').config();
const dns = require('dns');
const dnsServers = dns.getServers();
if (dnsServers.length === 1 && dnsServers[0] === '127.0.0.1') {
  dns.setServers(['168.126.63.1', '8.8.8.8', '1.1.1.1']);
}
const mongoose = require('mongoose');
const PublicCareerPlan = require('../models/PublicCareerPlan');
const PLANS = require('./seed-public-plans');

const TARGET_JOB = '예술·디자인·방송관리자';

async function run() {
  const plan = PLANS.find(p => p.targetJob === TARGET_JOB);
  if (!plan) throw new Error(`PLANS에서 ${TARGET_JOB} 템플릿을 찾지 못했습니다.`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB 연결');

  const before = await PublicCareerPlan.countDocuments();
  // 동일 이름이 이미 있으면 갱신(중복 방지), 없으면 삽입 — 다른 플랜은 건드리지 않음
  const removed = await PublicCareerPlan.deleteMany({ name: plan.name });
  if (removed.deletedCount) console.log(`↻ 기존 동일 이름 ${removed.deletedCount}건 제거 후 재삽입`);
  await PublicCareerPlan.create(plan);

  const after = await PublicCareerPlan.countDocuments();
  console.log(`✅ '${plan.name}' 적용 완료 (프로젝트 ${plan.projects.length}개)`);
  console.log(`📊 전체 공개 진로계획: ${before} → ${after}`);

  await mongoose.disconnect();
  console.log('✅ 완료');
}

run().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
