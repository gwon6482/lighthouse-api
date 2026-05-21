const mongoose = require('mongoose');
const crypto = require('crypto');

const DutySchema = new mongoose.Schema({
  dutyId: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },
  name:     { type: String, required: true, trim: true },
  category: { type: String, default: '' },
  keywords: { type: [String], default: [] },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

DutySchema.index({ name: 'text', keywords: 'text' });
DutySchema.index({ isActive: 1 });

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('Duty', DutySchema, 'duties');
