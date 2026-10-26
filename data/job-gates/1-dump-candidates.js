require(process.cwd() + '/node_modules/dotenv').config({ path: process.cwd() + '/.env' });
const mongoose = require(process.cwd() + '/node_modules/mongoose');
const fs = require('fs');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info');
  const all = await col.find({}, { projection: { jobCode: 1, title: 1, 'work24.way': 1, 'work24.education': 1, relatedCertifications: 1 } }).toArray();
  const RE = /면허|국가시험|국가고시|임용|공무원|자격(증)?을? ?(반드시 )?(취득|소지)해야|졸업해야|졸업하여야|졸업한 후|이수해야|이수하여야|수련|실무경력|경력이 ?\d+년|\d+년 이상의? ?(실무 ?)?경력|체력|신체검사|변호사시험|법학전문대학원|로스쿨|교원자격|교사자격|교직|사범|승진|공개경쟁|공채|선발시험|선발 시험|채용시험|필기시험|등록해야|합격해야|합격하여야/;
  const cand = all.filter((j) => RE.test(j.work24?.way || ''));
  fs.writeFileSync(process.argv[2], JSON.stringify(cand.map((j) => ({ jobCode: j.jobCode, title: j.title, way: j.work24?.way || '', certs: (j.relatedCertifications || []).slice(0, 8) })), null, 1));
  console.log('total', all.length, 'candidates', cand.length, 'no-way', all.filter((j) => !j.work24?.way).length);
  await mongoose.disconnect();
})();
