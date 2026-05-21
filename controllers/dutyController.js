const Duty = require('../models/Duty');

// GET /api/duties?q=&limit=20
const searchDuties = async (req, res, next) => {
  try {
    const { q, limit = 20 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 100);

    let query = { isActive: true };
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { keywords: { $regex: q, $options: 'i' } }
      ];
    }

    const duties = await Duty.find(query).limit(limitNum).sort({ name: 1 });
    res.json({ success: true, duties, total: duties.length });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/duties
const createDuty = async (req, res, next) => {
  try {
    const { name, category, keywords } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name은 필수입니다' });

    const duty = await Duty.create({ name, category: category || '', keywords: keywords || [] });
    res.status(201).json({ success: true, duty });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/duties/:id
const updateDuty = async (req, res, next) => {
  try {
    const allowed = ['name', 'category', 'keywords', 'isActive'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    const duty = await Duty.findOneAndUpdate({ dutyId: req.params.id }, { $set: update }, { new: true });
    if (!duty) return res.status(404).json({ success: false, error: '직무를 찾을 수 없습니다' });

    res.json({ success: true, duty });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/duties/:id
const deleteDuty = async (req, res, next) => {
  try {
    const duty = await Duty.findOneAndUpdate(
      { dutyId: req.params.id },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!duty) return res.status(404).json({ success: false, error: '직무를 찾을 수 없습니다' });
    res.json({ success: true, message: '직무가 비활성화되었습니다' });
  } catch (err) {
    next(err);
  }
};

module.exports = { searchDuties, createDuty, updateDuty, deleteDuty };
