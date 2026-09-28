// matching_logic.md 기반 매핑 테이블

// T1 성격 9요소 → PS 코드 매핑
// PS11(스트레스감내성)은 R(위험회피)과 역방향 → w 음수 처리
const T1_PS_MAP = {
  E: [{ code: 'PS13', w: 1.5 }, { code: 'PS14', w: 1.5 }, { code: 'PS08', w: 0.7 }],
  C: [{ code: 'PS09', w: 1.5 }, { code: 'PS05', w: 1.0 }, { code: 'PS06', w: 0.7 }],
  S: [{ code: 'PS02', w: 1.5 }, { code: 'PS03', w: 1.5 }, { code: 'PS04', w: 1.5 }, { code: 'PS07', w: 1.0 }, { code: 'PS08', w: 0.7 }],
  A: [{ code: 'PS01', w: 1.5 }, { code: 'PS12', w: 1.5 }, { code: 'PS15', w: 0.7 }],
  I: [{ code: 'PS05', w: 1.5 }, { code: 'PS09', w: 1.0 }, { code: 'PS02', w: 0.7 }, { code: 'PS16', w: 0.7 }],
  R: [{ code: 'PS03', w: 1.5 }, { code: 'PS06', w: 1.5 }, { code: 'PS10', w: 1.0 }, { code: 'PS11', w: -1.0 }],
  G: [{ code: 'PS12', w: 1.5 }, { code: 'PS01', w: 1.0 }, { code: 'PS13', w: 0.7 }],
  U: [{ code: 'PS16', w: 1.5 }, { code: 'PS14', w: 1.0 }, { code: 'PS07', w: 0.7 }, { code: 'PS10', w: 0.7 }, { code: 'PS15', w: 0.7 }],
  T: [{ code: 'PS01', w: 1.5 }, { code: 'PS13', w: 1.5 }, { code: 'PS12', w: 0.7 }],
};

// T21 재능 8요소 → AB(업무수행능력) 코드 매핑
const T21_AB_MAP = {
  L: [{ code: 'AB34', w: 1.5 }, { code: 'AB35', w: 1.5 }, { code: 'AB09', w: 1.0 }, { code: 'AB14', w: 1.0 }, { code: 'AB20', w: 0.7 }],
  M: [{ code: 'AB04', w: 1.5 }, { code: 'AB08', w: 1.5 }, { code: 'AB07', w: 1.0 }, { code: 'AB13', w: 1.0 }, { code: 'AB15', w: 0.7 }],
  S: [{ code: 'AB05', w: 1.5 }, { code: 'AB24', w: 1.0 }, { code: 'AB03', w: 0.7 }],
  A: [{ code: 'AB41', w: 1.5 }, { code: 'AB02', w: 0.7 }],
  B: [{ code: 'AB43', w: 1.5 }, { code: 'AB44', w: 1.5 }, { code: 'AB38', w: 1.0 }, { code: 'AB37', w: 1.0 }, { code: 'AB42', w: 0.7 }],
  I: [{ code: 'AB26', w: 1.5 }, { code: 'AB20', w: 1.5 }, { code: 'AB23', w: 1.0 }, { code: 'AB28', w: 1.0 }, { code: 'AB33', w: 0.7 }],
  N: [{ code: 'AB06', w: 1.5 }, { code: 'AB15', w: 1.0 }, { code: 'AB07', w: 0.7 }],
  T: [{ code: 'AB10', w: 1.5 }, { code: 'AB01', w: 1.5 }, { code: 'AB32', w: 1.0 }, { code: 'AB07', w: 0.7 }],
};

// T21 재능 8요소 → A(업무활동) 코드 매핑
const T21_A_MAP = {
  L: [{ code: 'A09', w: 1.5 }, { code: 'A10', w: 1.5 }, { code: 'A16', w: 1.0 }, { code: 'A25', w: 1.0 }, { code: 'A14', w: 0.7 }],
  M: [{ code: 'A05', w: 1.5 }, { code: 'A17', w: 1.5 }, { code: 'A07', w: 1.0 }, { code: 'A34', w: 0.7 }],
  S: [{ code: 'A03', w: 1.5 }, { code: 'A29', w: 1.5 }, { code: 'A11', w: 0.7 }],
  A: [{ code: 'A03', w: 1.0 }, { code: 'A04', w: 0.7 }],
  B: [{ code: 'A32', w: 1.5 }, { code: 'A40', w: 1.5 }, { code: 'A41', w: 1.0 }, { code: 'A36', w: 1.0 }, { code: 'A37', w: 0.7 }],
  I: [{ code: 'A19', w: 1.5 }, { code: 'A21', w: 1.5 }, { code: 'A22', w: 1.0 }, { code: 'A15', w: 1.0 }, { code: 'A08', w: 0.7 }],
  N: [{ code: 'A06', w: 1.5 }, { code: 'A12', w: 1.5 }, { code: 'A26', w: 0.7 }],
  T: [{ code: 'A04', w: 1.5 }, { code: 'A11', w: 1.5 }, { code: 'A24', w: 1.0 }, { code: 'A02', w: 0.7 }],
};

// T22 대분류 → Holland 유형 매핑
const T22_HOLLAND_MAP = {
  BUS: [{ code: 'E', w: 1.5 }, { code: 'C', w: 1.0 }],
  COM: [{ code: 'A', w: 1.5 }, { code: 'S', w: 1.0 }],
  EDU: [{ code: 'S', w: 1.5 }],
  SAF: [{ code: 'R', w: 1.5 }, { code: 'E', w: 0.7 }],
  SCI: [{ code: 'I', w: 1.5 }],
  SOC: [{ code: 'S', w: 1.5 }, { code: 'I', w: 1.0 }],
  TEC: [{ code: 'R', w: 1.5 }, { code: 'I', w: 1.0 }],
};

// T23 항목(value_id) → VA 코드 1:1 매핑
//
// **설문에 실제로 존재하는 9개만 둔다.** 정본은 `survey_questions.T2_3_values`(라이브 9건).
// 9개 전부 직업 데이터의 가치관 코드에 대응된다 — 고아 0건(2026-09-28 실측).
//
// ⚠️ 2026-09-26 에는 레거시 4개(T23_5·10·12·13)를 남겨뒀었다. 근거는
//    "기존 survey_results 88건 중 33건이 그 4개를 쓰므로 지우면 과거 점수가 바뀐다" 였는데,
//    **2026-09-28 에 그 88건이 전부 더미로 확인되어 근거가 사라졌다**
//    (respondent_id 가 users 에 0건 / `test_1_김원칙` 류 페르소나 / 출처 seed_test_responses.js).
//    실사용자 검사 응답은 아직 없다. 지켜야 할 과거 응답이 애초에 없었다.
//
// ⚠️ 레거시를 남겨두면 오히려 **해롭다.** `VA02`(개인지향)·`VA13`(신체활동)은 고용24 개편 때
//    직업 속성에서 빠져서 `calcT23Match` 의 `jobVA[vaCode] ?? 0` 이 **0점을 먹인다**
//    — "데이터 없음"이 "최저점"으로 둔갑해 T23 점수를 끌어내린다.
//    표에서 빼면 `T23_VA_MAP[id]` 가 undefined 라 `continue` 가 걸려 **가중치에서 제외**되고,
//    남은 우선순위끼리 정상적으로 정규화된다. 이게 옳은 동작이다.
//
// 제거한 4개가 실제로 어디서 측정되는지는 공유 docs `reference/work24-open-api.md` 참조:
//   T23_5  영향력    → PS14 리더십 / WE14·WE17·WE20
//   T23_10 헌신      → 새 체계 '사회적 공헌'에 흡수(T23_1 이타와 중복)
//   T23_12 신체 활동  → WE02·WE38·WE41 등 9개 항목
//   T23_13 개인 지향  → WE04·WE05·WE06
// 이들을 WE/PS 축으로 옮겨 쓰는 것은 매칭 설계 변경이 필요해 **하지 않기로 결정**했다.
const T23_VA_MAP = {
  T23_1: 'VA10',   // 이타        → 새 체계 '사회적 공헌'
  T23_2: 'VA11',   // 안정        → 새 체계 '직업안정'
  T23_3: 'VA04',   // 지적 추구    → 새 체계 '자기개발'
  T23_4: 'VA01',   // 성취        → 새 체계 '성취'
  T23_6: 'VA09',   // 인정        → 새 체계 '사회적 인정'
  T23_7: 'VA05',   // 경제적 보상  → 새 체계 '경제적 보상'
  T23_8: 'VA12',   // 심신의 안녕  → 새 체계 '일과 삶의 균형'
  T23_9: 'VA07',   // 자율        → 새 체계 '자율성'
  T23_11: 'VA03',  // 다양성      → 새 체계 '변화지향'
};

// T23 우선순위 가중치
const T23_WEIGHTS = { priority_1: 1.5, priority_2: 1.0, priority_3: 0.7 };

module.exports = { T1_PS_MAP, T21_AB_MAP, T21_A_MAP, T22_HOLLAND_MAP, T23_VA_MAP, T23_WEIGHTS };
