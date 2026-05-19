const mongoose = require('mongoose');
const { getQuestionModel } = require('./adminController');
const SurveyResult = require('../models/SurveyResult');
const SurveyQuestionnaire = require('../models/SurveyQuestionnaire');
const SurveyStatistics = require('../models/SurveyStatistics');
const T1Type = require('../models/T1Type');
const CareerAttribute = require('../models/CareerAttribute');
const T3_RESULT_TEXTS = require('../config/t3ResultTexts');

// 전체 설문지 조회 (GET)
const getSurveyForm = async (req, res) => {
  // 1. survey_id 자동생성 (SURVyyyyMMddD_HHmmssT)
  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const survey_id = `SURV${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}D_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}T`;

  // 2. 클라이언트 정보 추출
  const client_info = {
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
    user_agent: req.headers['user-agent'] || '',
    etc: ''
  };

  // 3. 설문지 DB 저장
  try {
    await SurveyQuestionnaire.create({
      survey_id,
      client_info,
      created_at: now
    });
  } catch (e) {
    console.error('설문지 메타정보 저장 오류:', e);
    // 저장 실패해도 설문지는 제공
  }

  // 임시 고정값
  const twoValues = [4, 8];
  const fiveValues = [2, 4, 5, 8, 9];

  try {
    const T1Model = getQuestionModel('T1_personality');
    const T21Model = getQuestionModel('T2_1_talent');
    const T22Model = getQuestionModel('T2_2_interest');
    const T23Model = getQuestionModel('T2_3_values');
    const T3Model = getQuestionModel('T3_environmental');

    // 모든 모델 조회를 병렬로 실행하여 성능 최적화
    const [rawT1, rawT21, t22Items, t23Items, t3Items] = await Promise.all([
      T1Model.find({}).sort({ question_id: 1 }).lean(),
      T21Model.find({}).sort({ question_id: 1 }).lean(),
      T22Model.find({}).sort({ field_id: 1 }).lean(),
      T23Model.find({}).sort({ value_id: 1 }).lean(),
      T3Model.find({}).sort({ part_code: 1 }).lean()
    ]);

    // 1. T1 (T1_personality) 가공
    let t1Questions = rawT1;
    // 시드 기반 셔플
    t1Questions = seededShuffle(t1Questions, survey_id);
    // 페이지 분할: 7,7,7,7,7,8
    const t1PageSizes = [7, 7, 7, 7, 7, 8];
    let t1Idx = 0;
    let t1NumCounter = 1;
    const t1Pages = t1PageSizes.map((size, i) => {
      const page = t1Questions.slice(t1Idx, t1Idx + size).map((q) => ({
        question_num: (t1NumCounter++).toString(),
        question_id: q.question_id,
        question_text: q.question_text
      }));
      t1Idx += size;
      return page;
    });
    const t1Part = { survey_part: 'T1' };
    t1Pages.forEach((page, i) => {
      t1Part[`page_T1_${i + 1}`] = page;
    });

    // 2. T21 (T2_1_talent) 가공
    let t21Questions = rawT21;
    // 시드 기반 셔플
    t21Questions = seededShuffle(t21Questions, survey_id);
    // 페이지 분할: 10,10,10,10,10,11
    const t21PageSizes = [10, 10, 10, 10, 10, 11];
    let t21Idx = 0;
    let t21NumCounter = 1;
    const t21Pages = t21PageSizes.map((size) => {
      const page = t21Questions.slice(t21Idx, t21Idx + size).map((q) => ({
        question_num: (t21NumCounter++).toString(),
        question_id: q.question_id,
        question_text: q.question_text
      }));
      t21Idx += size;
      return page;
    });
    const t21Part = { survey_part: 'T21' };
    t21Pages.forEach((page, i) => {
      t21Part[`page_T21_${i + 1}`] = page;
    });

    // 3. T22 (T2_2_interest)
    const t22Part = {
      survey_part: 'T22',
      items: t22Items.map(item => ({
        item_id: item.field_id,
        item_name: item.field_name,
        item_text: item.field_definition || ''
      }))
    };

    // 4. T23 (T2_3_values)
    const t23Part = {
      survey_part: 'T23',
      items: t23Items.map(item => ({
        item_id: item.value_id,
        item_text: item.value_question,
        item_definition: item.value_definition || ''
      }))
    };

    // 5. T3 (T3_environmental)
    const t3Part = {
      survey_part: 'T3',
      items: t3Items.map(item => ({
        item_id: item.part_code,
        item_name: item.part_name,
        item_question: item.part_question || '',
        levels: item.levels || []
      }))
    };

    // 최종 survey 배열
    const survey = [t1Part, t21Part, t22Part, t23Part, t3Part];

    res.json({
      survey_id,
      '2_values': twoValues,
      '5_values': fiveValues,
      survey
    });
  } catch (error) {
    console.error('설문지 반환 오류:', error);
    res.status(500).json({
      success: false,
      error: '설문지 반환 중 오류가 발생했습니다',
      message: error.message
    });
  }
};

// 설문 응답 제출 (POST)
const submitSurveyResponse = async (req, res) => {
  try {
    const data = req.body;
    if (!data.survey_id || !data.answers) {
      return res.status(400).json({ success: false, error: 'survey_id와 answers는 필수입니다.' });
    }

    // 1. 기존 통계치에서 환산값 받아오기
    let statistics = await SurveyStatistics.findOne({}).sort({ generated_at: -1 });
    if (!statistics) {
      // 통계치가 없으면 새로 생성
      statistics = {
        total_surveys: 0,
        question_stats: {},
        last_survey_id: null
      };
    }
    // [디버깅] 기존 통계치 출력
    // console.log('==== 기존 통계치(T23, T3) ====');
    // Object.entries(statistics.question_stats || {}).forEach(([k, v]) => {
    //   if (k.startsWith('T23_') || k.startsWith('T3_')) {
    //     console.log(k, v);
    //   }
    // });

    // 2. 환산 응답 생성 (공식 적용)
    const converted_answers = convertAnswers(data.answers, statistics, data.answer_type);
    // console.log('converted_answers:', converted_answers);

    // 3. T1 유형 계산 (저장 전)
    let T1_result = null;
    if (data.answers.T1) {
      const t1GroupScores = calcT1GroupScores(data.answers.T1, data.answer_type);
      const t1TypeCalc = calcT1Type(t1GroupScores);
      if (t1TypeCalc) {
        const typeDoc = await T1Type.findOne({ type_code: t1TypeCalc.type_code }, '-_id -__v').lean();
        T1_result = {
          ...t1TypeCalc,
          ...(typeDoc ? {
            base_name: typeDoc.base_name,
            modifier: typeDoc.modifier,
            full_name: typeDoc.full_name,
            description: typeDoc.description
          } : {})
        };
      }
    }

    // 4. 응답원본 + 환산응답 + T1_result DB에 업로드
    const saved = await SurveyResult.create({
      survey_id: data.survey_id,
      respondent_id: data.respondent_id || null,
      answers: data.answers,
      converted_answers,
      T1_result,
      raw_payload: data,
      submitted_at: new Date()
    });
    //console.log('save:', saved);


    // 5. 기존 통계치에 응답값을 반영해서 항목별 통계치를 업데이트 (평균, 표준편차 실제 갱신)
    const updatedStats = JSON.parse(JSON.stringify(statistics)); // deep copy
    delete updatedStats._id; // _id 중복 방지
    updatedStats.total_surveys = (updatedStats.total_surveys || 0) + 1;
    updatedStats.last_survey_id = data.survey_id;
    if (!updatedStats.question_stats) updatedStats.question_stats = {};
    // 누적 전, 기존 통계치에 M2가 없으면 계산해서 넣기
    for (const [qid, stat] of Object.entries(updatedStats.question_stats)) {
      if (stat.count > 1 && (stat.M2 === undefined || stat.M2 === null)) {
        stat.M2 = Math.pow(stat.stddev || 0, 2) * (stat.count - 1);
      }
    }
    // T1, T21: answer_type에 따라 정규화 후 Welford 누적 (0~1 스케일 통일)
    for (const part of ['T1', 'T21']) {
      if (data.answers[part]) {
        for (const [qid, value] of Object.entries(data.answers[part])) {
          const score = normalizeScore(value, data.answer_type);
          if (score === null) continue;

          if (!updatedStats.question_stats[qid]) {
            updatedStats.question_stats[qid] = { count: 0, mean: 0, stddev: 0, M2: 0 };
          }
          const stat = updatedStats.question_stats[qid];

          const prevCount = stat.count || 0;
          const prevMean = stat.mean || 0;
          const prevM2 = stat.M2 || 0;

          const newCount = prevCount + 1;
          const delta = score - prevMean;
          const newMean = prevMean + delta / newCount;
          const newM2 = prevM2 + delta * (score - newMean);
          const newStddev = newCount > 1 ? Math.sqrt(newM2 / (newCount - 1)) : 0;

          stat.count = newCount;
          stat.mean = newMean;
          stat.stddev = newStddev;
          stat.M2 = newM2;
        }
      }
    }
    // T22: checked 카운트 누적 및 채택률(adoption_rate) 계산
    if (data.answers.T22 && Array.isArray(data.answers.T22.checked)) {
      for (const itemId of data.answers.T22.checked) {
        if (!updatedStats.question_stats[itemId]) {
          updatedStats.question_stats[itemId] = { count: 0 };
        }
        updatedStats.question_stats[itemId].count = (updatedStats.question_stats[itemId].count || 0) + 1;
      }
    }
    // T22: 채택률(adoption_rate) 계산
    for (const [qid, stat] of Object.entries(updatedStats.question_stats)) {
      if (qid.startsWith('T22_') && stat.count !== undefined && updatedStats.total_surveys) {
        stat.adoption_rate = stat.count / updatedStats.total_surveys;
      }
    }
    // T23: priority별 카운트 누적 (배열/단일값 모두 지원, 구조 보장)
    if (data.answers.T23) {
      for (const p of ['priority_1', 'priority_2', 'priority_3']) {
        const items = data.answers.T23[p];
        if (Array.isArray(items)) {
          for (const itemId of items) {
            if (!updatedStats.question_stats[itemId]) {
              updatedStats.question_stats[itemId] = {};
            }
            updatedStats.question_stats[itemId][p] = (updatedStats.question_stats[itemId][p] || 0) + 1;
          }
        } else if (items) {
          // 단일 값일 경우도 처리
          const itemId = items;
          if (!updatedStats.question_stats[itemId]) {
            updatedStats.question_stats[itemId] = {};
          }
          updatedStats.question_stats[itemId][p] = (updatedStats.question_stats[itemId][p] || 0) + 1;
        }
      }
    }
    // T3: 파트별 레벨(1~5) Welford 누적
    if (data.answers.T3) {
      for (const [partCode, level] of Object.entries(data.answers.T3)) {
        const score = Number(level);
        if (isNaN(score) || score < 1 || score > 5) continue;
        if (!updatedStats.question_stats[partCode]) {
          updatedStats.question_stats[partCode] = { count: 0, mean: 0, stddev: 0, M2: 0 };
        }
        const stat = updatedStats.question_stats[partCode];
        const prevCount = stat.count || 0;
        const prevMean = stat.mean || 0;
        const prevM2 = stat.M2 || 0;
        const newCount = prevCount + 1;
        const delta = score - prevMean;
        const newMean = prevMean + delta / newCount;
        const newM2 = prevM2 + delta * (score - newMean);
        stat.count = newCount;
        stat.mean = newMean;
        stat.stddev = newCount > 1 ? Math.sqrt(newM2 / (newCount - 1)) : 0;
        stat.M2 = newM2;
      }
    }
    // T1, T21 그룹별 통계 누적
    // 각 응답자의 그룹 내 질문 정규화 점수 평균 → 그룹 단위 Welford 누적
    if (!updatedStats.group_stats) updatedStats.group_stats = {};
    const groupScores = {}; // { 'T1_A': [0.75, 0.25, ...], 'T21_L': [...], ... }
    for (const [part, prefix] of [['T1', 'T1'], ['T21', 'T21']]) {
      if (!data.answers[part]) continue;
      for (const [qid, value] of Object.entries(data.answers[part])) {
        const match = qid.match(new RegExp(`^${prefix}_([A-Z])`));
        if (!match) continue;
        const groupKey = `${prefix}_${match[1]}`;
        const score = normalizeScore(value, data.answer_type);
        if (score === null) continue;
        if (!groupScores[groupKey]) groupScores[groupKey] = [];
        groupScores[groupKey].push(score);
      }
    }
    for (const [groupKey, scores] of Object.entries(groupScores)) {
      if (scores.length === 0) continue;
      const personGroupMean = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (!updatedStats.group_stats[groupKey]) {
        updatedStats.group_stats[groupKey] = { count: 0, mean: 0, stddev: 0, M2: 0 };
      }
      const stat = updatedStats.group_stats[groupKey];
      const prevCount = stat.count || 0;
      const prevMean = stat.mean || 0;
      const prevM2 = stat.M2 || 0;
      const newCount = prevCount + 1;
      const delta = personGroupMean - prevMean;
      const newMean = prevMean + delta / newCount;
      const newM2 = prevM2 + delta * (personGroupMean - newMean);
      const newStddev = newCount > 1 ? Math.sqrt(newM2 / (newCount - 1)) : 0;
      stat.count = newCount;
      stat.mean = newMean;
      stat.stddev = newStddev;
      stat.M2 = newM2;
    }
    // 빈 객체만 남은 question_stats 항목 삭제 (견고하게)
    const emptyKeys = Object.entries(updatedStats.question_stats)
      .filter(([_, stat]) => stat && typeof stat === 'object' && Object.keys(stat).length === 0)
      .map(([qid]) => qid);
    for (const qid of emptyKeys) {
      delete updatedStats.question_stats[qid];
    }
    // [디버깅] DB에 저장되는 T23, T3 파트 출력
    // console.log('==== DB 저장 직전(T23, T3) ====');
    // Object.entries(updatedStats.question_stats || {}).forEach(([k, v]) => {
    //   if (k.startsWith('T23_') || k.startsWith('T3_')) {
    //     console.log(k, v);
    //   }
    // });
    // 6. 최신통계치 DB에 업로드 (insert, 항상 새 도큐먼트)
    updatedStats.generated_at = new Date();
    await SurveyStatistics.create(updatedStats);

    res.status(201).json({ success: true, result: saved, converted_answers });
  } catch (error) {
    console.error('설문 응답 저장/통계 갱신 오류:', error);
    res.status(500).json({ success: false, error: '설문 응답 저장/통계 갱신 중 오류가 발생했습니다', message: error.message });
  }
};

// 설문 결과 보고서 조회 (POST) - survey_id를 body로 받아 FE용 가공 결과 반환
const getSurveyReport = async (req, res) => {
  try {
    const { survey_id } = req.body;
    if (!survey_id) {
      return res.status(400).json({ success: false, error: 'survey_id는 필수입니다.' });
    }

    // 1. 응답 원본 조회
    const result = await SurveyResult.findOne({ survey_id }).lean();
    if (!result) {
      return res.status(404).json({ success: false, error: '해당 survey_id의 응답이 존재하지 않습니다.' });
    }

    const answers = result.answers;
    const answer_type = result.raw_payload?.answer_type;

    // 2. 최신 통계치 조회
    const statistics = await SurveyStatistics.findOne({}).sort({ generated_at: -1 }).lean();
    const groupStats = statistics?.group_stats || {};

    // 3. T1, T21 그룹별 결과 계산
    const buildGroupResult = (part, groups) => {
      const out = {};
      for (const g of groups) {
        const groupKey = `${part}_${g}`;
        const qids = Object.keys(answers[part] || {}).filter(qid => qid.startsWith(`${groupKey}`));
        if (qids.length === 0) continue;

        // 유저의 그룹 내 정규화 점수 평균
        const scores = qids.map(qid => normalizeScore(answers[part][qid], answer_type)).filter(s => s !== null);
        const userMean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

        // 통계치 평균, 상위%
        const stat = groupStats[groupKey];
        const popMean = stat?.mean ?? null;
        const popStddev = stat?.stddev ?? null;
        const topPercent = (userMean !== null && popMean !== null && popStddev !== null)
          ? Math.round((1 - normalCDF(popMean, popStddev, userMean)) * 1000) / 10
          : null;

        out[g] = {
          user: userMean !== null ? Math.round(userMean * 1000) / 1000 : null,
          average: popMean !== null ? Math.round(popMean * 1000) / 1000 : null,
          top_percent: topPercent
        };
      }
      return out;
    };

    const T1_GROUPS = ['E', 'C', 'S', 'A', 'I', 'R', 'G', 'U', 'T'];
    const T21_GROUPS = ['T', 'L', 'M', 'B', 'S', 'I', 'N', 'A'];

    // 4. T3 파트별 레벨 그대로 반환
    const t3 = answers.T3 || {};

    res.json({
      success: true,
      result: {
        survey_id,
        completed_at: result.raw_payload?.completed_at || null,
        answer_type,
        T1: buildGroupResult('T1', T1_GROUPS),
        T21: buildGroupResult('T21', T21_GROUPS),
        T22: { checked: answers.T22?.checked || [] },
        T23: {
          priority_1: answers.T23?.priority_1 || null,
          priority_2: answers.T23?.priority_2 || null,
          priority_3: answers.T23?.priority_3 || null
        },
        T3: t3
      }
    });
  } catch (error) {
    console.error('설문 결과 조회 오류:', error);
    res.status(500).json({ success: false, error: '설문 결과 조회 중 오류가 발생했습니다', message: error.message });
  }
};

// 설문 분석 결과 조회 (GET)
const getSurveyAnalysis = async (req, res) => {
  try {
    const { survey_id } = req.params;

    const result = await SurveyResult.findOne({ survey_id }).lean();
    if (!result) {
      return res.status(404).json({ success: false, error: '해당 survey_id의 응답이 존재하지 않습니다.' });
    }

    const answers = result.answers;
    const answer_type = result.raw_payload?.answer_type;

    // 최신 통계
    const statistics = await SurveyStatistics.findOne({}).sort({ generated_at: -1 }).lean();
    const groupStats = statistics?.group_stats || {};

    // survey_elements 코드-이름 매핑 로드 (T1, T21)
    const SurveyElement = require('../models/SurveyElement');
    const [t1Elements, t21Elements] = await Promise.all([
      SurveyElement.find({ test_code: 'T1', level: 'upper' }, { code: 1, name: 1, _id: 0 }).lean(),
      SurveyElement.find({ test_code: 'T21', level: 'upper' }, { code: 1, name: 1, definition: 1, _id: 0 }).lean()
    ]);
    const firstSentence = (str) => {
      if (!str) return null;
      const m = str.match(/^[^.!?]+[.!?]/);
      return m ? m[0].trim() : str.trim();
    };
    const t1NameMap = Object.fromEntries(t1Elements.map(e => [e.code, e.name]));
    const t21NameMap = Object.fromEntries(t21Elements.map(e => [e.code, e.name]));
    const t21DefMap = Object.fromEntries(t21Elements.map(e => [e.code, firstSentence(e.definition)]));

    // T23 이름 매핑 — T2_3_values 컬렉션에서 value_id 기준 조회
    const T23Model = getQuestionModel('T2_3_values');
    const t23All = await T23Model.find({}, { value_id: 1, value_name: 1, value_definition: 1, _id: 0 }).lean();
    const t23Map = Object.fromEntries(t23All.map(e => [e.value_id, { name: e.value_name, definition: firstSentence(e.value_definition) }]));

    // T1/T21 그룹 점수 계산 헬퍼
    const calcGroupScores = (part, groups, nameMap) => {
      return groups.map(g => {
        const groupKey = `${part}_${g}`;
        const qids = Object.keys(answers[part] || {}).filter(qid => qid.startsWith(groupKey));
        if (qids.length === 0) return null;

        const scores = qids.map(qid => normalizeScore(answers[part][qid], answer_type)).filter(s => s !== null);
        const userMean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

        const stat = groupStats[groupKey];
        const popMean = stat?.mean ?? null;
        const popStddev = stat?.stddev ?? null;
        const topPercent = (userMean !== null && popMean !== null && popStddev !== null)
          ? Math.round((1 - normalCDF(popMean, popStddev, userMean)) * 1000) / 10
          : null;

        return {
          code: g,
          name: nameMap[g] || g,
          score: userMean !== null ? Math.round(userMean * 1000) / 1000 : null,
          average: popMean !== null ? Math.round(popMean * 1000) / 1000 : null,
          top_percent: topPercent
        };
      }).filter(Boolean).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    };

    const personalityScores = calcGroupScores('T1', ['E','C','S','A','I','R','G','U','T'], t1NameMap);
    const talentScores = calcGroupScores('T21', ['T','L','M','B','S','I','N','A'], t21NameMap)
      .map(s => ({ ...s, definition: t21DefMap[s.code] || null }));

    // T22 관심 분야 — checked 항목을 DB에서 이름 조회 후 카테고리별 그룹화
    const T22Model = getQuestionModel('T2_2_interest');
    const checkedIds = answers.T22?.checked || [];
    let interest = { total: checkedIds.length, by_category: {} };
    if (checkedIds.length > 0) {
      const t22Items = await T22Model.find(
        { field_id: { $in: checkedIds } },
        { field_id: 1, field_name: 1, field_definition: 1, upper_field_code: 1, upper_field_name: 1, _id: 0 }
      ).lean();
      for (const item of t22Items) {
        if (!interest.by_category[item.upper_field_code]) {
          interest.by_category[item.upper_field_code] = { name: item.upper_field_name, items: [] };
        }
        interest.by_category[item.upper_field_code].items.push({
          field_id: item.field_id,
          name: item.field_name,
          definition: item.field_definition
        });
      }
    }

    // T23 가치관 — priority 코드를 이름/설명으로 변환
    const values = {};
    for (const p of ['priority_1', 'priority_2', 'priority_3']) {
      const code = answers.T23?.[p];
      values[p] = code ? { code, name: t23Map[code]?.name || code, definition: t23Map[code]?.definition || null } : null;
    }

    // T3 환경 — 파트별 레벨(1~5) + 이름/설명 + 모집단 통계 + 결과 문장 + WE 역산
    const T3Model = getQuestionModel('T3_environmental');
    const t3Answers = answers.T3 || {};
    const T3_PARTS = ['T3_PHY', 'T3_PEO', 'T3_COM', 'T3_RES', 'T3_STR', 'T3_FLX'];

    const t3PartDocs = await T3Model.find(
      { part_code: { $in: T3_PARTS } },
      { part_code: 1, part_name: 1, levels: 1, related_WE: 1, _id: 0 }
    ).lean();
    const t3PartMap = Object.fromEntries(t3PartDocs.map(p => [p.part_code, p]));

    const environmentParts = T3_PARTS.map(partCode => {
      const level = t3Answers[partCode] ?? null;
      const partInfo = t3PartMap[partCode];
      const stat = statistics?.question_stats?.[partCode];
      const popMean = stat?.mean ?? null;
      const popStddev = stat?.stddev ?? null;
      const topPercent = (level !== null && popMean !== null && popStddev)
        ? Math.round((1 - normalCDF(popMean, popStddev, level)) * 1000) / 10
        : null;
      return {
        code: partCode,
        name: partInfo?.part_name || partCode,
        level,
        average: popMean !== null ? Math.round(popMean * 10) / 10 : null,
        top_percent: topPercent,
        level_description: partInfo?.levels?.find(l => l.level === level)?.description ?? null
      };
    }).filter(p => p.level !== null);

    // T3 결과 문장 (good / bad)
    const t3Texts = { good: [], bad: [] };
    for (const partCode of T3_PARTS) {
      const level = t3Answers[partCode];
      if (!level || level === 3) continue;
      const texts = T3_RESULT_TEXTS[partCode]?.levels?.[level];
      if (!texts) continue;
      t3Texts.good.push({ part: partCode, level, text: texts.good });
      t3Texts.bad.push({ part: partCode, level, text: texts.bad });
    }

    // T3 WE 역산 (good / bad)
    const goodWeMap = {};
    const badWeMap = {};
    for (const partCode of T3_PARTS) {
      const level = t3Answers[partCode];
      if (!level || level === 3) continue;
      const relatedWE = t3PartMap[partCode]?.related_WE;
      if (!relatedWE) continue;

      const isHigh = level >= 4;  // 레벨 4·5
      const isLow  = level <= 2;  // 레벨 1·2

      const collect = (items, targetMap) => {
        for (const { code, weight } of (items || [])) {
          targetMap[code] = (targetMap[code] || 0) + weight;
        }
      };

      if (isHigh) {
        collect(relatedWE.up,   goodWeMap);
        collect(relatedWE.down, badWeMap);
      } else if (isLow) {
        collect(relatedWE.down, goodWeMap);
        collect(relatedWE.up,   badWeMap);
      }
    }

    const toSortedTop5 = (weMap) =>
      Object.entries(weMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([code, weight]) => ({ code, weight: Math.round(weight * 10) / 10 }));

    const goodWeCandidates = toSortedTop5(goodWeMap);
    const badWeCandidates  = toSortedTop5(badWeMap);

    const allWeCodes = [...new Set([...goodWeCandidates.map(w => w.code), ...badWeCandidates.map(w => w.code)])];
    let weDetailMap = {};
    if (allWeCodes.length > 0) {
      const weAttrs = await CareerAttribute.find(
        { code: { $in: allWeCodes }, category: 'work_environment' },
        { code: 1, name: 1, definition: 1, _id: 0 }
      ).lean();
      weDetailMap = Object.fromEntries(weAttrs.map(a => [a.code, a]));
    }

    const enrichWe = (candidates) =>
      candidates.map(({ code, weight }) => ({
        code, weight,
        name:       weDetailMap[code]?.name       ?? code,
        definition: weDetailMap[code]?.definition ?? null
      }));

    const t3WeItems = {
      good: enrichWe(goodWeCandidates),
      bad:  enrichWe(badWeCandidates)
    };

    const allLevel3 = T3_PARTS.every(p => !t3Answers[p] || t3Answers[p] === 3);
    const t3Result = {
      texts:   allLevel3 ? null : t3Texts,
      weItems: allLevel3 ? null : t3WeItems
    };

    // T1 유형 결과
    let T1_result = result.T1_result || null;
    if (!T1_result && answers.T1) {
      const t1GroupScores = calcT1GroupScores(answers.T1, answer_type);
      const t1TypeCalc = calcT1Type(t1GroupScores);
      if (t1TypeCalc) {
        const typeDoc = await T1Type.findOne({ type_code: t1TypeCalc.type_code }, '-_id -__v').lean();
        T1_result = {
          ...t1TypeCalc,
          ...(typeDoc ? {
            base_name: typeDoc.base_name,
            modifier: typeDoc.modifier,
            full_name: typeDoc.full_name,
            description: typeDoc.description
          } : {})
        };
      }
    }
    // T1 유형에 상위% 추가
    if (T1_result?.group_scores) {
      T1_result = { ...T1_result, percentiles: {} };
      for (const g of ['E','C','S','A','I','R','G','U','T']) {
        const userScore = T1_result.group_scores[g];
        if (userScore === undefined) continue;
        const stat = groupStats[`T1_${g}`];
        if (stat?.mean !== undefined && stat?.stddev !== undefined) {
          T1_result.percentiles[g] = Math.round((1 - normalCDF(stat.mean, stat.stddev, userScore)) * 1000) / 10;
        }
      }
    }

    res.json({
      success: true,
      survey_id,
      answer_type,
      analysis: {
        personality_type: T1_result,
        personality: { top3: personalityScores.slice(0, 3), all: personalityScores },
        talent: { top3: talentScores.slice(0, 3), all: talentScores },
        interest,
        values,
        environment: {
          parts: environmentParts,
          texts:   t3Result.texts,
          weItems: t3Result.weItems
        }
      }
    });
  } catch (error) {
    console.error('설문 분석 조회 오류:', error);
    res.status(500).json({ success: false, error: '설문 분석 조회 중 오류가 발생했습니다', message: error.message });
  }
};

// 통계치 갱신(누적) API 예시
// POST /api/survey/statistics/update
const updateSurveyStatistics = async (req, res) => {
  try {
    const { survey_id } = req.body;
    if (!survey_id) {
      return res.status(400).json({ success: false, error: 'survey_id는 필수입니다.' });
    }
    // 실제 통계 누적 로직은 생략, 예시로 last_survey_id만 반영
    const updated = await SurveyStatistics.findOneAndUpdate(
      {},
      { $set: { last_survey_id: survey_id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, statistics: updated });
  } catch (error) {
    console.error('통계치 갱신 오류:', error);
    res.status(500).json({ success: false, error: '통계치 갱신 중 오류가 발생했습니다', message: error.message });
  }
};

// T1 그룹(E,C,S,A,I,R,G,U,T)별 정규화 점수 평균 계산
function calcT1GroupScores(T1answers, answer_type) {
  if (!T1answers) return {};
  const T1_GROUPS = ['E', 'C', 'S', 'A', 'I', 'R', 'G', 'U', 'T'];
  const groupScores = {};
  for (const g of T1_GROUPS) {
    const qids = Object.keys(T1answers).filter(qid => qid.startsWith(`T1_${g}`));
    if (qids.length === 0) continue;
    const scores = qids.map(qid => normalizeScore(T1answers[qid], answer_type)).filter(s => s !== null);
    if (scores.length > 0) {
      groupScores[g] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }
  return groupScores;
}

// T1 유형 계산: 그룹 점수 → { type_code, base_type, modifier_type, modifier_element, group_scores }
// type_code = "T1" + base_type + "U"(TOP2)/+"B"(BOTTOM1) + modifier_element
// TOP2 조건: top1-top2 점수 차이 ≤ 0.15
function calcT1Type(scores) {
  const sorted = Object.entries(scores)
    .filter(([, v]) => v !== null && v !== undefined)
    .sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) return null;

  const [top1Code, top1Score] = sorted[0];
  const [top2Code, top2Score] = sorted[1];
  const [bottom1Code] = sorted[sorted.length - 1];

  const diff = top1Score - top2Score;
  const useTOP2 = diff <= 0.15;
  const modifierIndicator = useTOP2 ? 'U' : 'B';
  const modifierElement = useTOP2 ? top2Code : bottom1Code;

  return {
    type_code: `T1${top1Code}${modifierIndicator}${modifierElement}`,
    base_type: top1Code,
    modifier_type: useTOP2 ? 'TOP2' : 'BOTTOM1',
    modifier_element: modifierElement,
    group_scores: scores
  };
}

// T1 유형 결과 조회 (GET /api/survey/t1-result/:survey_id)
const getT1Result = async (req, res) => {
  try {
    const { survey_id } = req.params;
    const result = await SurveyResult.findOne({ survey_id }, { T1_result: 1, answers: 1, raw_payload: 1, _id: 0 }).lean();
    if (!result) {
      return res.status(404).json({ success: false, error: '해당 survey_id의 응답이 존재하지 않습니다.' });
    }

    let T1_result = result.T1_result || null;

    // 구버전 응답(T1_result 미저장)에 대한 실시간 계산
    if (!T1_result && result.answers?.T1) {
      const answer_type = result.raw_payload?.answer_type;
      const t1GroupScores = calcT1GroupScores(result.answers.T1, answer_type);
      const t1TypeCalc = calcT1Type(t1GroupScores);
      if (t1TypeCalc) {
        const typeDoc = await T1Type.findOne({ type_code: t1TypeCalc.type_code }, '-_id -__v').lean();
        T1_result = {
          ...t1TypeCalc,
          ...(typeDoc ? {
            base_name: typeDoc.base_name,
            modifier: typeDoc.modifier,
            full_name: typeDoc.full_name,
            description: typeDoc.description
          } : {})
        };
      }
    }

    if (!T1_result) {
      return res.status(404).json({ success: false, error: 'T1 응답 데이터가 없습니다.' });
    }

    // 그룹별 상위% 추가
    if (T1_result.group_scores) {
      const statistics = await SurveyStatistics.findOne({}).sort({ generated_at: -1 }).lean();
      const groupStats = statistics?.group_stats || {};
      const percentiles = {};
      for (const g of ['E','C','S','A','I','R','G','U','T']) {
        const userScore = T1_result.group_scores[g];
        if (userScore === undefined) continue;
        const stat = groupStats[`T1_${g}`];
        if (stat?.mean !== undefined && stat?.stddev !== undefined) {
          percentiles[g] = Math.round((1 - normalCDF(stat.mean, stat.stddev, userScore)) * 1000) / 10;
        }
      }
      T1_result = { ...T1_result, percentiles };
    }

    res.json({ success: true, survey_id, T1_result });
  } catch (error) {
    console.error('T1 결과 조회 오류:', error);
    res.status(500).json({ success: false, error: 'T1 결과 조회 중 오류가 발생했습니다', message: error.message });
  }
};

// 정규분포 CDF: P(X <= x) — 상위% 계산에 사용
// erf 근사: Abramowitz & Stegun (최대 오차 1.5e-7)
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCDF(mean, stddev, x) {
  if (stddev === 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (stddev * Math.sqrt(2))));
}

// 응답값을 0~1로 정규화하는 함수
// type_2 (OX): X=0.25, O=0.75 (극단 회피)
// type_5 (ABCDE): 0, 0.25, 0.5, 0.75, 1.0
// type_10 (0~9): raw / 9
function normalizeScore(value, answer_type) {
  if (answer_type === 'type_2') {
    if (value === 'O') return 0.75;
    if (value === 'X') return 0.25;
    return null;
  }
  if (answer_type === 'type_5') {
    const map = { A: 0, B: 0.25, C: 0.5, D: 0.75, E: 1 };
    return map[value] ?? null;
  }
  if (answer_type === 'type_10') {
    const raw = Number(value);
    if (!isNaN(raw) && raw >= 1 && raw <= 10) return (raw - 1) / 9;
    return null;
  }
  return null;
}

// 시드 기반 Fisher-Yates 셔플 함수
function seededShuffle(array, seed) {
  // 간단한 시드 기반 난수 생성기 (Mulberry32)
  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }
  const random = mulberry32(hashString(seed));
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// 문자열을 해시값(숫자)로 변환
function hashString(str) {
  let hash = 0, i, chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// 환산 로직: 정규화된 응답값을 모집단 통계 기반으로 환산
// 공식: mean + (normalized - 0.5) * 2 * stddev
// → normalized=0.0 : mean - stddev (가장 낮은 응답)
// → normalized=0.5 : mean            (중간 응답)
// → normalized=1.0 : mean + stddev  (가장 높은 응답)
function convertAnswers(answers, statistics, answer_type) {
  const questionStats = (typeof statistics.question_stats?.entries === 'function')
    ? Object.fromEntries(statistics.question_stats.entries())
    : statistics.question_stats;

  const converted = {};
  for (const part of ['T1', 'T21']) {
    if (!answers[part]) continue;
    for (const [qid, value] of Object.entries(answers[part])) {
      const normalized = normalizeScore(value, answer_type);
      if (normalized === null) continue;
      const stat = questionStats[qid];
      if (stat && stat.mean !== undefined && stat.stddev !== undefined) {
        converted[qid] = stat.mean + (normalized - 0.5) * 2 * stat.stddev;
      }
    }
  }
  return converted;
}

// 설문 결과 리스트 조회 (GET)
const getSurveyResultList = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    if (limit > 100) limit = 100;
    if (page < 1) page = 1;

    const total = await SurveyResult.countDocuments();
    const results = await SurveyResult.find({}, {
      survey_id: 1, submitted_at: 1, 'raw_payload.completed_at': 1, 'raw_payload.answer_type': 1, _id: 0
    })
      .sort({ submitted_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(total / limit),
        total_items: total,
        items_per_page: limit
      },
      results
    });
  } catch (error) {
    console.error('설문 결과 리스트 조회 오류:', error);
    res.status(500).json({ success: false, error: '설문 결과 리스트 조회 중 오류가 발생했습니다', message: error.message });
  }
};

// 통계치 조회 (GET)
const getSurveyStatistics = async (req, res) => {
  try {
    const statistics = await SurveyStatistics.findOne({}).sort({ generated_at: -1 });
    if (!statistics) {
      return res.status(404).json({ success: false, error: '통계치가 존재하지 않습니다.' });
    }
    res.json({ success: true, statistics });
  } catch (error) {
    console.error('통계치 조회 오류:', error);
    res.status(500).json({ success: false, error: '통계치 조회 중 오류가 발생했습니다', message: error.message });
  }
};

module.exports = {
  getSurveyForm,
  submitSurveyResponse,
  getSurveyReport,
  getSurveyAnalysis,
  getT1Result,
  updateSurveyStatistics,
  getSurveyStatistics,
  getSurveyResultList
};