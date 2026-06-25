# Lighthouse API (`lighthouse-api`) - Claude 참조 문서

> 네이밍 표준화(2026-06-15): 구 `lighthouse_DB_API` → `lighthouse-api`.
> 배포(2026-06-25 클라우드 이전): `main` push → GitHub Actions(`Build & Deploy API`) → Docker 빌드
> → `ghcr.io/gwon6482/lighthouse-api`(public) → **AWS Lightsail 컨테이너** `lighthouse-api`(ap-northeast-2 서울, nano, port 8080) 자동 재배포.
> env는 GitHub Secrets(MONGODB_URI/JWT_SECRET/AWS_*). DB=MongoDB Atlas. 구 홈서버 pm2/port 3000 방식 폐기.
> 전체 매핑은 루트 `NAMING.md`.

## 프로젝트 공유 문서

작업 시작 시 아래 문서를 반드시 참조하세요.

- **전체 개요**: https://github.com/gwon6482/lighthouse-docs/blob/main/overview.md
- **API 진행상황**: https://github.com/gwon6482/lighthouse-docs/blob/main/db-api/progress.md

## 작업 완료 시 규칙

기능 추가/변경이 있으면 `db-api/progress.md`를 업데이트하고 push하세요.

```bash
cd /tmp/lighthouse-docs && git pull
# progress.md 수정 후
git add . && git commit -m "update: [변경 내용]" && git push
cd -
```
