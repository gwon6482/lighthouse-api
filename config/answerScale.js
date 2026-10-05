/**
 * 설문 답변 → 0~1 점수 환산. **이 파일이 정본이다.**
 *
 * 🚨 **2026-10-05: 이 표가 두 곳에 따로 있었고, 서로 반대였다.**
 *
 *   통계·보고서 (surveyController.normalizeScore)  A:0    B:0.25 C:0.5 D:0.75 E:1     ← 맞음
 *   추천 매칭   (recommendController.ANSWER_SCORE) A:1.0  B:0.75 C:0.5 D:0.25 E:0.0   ← 뒤집힘
 *
 * UI 선택지(`ScaleQuestion5.vue`)는
 *   A 매우 아니다 · B 아니다 · C 보통 · D 그렇다 · E 매우 그렇다
 * 이므로 **A 가 낮고 E 가 높은 것이 맞다.** 추천 쪽이 틀렸다.
 *
 * ⚠️ **역코딩(부정 문항)은 이 척도에서 처리하지 않는다.**
 *    `weightedJobScore` 가 매핑의 음수 가중치로 처리한다 — `w < 0 ? (1-raw)*|w| : raw*|w|`.
 *    그래서 답변 척도는 **모든 문항에 균일**해야 한다. 여기서 뒤집으면 역코딩이 두 번 걸린다.
 *
 * ⚠️ 표를 다시 복사해 쓰지 말 것. 두 추천기의 T23 매핑표가 같은 식으로 갈라졌었다.
 */

// type_5 (ABCDE). 현재 설문이 쓰는 척도다(`scaleType` 기본값 5).
const ANSWER_SCORE_5 = { A: 0, B: 0.25, C: 0.5, D: 0.75, E: 1 };

// type_2 (OX). ⚠️ 0/1 이 아니라 0.25/0.75 다 — **극단 회피**(2지선다는 정보량이 적어
//    1.0/0.0 으로 보면 5지선다 응답자와 섞일 때 과대평가된다).
const ANSWER_SCORE_2 = { X: 0.25, O: 0.75 };

/**
 * 답변 1개 → 0~1. 모르는 값은 **null** 을 돌려준다(0 이 아니다 —
 * 0 으로 돌리면 "응답 없음"이 "최저점"으로 둔갑한다).
 */
function normalizeAnswer(value, answerType = 'type_5') {
  if (answerType === 'type_2') return ANSWER_SCORE_2[value] ?? null;
  if (answerType === 'type_5') return ANSWER_SCORE_5[value] ?? null;
  if (answerType === 'type_10') {
    const raw = Number(value);
    return (!Number.isNaN(raw) && raw >= 1 && raw <= 10) ? (raw - 1) / 9 : null;
  }
  return null;
}

module.exports = { ANSWER_SCORE_5, ANSWER_SCORE_2, normalizeAnswer };
