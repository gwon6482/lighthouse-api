const mongoose = require('mongoose');
const escapeRegex = require('../utils/escapeRegex');

// 컬렉션별 ID 필드명 매핑
const COLLECTION_ID_FIELDS = {
  'T1_personality': 'question_id',
  'T2_1_talent': 'question_id',
  'T2_2_interest': 'field_id',
  'T2_3_values': 'value_id',
  'T3_environmental': 'part_code'
};

// 동적 모델 생성 함수
const getQuestionModel = (collectionType) => {
  // 컬렉션별 스키마 정의
  const baseSchema = {
    created_at: {
      type: Date,
      default: Date.now
    },
    version: {
      type: String,
      default: '1.0'
    }
  };

  // 컬렉션별 필드 추가
  switch (collectionType) {
    case 'T1_personality':
    case 'T2_1_talent':
      Object.assign(baseSchema, {
        question_id: { type: String, required: true, unique: true, index: true },
        collection_code: String,
        upper_element_code: String,
        upper_element_name: String,
        upper_element_definition: String,
        sub_element_code: String,
        sub_element_name: String,
        sub_element_definition: String,
        question_text: String
      });
      break;
    
    case 'T2_2_interest':
      Object.assign(baseSchema, {
        field_id: { type: String, required: true, unique: true, index: true },
        collection_code: String,
        upper_field_code: String,
        upper_field_name: String,
        field_code: String,
        field_name: String,
        field_definition: String
      });
      break;
    
    case 'T2_3_values':
      Object.assign(baseSchema, {
        value_id: { type: String, required: true, unique: true, index: true },
        collection_code: String,
        value_name: String,
        value_code: String,
        value_definition: String,
        value_question: String
      });
      break;
    
    case 'T3_environmental':
      Object.assign(baseSchema, {
        part_code:     { type: String, required: true, unique: true, index: true },
        collection_code: String,
        part_name:     String,
        part_question: String,
        levels:        [{ level: Number, description: String }],
        related_WE:    { type: mongoose.Schema.Types.Mixed }
      });
      break;
  }

  const questionSchema = new mongoose.Schema(baseSchema, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
  });

  // ID 필드에 대한 인덱스 설정
  const idField = COLLECTION_ID_FIELDS[collectionType];
  if (idField) {
    questionSchema.index({ [idField]: 1 });
  }

  // 가상 필드: 통일된 ID 접근
  questionSchema.virtual('id').get(function() {
    return this[COLLECTION_ID_FIELDS[collectionType]] || this._id;
  });

  // JSON 변환 시 가상 필드 포함
  questionSchema.set('toJSON', { virtuals: true });

  // survey_questions 데이터베이스 사용
  const surveyQuestionsDb = mongoose.connection.useDb(process.env.SURVEY_QUESTIONS_DB || 'survey_questions');
  return surveyQuestionsDb.model(collectionType, questionSchema, collectionType);
};

// 컬렉션 타입 검증
const validateCollectionType = (collectionType) => {
  return Object.keys(COLLECTION_ID_FIELDS).includes(collectionType);
};

// ID 필드명 가져오기
const getIdField = (collectionType) => {
  return COLLECTION_ID_FIELDS[collectionType];
};

// 모든 질문 조회 (페이지네이션, 필터링 지원)
const getAllQuestions = async (req, res) => {
  try {
    const { collection_type } = req.params;
    const {
      page = 1,
      limit = 10,
      search
    } = req.query;

    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    const idField = getIdField(collection_type);

    // 필터 조건 구성
    const filter = {};
    
    if (search) {
      // 컬렉션별 검색 필드 정의
      const searchFields = [];
      
      switch (collection_type) {
        case 'T1_personality':
        case 'T2_1_talent':
          searchFields.push(
            { question_id: { $regex: escapeRegex(search), $options: 'i' } },
            { question_text: { $regex: escapeRegex(search), $options: 'i' } },
            { upper_element_name: { $regex: escapeRegex(search), $options: 'i' } },
            { sub_element_name: { $regex: escapeRegex(search), $options: 'i' } }
          );
          break;
        case 'T2_2_interest':
          searchFields.push(
            { field_id: { $regex: escapeRegex(search), $options: 'i' } },
            { field_name: { $regex: escapeRegex(search), $options: 'i' } },
            { upper_field_name: { $regex: escapeRegex(search), $options: 'i' } }
          );
          break;
        case 'T2_3_values':
          searchFields.push(
            { value_id: { $regex: escapeRegex(search), $options: 'i' } },
            { value_name: { $regex: escapeRegex(search), $options: 'i' } },
            { value_question: { $regex: escapeRegex(search), $options: 'i' } }
          );
          break;
        case 'T3_environmental':
          searchFields.push(
            { part_code: { $regex: escapeRegex(search), $options: 'i' } },
            { part_name: { $regex: escapeRegex(search), $options: 'i' } },
            { part_question: { $regex: escapeRegex(search), $options: 'i' } }
          );
          break;
      }
      
      if (searchFields.length > 0) {
        filter.$or = searchFields;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const questions = await Question.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Question.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      collection_type,
      id_field: idField,
      data: questions,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_items: total,
        items_per_page: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('질문 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '질문 조회 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 질문 ID로 개별 질문 조회
const getQuestionById = async (req, res) => {
  try {
    const { collection_type, question_id } = req.params;
    
    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    const idField = getIdField(collection_type);
    
    const filter = { [idField]: question_id };
    const question = await Question.findOne(filter).lean();
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: '질문을 찾을 수 없습니다',
        collection_type,
        id_field: idField,
        question_id
      });
    }

    res.json({
      success: true,
      collection_type,
      id_field: idField,
      data: question
    });
  } catch (error) {
    console.error('질문 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '질문 조회 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 새 질문 생성
const createQuestion = async (req, res) => {
  try {
    const { collection_type } = req.params;
    const questionData = req.body;

    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    const idField = getIdField(collection_type);

    // ID 필드 검증
    if (!questionData[idField]) {
      return res.status(400).json({
        success: false,
        error: `필수 필드가 누락되었습니다: ${idField}`,
        required_fields: [idField]
      });
    }

    // ID 중복 확인
    const existingQuestion = await Question.findOne({ [idField]: questionData[idField] });
    if (existingQuestion) {
      return res.status(409).json({
        success: false,
        error: '이미 존재하는 ID입니다',
        collection_type,
        id_field: idField,
        question_id: questionData[idField]
      });
    }

    const newQuestion = new Question(questionData);
    const savedQuestion = await newQuestion.save();

    res.status(201).json({
      success: true,
      message: '질문이 성공적으로 생성되었습니다',
      collection_type,
      id_field: idField,
      data: savedQuestion
    });
  } catch (error) {
    console.error('질문 생성 오류:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: '데이터 검증 오류',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      error: '질문 생성 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 질문 업데이트
const updateQuestion = async (req, res) => {
  try {
    const { collection_type, question_id } = req.params;
    const updateData = req.body;

    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    const idField = getIdField(collection_type);

    // 업데이트 불가능한 필드 제거
    delete updateData[idField];
    delete updateData.created_at;
    delete updateData._id;

    const filter = { [idField]: question_id };
    const question = await Question.findOneAndUpdate(
      filter,
      updateData,
      { new: true, runValidators: true }
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        error: '업데이트할 질문을 찾을 수 없습니다',
        collection_type,
        id_field: idField,
        question_id
      });
    }

    res.json({
      success: true,
      message: '질문이 성공적으로 업데이트되었습니다',
      collection_type,
      id_field: idField,
      data: question
    });
  } catch (error) {
    console.error('질문 업데이트 오류:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: '데이터 검증 오류',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      error: '질문 업데이트 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 질문 삭제
const deleteQuestion = async (req, res) => {
  try {
    const { collection_type, question_id } = req.params;
    const { permanent = false } = req.query;

    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    const idField = getIdField(collection_type);
    const filter = { [idField]: question_id };

    if (permanent === 'true') {
      // 영구 삭제
      const question = await Question.findOneAndDelete(filter);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: '삭제할 질문을 찾을 수 없습니다',
          collection_type,
          id_field: idField,
          question_id
        });
      }

      res.json({
        success: true,
        message: '질문이 영구적으로 삭제되었습니다',
        collection_type,
        id_field: idField,
        deleted_question_id: question_id
      });
    } else {
      // 소프트 삭제 (is_active = false) - 지원하지 않는 컬렉션의 경우 영구 삭제
      const question = await Question.findOneAndDelete(filter);

      if (!question) {
        return res.status(404).json({
          success: false,
          error: '삭제할 질문을 찾을 수 없습니다',
          collection_type,
          id_field: idField,
          question_id
        });
      }

      res.json({
        success: true,
        message: '질문이 삭제되었습니다',
        collection_type,
        id_field: idField,
        deleted_question_id: question_id
      });
    }
  } catch (error) {
    console.error('질문 삭제 오류:', error);
    res.status(500).json({
      success: false,
      error: '질문 삭제 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 컬렉션별 통계 정보
const getQuestionStats = async (req, res) => {
  try {
    const { collection_type } = req.params;

    if (!validateCollectionType(collection_type)) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 컬렉션 타입입니다',
        valid_types: Object.keys(COLLECTION_ID_FIELDS)
      });
    }

    const Question = getQuestionModel(collection_type);
    
    const stats = await Question.aggregate([
      {
        $group: {
          _id: null,
          total_questions: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      collection_type,
      data: stats[0] || {
        total_questions: 0
      }
    });
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '통계 조회 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 전체 통계 정보 (모든 컬렉션)
const getAllStats = async (req, res) => {
  try {
    const validTypes = Object.keys(COLLECTION_ID_FIELDS);
    const allStats = [];

    for (const collectionType of validTypes) {
      try {
        const Question = getQuestionModel(collectionType);
        const stats = await Question.aggregate([
          {
            $group: {
              _id: null,
              total_questions: { $sum: 1 }
            }
          }
        ]);

        allStats.push({
          collection_type: collectionType,
          id_field: COLLECTION_ID_FIELDS[collectionType],
          ...(stats[0] || {
            total_questions: 0
          })
        });
      } catch (error) {
        // 컬렉션이 존재하지 않는 경우
        allStats.push({
          collection_type: collectionType,
          id_field: COLLECTION_ID_FIELDS[collectionType],
          total_questions: 0
        });
      }
    }

    // 전체 합계 계산
    const totalStats = allStats.reduce((acc, stat) => {
      acc.total_questions += stat.total_questions;
      return acc;
    }, { total_questions: 0 });

    res.json({
      success: true,
      data: {
        by_collection: allStats,
        total: totalStats
      }
    });
  } catch (error) {
    console.error('전체 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '전체 통계 조회 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// T1 유형 목록 조회 (GET /api/admin/t1-types)
const getAdminT1Types = async (req, res) => {
  try {
    const T1Type = require('../models/T1Type');
    const { base_type, modifier_type } = req.query;
    const filter = {};
    if (base_type) filter.base_type = base_type.toUpperCase();
    if (modifier_type) filter.modifier_type = modifier_type.toUpperCase();
    const types = await T1Type.find(filter, '-__v').sort({ type_code: 1 }).lean();
    res.json({ success: true, count: types.length, data: types });
  } catch (error) {
    console.error('T1 유형 조회 오류:', error);
    res.status(500).json({ success: false, error: 'T1 유형 조회 중 오류가 발생했습니다', message: error.message });
  }
};

// T1 유형 수정 (PUT /api/admin/t1-types/:type_code)
const updateAdminT1Type = async (req, res) => {
  try {
    const T1Type = require('../models/T1Type');
    const type_code = req.params.type_code.toUpperCase();
    delete req.body.type_code; // type_code 변경 불가
    delete req.body.base_type;
    delete req.body.modifier_type;
    delete req.body.modifier_element;

    const updated = await T1Type.findOneAndUpdate(
      { type_code },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: `type_code '${type_code}'에 해당하는 유형을 찾을 수 없습니다.` });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('T1 유형 수정 오류:', error);
    res.status(500).json({ success: false, error: 'T1 유형 수정 중 오류가 발생했습니다', message: error.message });
  }
};

module.exports = {
  getAllQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestionStats,
  getAllStats,
  getQuestionModel,
  getAdminT1Types,
  updateAdminT1Type
}; 