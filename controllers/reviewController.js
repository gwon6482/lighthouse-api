const JobReview = require('../models/JobReview');

// GET /api/job/:jobCode/reviews — 승인된 후기 목록 (FE용)
const getApprovedReviews = async (req, res) => {
  try {
    const { jobCode } = req.params;
    const reviews = await JobReview.find({ jobCode, status: 'approved' })
      .select('-adminNote -submitterEmail -respondentId -consentAt -__v') // 🔒 respondentId 로 결과지를 열 수 있다
      .sort({ createdAt: -1 });

    res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/job/:jobCode/reviews — 사용자 후기 제출
const submitReview = async (req, res) => {
  try {
    const { jobCode } = req.params;
    const { summary, satisfaction, pros, cons, recommendation, personalityTags, submitterEmail } = req.body;

    if (!summary || satisfaction == null || !pros || !cons || !recommendation) {
      return res.status(400).json({ success: false, message: '필수 항목이 누락되었습니다.' });
    }

    const review = await JobReview.create({
      jobCode,
      summary,
      satisfaction,
      pros,
      cons,
      recommendation,
      personalityTags: personalityTags || [],
      status: 'pending',
      submittedBy: 'user',
      submitterEmail: submitterEmail || '',
    });

    res.status(201).json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/admin/reviews — 전체 후기 목록 (status 필터, 어드민용)
const getAdminReviews = async (req, res) => {
  try {
    const { status, jobCode, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status)) filter.status = status;
    if (jobCode) filter.jobCode = jobCode;

    const skip = (Number(page) - 1) * Number(limit);
    const [reviews, total] = await Promise.all([
      JobReview.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      JobReview.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count: total,
      pagination: {
        current_page: Number(page),
        total_pages: Math.ceil(total / Number(limit)),
        total_items: total,
        items_per_page: Number(limit),
      },
      data: reviews,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/admin/reviews — 어드민 직접 입력 (status: approved)
const createAdminReview = async (req, res) => {
  try {
    const { jobCode, summary, satisfaction, pros, cons, recommendation, personalityTags, adminNote } = req.body;

    if (!jobCode || !summary || satisfaction == null || !pros || !cons || !recommendation) {
      return res.status(400).json({ success: false, message: '필수 항목이 누락되었습니다.' });
    }

    const review = await JobReview.create({
      jobCode,
      summary,
      satisfaction,
      pros,
      cons,
      recommendation,
      personalityTags: personalityTags || [],
      status: 'approved',
      submittedBy: 'admin',
      adminNote: adminNote || '',
    });

    res.status(201).json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/admin/reviews/:id — 승인 / 반려 / 내용 수정
const updateAdminReview = async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = ['status', 'summary', 'satisfaction', 'pros', 'cons', 'recommendation', 'personalityTags', 'adminNote', 'preparation', 'dailyLife'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: '수정할 항목이 없습니다.' });
    }

    const review = await JobReview.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!review) return res.status(404).json({ success: false, message: '후기를 찾을 수 없습니다.' });

    res.json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/admin/reviews/:id — 삭제
const deleteAdminReview = async (req, res) => {
  try {
    const { id } = req.params;
    const review = await JobReview.findByIdAndDelete(id);
    if (!review) return res.status(404).json({ success: false, message: '후기를 찾을 수 없습니다.' });

    res.json({ success: true, message: '후기가 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getApprovedReviews,
  submitReview,
  getAdminReviews,
  createAdminReview,
  updateAdminReview,
  deleteAdminReview,
};
