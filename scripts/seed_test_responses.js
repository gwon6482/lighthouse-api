#!/usr/bin/env node
/**
 * seed_test_responses.js
 *
 * 🚨🚨 **이 스크립트가 만든 데이터는 실사용자 응답이 아니다.** 🚨🚨
 *
 * `survey_data.survey_results` 의 88건이 전부 여기서 나왔다
 * (`test_1_김원칙`·`test_2_이성실` 같은 **설계된 페르소나**, 88건 중 51건이 하루에 몰림).
 * `respondent_id` 가 `user_data.users` 에 **하나도 없다.**
 *
 * ⚠️ **통계·검증의 근거로 쓰지 말 것.** 2026-09-28 에 이것을 실사용자 표본으로 오인해
 *    추천 커버리지 「83%」를 내고 공유 docs 에까지 올렸다가 철회했다.
 *    페르소나는 특성별로 **의도적으로 설계**된 것이라 분포가 실사용자와 닮을 이유가 없다 —
 *    "표본이 작다"가 아니라 **"표본이 아니다"** 가 맞는 표현이다.
 *
 * ⚠️ 추천·매칭을 평가할 때는 응답 표본이 아니라 **가능한 사용자 프로파일 공간**으로 판정한다.
 *    → `scripts/recommend-reachability.js`
 *
 * LightHouse_app/test-responses/test_data.json 의 가상 인물 데이터를 기반으로
 * 설문 응답을 생성하고 API 에 제출합니다.
 *
 * Usage:
 *   node scripts/seed_test_responses.js          # 실제 제출
 *   node scripts/seed_test_responses.js --dry    # 드라이런 (제출 없이 확인만)
 */

const axios = require('axios');
const path = require('path');

const TEST_DATA_PATH = path.join(__dirname, '../../LightHouse_app/test-responses/test_data.json');
const testData = require(TEST_DATA_PATH);

const API_BASE = 'https://api.lighthouse.career';
const DRY_RUN = process.argv.includes('--dry');

// 테스트 전용 survey_id (SURV20260429D_TEST001T 형식)
function makeSurveyId(personId) {
  const pad = n => String(n).padStart(3, '0');
  return `SURV20260429D_TEST${pad(personId)}T`;
}

// 0-1 점수 → type_5 답변 (A/B/C/D/E), 노이즈로 문항별 변화 부여
function scoreToAnswer5(targetScore, noiseRange = 0.15) {
  const noise = (Math.random() - 0.5) * 2 * noiseRange;
  const varied = Math.min(1, Math.max(0, targetScore + noise));
  const rounded = Math.round(varied * 4) / 4;
  const map = { 1: 'A', 0.75: 'B', 0.5: 'C', 0.25: 'D', 0: 'E' };
  return map[rounded] ?? 'C';
}

// type_5 답변 → 0-1 점수
const ANSWER_SCORE = { A: 1, B: 0.75, C: 0.5, D: 0.25, E: 0 };

// question_id 에서 그룹 코드 추출 (T1_E2 → 'E', T21_M4 → 'M')
function extractGroup(questionId) {
  return questionId.split('_')[1][0];
}

// 그룹별 평균 점수 계산 (드라이런 검증용)
function calcGroupAverages(answerMap) {
  const groups = {};
  for (const [qId, ans] of Object.entries(answerMap)) {
    const g = extractGroup(qId);
    if (!groups[g]) groups[g] = [];
    groups[g].push(ANSWER_SCORE[ans] ?? 0.5);
  }
  const result = {};
  for (const [g, scores] of Object.entries(groups)) {
    result[g] = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3);
  }
  return result;
}

async function main() {
  console.log(`\n🚀 테스트 응답 시드 시작 (${DRY_RUN ? 'DRY RUN' : '실제 제출'})`);
  console.log(`📋 총 ${testData.length}명\n`);

  // 설문 폼 조회
  console.log('📥 설문 폼 불러오는 중...');
  const { data: formData } = await axios.get(`${API_BASE}/api/survey/form`);

  const t1Part = formData.survey.find(p => p.survey_part === 'T1');
  const t21Part = formData.survey.find(p => p.survey_part === 'T21');

  const t1Questions = Object.entries(t1Part)
    .filter(([k]) => k.startsWith('page_'))
    .flatMap(([, qs]) => qs);

  const t21Questions = Object.entries(t21Part)
    .filter(([k]) => k.startsWith('page_'))
    .flatMap(([, qs]) => qs);

  console.log(`  T1: ${t1Questions.length}문항, T21: ${t21Questions.length}문항\n`);

  let successCount = 0;
  let failCount = 0;

  for (const person of testData) {
    const surveyId = makeSurveyId(person.id);
    const respondentId = `test_${person.id}_${person.name}`;

    // T1 답변 생성 (그룹 점수 기반)
    const t1Answers = {};
    for (const q of t1Questions) {
      const group = extractGroup(q.question_id);
      const score = person.T1[group] ?? 0.5;
      t1Answers[q.question_id] = scoreToAnswer5(score);
    }

    // T21 답변 생성 (그룹 점수 기반)
    const t21Answers = {};
    for (const q of t21Questions) {
      const group = extractGroup(q.question_id);
      const score = person.T21[group] ?? 0.5;
      t21Answers[q.question_id] = scoreToAnswer5(score);
    }

    // T22: test_data는 "SOC_1" 형식 → API는 "T22_SOC_1" 형식
    const t22Checked = (person.T22.checked || []).map(id =>
      id.startsWith('T22_') ? id : `T22_${id}`
    );

    const payload = {
      survey_id: surveyId,
      respondent_id: respondentId,
      answer_type: 'type_5',
      answers: {
        T1: t1Answers,
        T21: t21Answers,
        T22: { checked: t22Checked },
        T23: person.T23,
        T3: person.T3,
      },
    };

    // 드라이런: 제출 없이 생성 결과만 출력
    if (DRY_RUN) {
      const t1Avg = calcGroupAverages(t1Answers);
      const t21Avg = calcGroupAverages(t21Answers);
      console.log(`[${String(person.id).padStart(2)}] ${person.name} (${person.reference_type})`);
      console.log(`  survey_id : ${surveyId}`);
      console.log(`  T1  target : ${JSON.stringify(person.T1)}`);
      console.log(`  T1  gen avg: ${JSON.stringify(t1Avg)}`);
      console.log(`  T21 target : ${JSON.stringify(person.T21)}`);
      console.log(`  T21 gen avg: ${JSON.stringify(t21Avg)}`);
      console.log(`  T22 checked: ${t22Checked.join(', ')}`);
      console.log(`  T23 priority: ${person.T23.priority_1} / ${person.T23.priority_2} / ${person.T23.priority_3}`);
      console.log(`  T3 : ${JSON.stringify(person.T3)}\n`);
      continue;
    }

    // 실제 제출
    try {
      const { data: result } = await axios.post(`${API_BASE}/api/survey/response`, payload);
      if (result.success) {
        console.log(`  ✅ [${person.id}] ${person.name} (${person.reference_type})`);
        successCount++;
      } else {
        console.log(`  ❌ [${person.id}] ${person.name}: ${result.error?.message}`);
        failCount++;
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.log(`  ❌ [${person.id}] ${person.name}: ${msg}`);
      failCount++;
    }

    // API 과부하 방지
    await new Promise(r => setTimeout(r, 120));
  }

  if (!DRY_RUN) {
    console.log(`\n✨ 완료: 성공 ${successCount}건, 실패 ${failCount}건`);
  }
}

main().catch(err => {
  console.error('\n오류:', err.message);
  process.exit(1);
});
