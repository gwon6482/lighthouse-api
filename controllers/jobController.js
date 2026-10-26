const mongoose = require('mongoose');
const escapeRegex = require('../utils/escapeRegex');

// career_attributes code → name 맵 (첫 조회 후 캐싱)
let _codeNameCache = null;
async function getCodeNameMap() {
  if (_codeNameCache) return _codeNameCache;
  const refDb = mongoose.connection.useDb(process.env.REFERENCE_DATA_DB || 'reference_data');
  const attrs = await refDb.collection('career_attributes')
    .find({}, { projection: { code: 1, name: 1, _id: 0 } }).toArray();
  _codeNameCache = Object.fromEntries(attrs.map(a => [a.code, a.name]));
  return _codeNameCache;
}

// details 항목에 name 필드 추가 (code → name 역변환)
function enrichDetails(details, codeNameMap) {
  if (!details) return details;
  const result = {};
  for (const [catKey, catData] of Object.entries(details)) {
    result[catKey] = {};
    for (const [perspective, subObj] of Object.entries(catData)) {
      result[catKey][perspective] = {};
      for (const [scope, items] of Object.entries(subObj)) {
        result[catKey][perspective][scope] = Array.isArray(items)
          ? items.map(item => ({ ...item, name: codeNameMap[item.code] ?? item.code }))
          : items;
      }
    }
  }
  return result;
}

const getJobModel = () => {
  const jobDb = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data');
  const modelName = 'JobData';

  if (jobDb.models[modelName]) {
    return jobDb.models[modelName];
  }

  const schema = new mongoose.Schema({}, { strict: false });
  return jobDb.model(modelName, schema, 'job_info');
};

const getJobByCode = async (req, res, next) => {
  try {
    const { jobCode } = req.params;

    // jobCode 형식 검증 (6자리 숫자)
    if (!/^\d{6}$/.test(jobCode)) {
      return res.status(400).json({
        success: false,
        error: 'jobCode 형식이 올바르지 않습니다. 6자리 숫자여야 합니다.',
        received: jobCode
      });
    }

    // DB 연결 상태 확인
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: '데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    const [Job, codeNameMap] = await Promise.all([
      Promise.resolve(getJobModel()),
      getCodeNameMap(),
    ]);
    const job = await Job.findOne({ jobCode }).lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        error: `jobCode '${jobCode}'에 해당하는 직업을 찾을 수 없습니다.`
      });
    }

    res.json({
      success: true,
      data: { ...job, details: enrichDetails(job.details, codeNameMap) }
    });
  } catch (error) {
    // MongoDB 타임아웃
    if (error.name === 'MongoNetworkTimeoutError' || error.name === 'MongoTimeoutError') {
      return res.status(504).json({
        success: false,
        error: '데이터베이스 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    next(error);
  }
};

const searchJobByName = async (req, res, next) => {
  try {
    const { name } = req.query;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'name 쿼리 파라미터가 필요합니다.'
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: '데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    const Job = getJobModel();
    const jobs = await Job.find(
      { title: { $regex: escapeRegex(name.trim()), $options: 'i' } },
      { jobCode: 1, title: 1, 'classification.primary': 1, 'classification.secondary': 1, _id: 0 }
    ).lean();

    if (jobs.length === 0) {
      return res.status(404).json({
        success: false,
        error: `'${name}'에 해당하는 직업을 찾을 수 없습니다.`
      });
    }

    res.json({
      success: true,
      count: jobs.length,
      data: jobs
    });
  } catch (error) {
    next(error);
  }
};

const getJobList = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: '데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 50;
    if (limit > 100) limit = 100;
    if (page < 1) page = 1;

    const filter = {};
    if (req.query.primary) filter['classification.primary'] = req.query.primary;
    if (req.query.secondary) filter['classification.secondary'] = req.query.secondary;
    if (req.query.major) filter['relatedMajors'] = req.query.major;

    const Job = getJobModel();
    const total = await Job.countDocuments(filter);
    const jobs = await Job.find(filter, {
      jobCode: 1,
      title: 1,
      'classification.primary': 1,
      'classification.secondary': 1,
      salary: 1,
      jobSatisfaction: 1,
      relatedMajors: 1,
      relatedCertifications: 1,
      _id: 0
    })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      count: total,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(total / limit),
        total_items: total,
        items_per_page: limit
      },
      data: jobs
    });
  } catch (error) {
    next(error);
  }
};

const createJob = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: '데이터베이스에 연결할 수 없습니다.' });
    }

    const { jobCode } = req.body;
    if (!jobCode || !/^\d{6}$/.test(jobCode)) {
      return res.status(400).json({ success: false, error: 'jobCode는 6자리 숫자여야 합니다.' });
    }

    const Job = getJobModel();
    const existing = await Job.findOne({ jobCode }).lean();
    if (existing) {
      return res.status(409).json({ success: false, error: `jobCode '${jobCode}'가 이미 존재합니다.` });
    }

    const job = await Job.create(req.body);
    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const updateJob = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: '데이터베이스에 연결할 수 없습니다.' });
    }

    const { jobCode } = req.params;
    if (!/^\d{6}$/.test(jobCode)) {
      return res.status(400).json({ success: false, error: 'jobCode 형식이 올바르지 않습니다.' });
    }

    // jobCode 자체는 변경 불가
    delete req.body.jobCode;

    const Job = getJobModel();
    const updated = await Job.findOneAndUpdate(
      { jobCode },
      { $set: req.body },
      { new: true, lean: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: `jobCode '${jobCode}'에 해당하는 직업을 찾을 수 없습니다.` });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteJob = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: '데이터베이스에 연결할 수 없습니다.' });
    }

    const { jobCode } = req.params;
    if (!/^\d{6}$/.test(jobCode)) {
      return res.status(400).json({ success: false, error: 'jobCode 형식이 올바르지 않습니다.' });
    }

    const Job = getJobModel();
    const deleted = await Job.findOneAndDelete({ jobCode }).lean();

    if (!deleted) {
      return res.status(404).json({ success: false, error: `jobCode '${jobCode}'에 해당하는 직업을 찾을 수 없습니다.` });
    }

    res.json({ success: true, message: `jobCode '${jobCode}' 직업이 삭제되었습니다.` });
  } catch (error) {
    next(error);
  }
};

const getClassifications = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: '데이터베이스에 연결할 수 없습니다.' });
    }

    const Job = getJobModel();
    const jobs = await Job.find(
      {},
      { 'classification.primary': 1, 'classification.secondary': 1, _id: 0 }
    ).lean();

    const tree = {};
    for (const { classification } of jobs) {
      if (!classification) continue;
      const { primary, secondary } = classification;
      if (!primary) continue;
      if (!tree[primary]) tree[primary] = new Set();
      if (secondary) tree[primary].add(secondary.trim());
    }

    const result = {};
    for (const [primary, secondaries] of Object.entries(tree)) {
      result[primary] = [...secondaries].sort();
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getMajors = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: '데이터베이스에 연결할 수 없습니다.' });
    }

    const Job = getJobModel();
    const majors = await Job.distinct('relatedMajors');
    const filtered = majors.filter(m => m && m.trim() !== '').sort();

    res.json({ success: true, count: filtered.length, data: filtered });
  } catch (error) {
    next(error);
  }
};

module.exports = { getJobByCode, searchJobByName, getJobList, createJob, updateJob, deleteJob, getClassifications, getMajors };
