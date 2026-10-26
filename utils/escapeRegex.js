// 사용자 입력을 정규식(Mongo $regex·new RegExp)에 넣기 전에 이스케이프한다.
// ⚠️ 그대로 넣으면 `(`·`[` 하나로 500 이 나고(잘못된 패턴), `(a+)+` 같은 입력으로 ReDoS 도 가능하다.
module.exports = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
