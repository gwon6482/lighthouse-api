/**
 * 설문 응답 코드 → career_attributes 코드 매핑
 *
 * 직업 적합도 계산 시 survey_results의 응답 코드를
 * job_info.details의 career_attributes 코드와 연결하는 기준 테이블.
 */

// T23 가치관 응답 코드 → VA 코드
// T23 설문은 job_data의 value 카테고리와 1:1 대응하도록 설계됨.
// DEDICATION(헌신)은 VA08(애국)을 대체하는 의도적 리네이밍.
//
// ⚠️ **이 파일은 어디서도 require 되지 않는다(죽은 코드).**
//    실제로 쓰이는 표는 `config/matchingMaps.js` 의 T23_VA_MAP 과
//    `controllers/recommendController.js` 의 T23_TO_VA_T2 두 개다. 고칠 때 여기를 고치면 안 된다.
//
// ⚠️ 2026-09-26: 고용24가 가치관 체계를 13→9 로 개편해 설문에서 4개를 제거했다.
//    제거: INFLUENCE(영향력) / DEDICATION(헌신) / PHYSICAL_ACTIVITY(신체 활동) / INDIVIDUAL_FOCUS(개인 지향)
//    아래 표는 손대지 않았다(죽은 코드이므로). 정본은 matchingMaps.js 다.
const T23_TO_VA = {
  ACHIEVEMENT:         'VA01', // 성취
  INDIVIDUAL_FOCUS:    'VA02', // 개인지향 (T23: "개인 지향")
  VARIETY:             'VA03', // 다양성
  INTELLECTUAL_PURSUIT:'VA04', // 지적 추구
  ECONOMIC_REWARD:     'VA05', // 경제적 보상
  INFLUENCE:           'VA06', // 타인에 대한 영향 (T23: "영향력")
  AUTONOMY:            'VA07', // 자율
  DEDICATION:          'VA08', // 애국 → T23에서 "헌신"으로 대체
  RECOGNITION:         'VA09', // 인정
  ALTRUISM:            'VA10', // 이타
  STABILITY:           'VA11', // 고용안정 (T23: "안정")
  WELL_BEING:          'VA12', // 심신의 안녕
  PHYSICAL_ACTIVITY:   'VA13', // 신체활동 (T23: "신체 활동")
};

// T22 흥미 분야 field_code → KN 코드
// T22 문항의 field_code (예: EDU_1) → career_attributes knowledge 코드
const T22_TO_KN = {
  EDU_1: 'KN18', // 교육 및 훈련
  EDU_2: 'KN23', // 상담
  BUS_1: 'KN14', // 경영 및 행정
  BUS_2: 'KN10', // 고객서비스 (T22: "고객 서비스")
  BUS_3: 'KN08', // 사무
  BUS_4: 'KN12', // 인사
  BUS_5: 'KN07', // 영업과 마케팅
  BUS_6: 'KN13', // 경제와 회계
  COM_1: 'KN04', // 의사소통과 미디어
  COM_2: 'KN15', // 국어
  COM_3: 'KN03', // 영어
  TEC_1: 'KN09', // 통신
  TEC_2: 'KN01', // 컴퓨터와 전자공학
  TEC_3: 'KN32', // 운송
  TEC_4: 'KN28', // 건축 및 설계
  TEC_5: 'KN20', // 기계
  TEC_6: 'KN05', // 디자인
  TEC_7: 'KN17', // 상품 제조 및 공정
  TEC_8: 'KN06', // 공학과 기술
  SOC_1: 'KN24', // 사회와 인류
  SOC_2: 'KN22', // 심리
  SOC_3: 'KN27', // 역사
  SOC_4: 'KN19', // 예술
  SOC_5: 'KN26', // 지리
  SOC_6: 'KN21', // 법
  SOC_7: 'KN25', // 철학과 신학
  SCI_1: 'KN02', // 산수와 수학
  SCI_2: 'KN31', // 생물
  SCI_3: 'KN29', // 의료
  SCI_4: 'KN33', // 식품생산 (T22: "식품 생산")
  SCI_5: 'KN16', // 물리
  SCI_6: 'KN30', // 화학
  SAF_1: 'KN11', // 안전과 보안
};

// T22 field_id → KN 코드 (field_id: "T22_EDU_1" → field_code: "EDU_1" 변환 포함)
const T22_FIELD_ID_TO_KN = Object.fromEntries(
  Object.entries(T22_TO_KN).map(([fieldCode, kn]) => [`T22_${fieldCode}`, kn])
);

// T3 업무환경 파트 코드 → 관련 WE 코드 매핑은 T3_environmental DB 도큐먼트의
// related_WE.up / related_WE.down 필드를 직접 사용 (weight 포함).

// Holland 흥미 코드 (job_info.details.흥미 ↔ career_attributes.interest)
const HOLLAND_CODES = ['R', 'I', 'A', 'S', 'E', 'C'];

module.exports = {
  T23_TO_VA,
  T22_TO_KN,
  T22_FIELD_ID_TO_KN,
  HOLLAND_CODES,
};
