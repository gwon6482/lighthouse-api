require('dotenv').config();
const mongoose = require('mongoose');
const { __test__ } = require('../controllers/recommendController');
const { calcTotalMatch, buildUserSurvey, getT3Parts } = __test__;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'user_data' });
  const c = mongoose.connection.getClient();
  const jd = c.db(process.env.JOB_DATA_DB || 'job_data');
  const sd = c.db(process.env.SURVEY_DATA_DB || 'survey_data');
  const t3Parts = await getT3Parts();

  const NEW = await jd.collection('job_info').find({}).toArray();
  const OLD = await jd.collection('job_info_backup_20260926').find({}).toArray();
  const oldByCode = Object.fromEntries(OLD.map(j => [j.jobCode, j]));
  console.log(`신 ${NEW.length}건 / 구 ${OLD.length}건`);

  // 실제 응답 표본 (T1~T3 가 모두 있는 것)
  const results = await sd.collection('survey_results')
    .find({ 'answers.T1': { $exists: true }, 'answers.T23': { $exists: true }, 'answers.T3': { $exists: true } })
    .limit(20).toArray();
  console.log(`검증 응답 ${results.length}건\n`);

  const rank = (jobs, us) => jobs
    .map(j => ({ code: j.jobCode, title: j.title, ...calcTotalMatch(us, j, t3Parts) }))
    .sort((a, b) => b.total - a.total);

  let sumOverlap5 = 0, sumOverlap10 = 0, n = 0;
  const totalsOld = [], totalsNew = [];
  for (const r of results) {
    const us = buildUserSurvey(r);
    const ro = rank(OLD, us), rn = rank(NEW, us);
    const o5 = new Set(ro.slice(0,5).map(x=>x.code)), n5 = new Set(rn.slice(0,5).map(x=>x.code));
    const o10 = new Set(ro.slice(0,10).map(x=>x.code)), n10 = new Set(rn.slice(0,10).map(x=>x.code));
    sumOverlap5 += [...o5].filter(x=>n5.has(x)).length;
    sumOverlap10 += [...o10].filter(x=>n10.has(x)).length;
    totalsOld.push(ro[0].total); totalsNew.push(rn[0].total);
    if (n < 3) {
      console.log(`[${r.survey_id}]`);
      console.log(`  구 TOP5: ${ro.slice(0,5).map(x=>`${x.title}(${x.total.toFixed(3)})`).join(', ')}`);
      console.log(`  신 TOP5: ${rn.slice(0,5).map(x=>`${x.title}(${x.total.toFixed(3)})`).join(', ')}`);
    }
    n++;
  }
  const avg = a => (a.reduce((x,y)=>x+y,0)/a.length);
  console.log(`\n=== 종합 (${n}건) ===`);
  console.log(`  TOP5  겹침 평균: ${(sumOverlap5/n).toFixed(1)}/5  (${(sumOverlap5/n/5*100).toFixed(0)}%)`);
  console.log(`  TOP10 겹침 평균: ${(sumOverlap10/n).toFixed(1)}/10 (${(sumOverlap10/n/10*100).toFixed(0)}%)`);
  console.log(`  1위 점수 평균: 구 ${avg(totalsOld).toFixed(3)} → 신 ${avg(totalsNew).toFixed(3)}`);
  await mongoose.disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
