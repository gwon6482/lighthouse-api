// GET /api/job/:jobCode/recruitment — 진로백과 '채용' 탭. 출처별 채용공고를 한 모양으로(services/recruit)
const mongoose = require('mongoose');
const { getRecruitment } = require('../services/recruit');

const jobInfo = () => mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info');
const MAX_LIMIT = 20;

const getJobRecruitment = async (req, res, next) => {
  try {
    const { jobCode } = req.params;
    if (!/^\d{6}$/.test(jobCode)) return res.status(400).json({ success: false, error: 'jobCode 형식이 올바르지 않습니다.' });
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 10));

    // 출처마다 필요한 연결 정보만 읽는다(고용24 = KECO)
    const job = await jobInfo().findOne({ jobCode }, { projection: { _id: 0, jobCode: 1, title: 1, 'work24.keco': 1 } });
    if (!job) return res.status(404).json({ success: false, error: '직업을 찾을 수 없습니다.' });

    const data = await getRecruitment(job, { limit });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = { getJobRecruitment };
