# lighthouse-api 인프라 문서

> 2026-06-25 홈서버 PM2 → AWS Lightsail 컨테이너 + ghcr.io 이전.
> 이 문서는 런타임/배포 환경 설명 + 향후 개선 로드맵.

## 0. 요청 흐름

```
[브라우저/FE]
   │  https://api.lighthouse.career/api/...
   ▼
[Route53]  api.lighthouse.career ──CNAME──▶ lighthouse-api.<id>.ap-northeast-2.cs.amazonlightsail.com
   ▼
[Lightsail 컨테이너 서비스]  (서울, TLS 종료: api.lighthouse.career 인증서)
   │  public endpoint :443 → 컨테이너 :8080 (HTTP)
   ▼
[컨테이너 "app"]  node server.js  (이미지: ghcr.io/gwon6482/lighthouse-api:<sha>)
   ├──▶ [MongoDB Atlas]  (클라우드 DB)
   └──▶ [AWS S3]         (인증사진 presign 업로드)
```

옮긴 것은 **Express 앱(컴퓨트) 하나뿐**. DB(Atlas)·파일(S3)은 원래 클라우드라 그대로.

## 1. AWS Lightsail Containers

도커 이미지를 주면 AWS가 기동·재시작·헬스체크·TLS·도메인을 관리하는 **관리형 컨테이너 런타임**. ECS/EKS보다 설정이 적고 요금이 고정. 오토스케일·IAM role·깊은 통합은 약함(소규모 적합).

### 현재 구성
| 항목 | 값 |
|------|-----|
| 서비스명 | `lighthouse-api` |
| power | nano (`nano-1`) = 0.25 vCPU / 512MB |
| scale | 1 노드 |
| region | ap-northeast-2 (서울) |
| 기본 URL | `https://lighthouse-api.52f19kkp27cfg.ap-northeast-2.cs.amazonlightsail.com/` |
| 커스텀 도메인 | api.lighthouse.career (인증서 `api-lighthouse-career`) |
| 포트 | public :443 → 컨테이너 :8080 (HTTP) |
| healthCheck | `/api/health` |
| 비용 | nano×1 = 고정 ~$7/월 |

### 핵심 개념
- **Deployment = 불변 스냅샷**: "이미지 + env + 포트"를 통째로 버전화. 새 배포는 새 버전을 만들고, 헬스체크 통과 후 트래픽 전환(이전 버전은 그때까지 서빙 = **무중단 롤링**).
- **TLS 종료**: Lightsail이 :443 HTTPS를 종료하고 컨테이너 :8080 평문 HTTP로 전달. 앱은 인증서를 몰라도 됨. 커스텀 도메인 인증서는 Lightsail 관리형(자동 갱신).
- **Health check**: `/api/health` 200대면 healthy. 나쁜 배포는 트래픽 못 받고 옛 버전 유지. `/api/health`는 DB 끊겨도 200(상태만 보고) → 재시작 폭주 방지.
- **환경변수**: deployment에 박힘(코드/이미지엔 없음). 배포 시 GitHub Secrets에서 주입.
  - ⚠️ Lightsail은 IAM instance role이 없어 S3 접근용 **정적 AWS 키를 env로** 넣음(ECS 대비 약점).

### vs 옛 홈서버(PM2)
집 PC + pm2(프로세스 관리) → AWS 관리형 컨테이너. 단일 장애점(집 PC) 제거. pm2 제거하고 `node server.js` 단일 프로세스로 단순화.

## 2. GitHub Container Registry (ghcr.io)

도커 이미지 저장소(Docker Hub 역할). GitHub 내장이라 레포·Actions·권한과 자연스럽게 연동.

### 현재 구성
| 항목 | 값 |
|------|-----|
| 이미지 | `ghcr.io/gwon6482/lighthouse-api` |
| 태그 | `:<git-sha>` + `:latest` |
| 가시성 | **public** |
| 빌드 | Dockerfile 멀티스테이지(`node:20-slim`), CI가 빌드 |

### 왜 ECR 아닌 ghcr
- 배포 IAM 유저 `lighthouse-deploy`에 ECR 권한 없음(거부).
- 로컬 Docker 데몬 없어 빌드는 CI가 해야 함 → CI는 GitHub 안이라 ghcr 푸시가 빌트인 `GITHUB_TOKEN`으로 공짜.

### 왜 public 이어야 하나
Lightsail 컨테이너는 자기 전용 레지스트리 또는 **public 외부 이미지만** pull 가능(서드파티 private 레지스트리 인증 미지원). 그래서 ghcr 패키지를 public으로 설정.
- 이미지에 **시크릿 없음**(env는 런타임 주입, `.dockerignore`로 `.env` 제외). 코드 JS 노출은 감수한 트레이드오프. 민감해지면 ECR(private)로 전환.

## 3. CI/CD 파이프라인

`.github/workflows/deploy.yml`, 트리거: **main push**(문서 `.md`만 바뀐 커밋은 `paths-ignore`로 스킵).

```
git push main
  → [Actions] checkout → ghcr 로그인 → docker build(:sha,:latest) → ghcr push
            → AWS 자격증명(Secrets) → aws lightsail create-container-service-deployment
              (스펙 JSON: 이미지=:sha, env=Secrets 주입)
  → [Lightsail] 새 deployment → 이미지 pull → 헬스체크 → 무중단 전환
```

- 시크릿: `MONGODB_URI / JWT_SECRET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY` = GitHub Secrets. 배포 단계에서만 env로 읽혀 스펙에 주입(python으로 처리해 로그 비노출).
- 개발자는 `git push`만 → 빌드·배포 자동. 옛 "SSH + git pull + pm2 restart" 대체.

## 4. 운영 치트시트

| 작업 | 방법 |
|------|------|
| 배포 | 코드 push (자동) |
| 롤백 | 콘솔에서 이전 deployment 재배포 / 옛 `:sha` 이미지로 재배포 |
| 로그 | `aws lightsail get-container-log --service-name lighthouse-api --container-name app` |
| 용량↑ | power(micro/small) 또는 scale 조정 (콘솔/CLI) |
| env 변경 | GitHub Secrets 수정 → 재배포 |
| 비용 | nano×1 고정 ~$7/월 + ghcr public 무료 |

### 알려진 한계
- 오토스케일 없음(수동 power/scale).
- IAM role 없음 → S3용 정적 키 env(키 로테이션 시 Secrets 갱신).
- 이미지 public(시크릿은 없음).
- 단일 리전/단일 노드(멀티 AZ 이중화 아님). 현 단계엔 충분.

---

## 5. 개선 로드맵

현 구성은 "빠르게 살리고 자동화"에 최적화된 1단계. 트래픽/팀이 커지면 단계적으로 견고화.

### Phase A — 현재 (완료)
- Lightsail nano×1 + ghcr(public) + 정적 AWS 키(env) + GitHub Secrets + main push 자동배포.
- 목표: 홈서버 SPOF 제거, 로그인/가입 복구, 배포 자동화. ✅

### Phase B — 보안/자격증명 강화 (다음 권장)
1. **GitHub OIDC → AWS**: 정적 AWS 키(Secrets) 제거. GitHub Actions가 OIDC로 단기 자격증명 가정.
   - 필요: IAM OIDC IdP + 배포 role(레포/브랜치 제한). *현 `lighthouse-deploy`엔 IAM 권한 없음 → 관리자 작업 필요.*
2. **이미지 private화**: ghcr public → **ECR private**(또는 ghcr private + Lightsail 전용 레지스트리 push).
   - ECR 사용 시 Lightsail은 ECR private 직접 pull이 제한적 → 이 단계에서 **ECS/App Runner 검토와 함께** 진행이 자연스러움.
3. **시크릿 관리**: 컨테이너 env 평문 대신 **AWS Secrets Manager / SSM Parameter Store** 참조.

### Phase C — 컴퓨트 견고화
- **ECS Fargate**(서울 지원) 또는 **App Runner**(도쿄, 서울 미지원)로 이전 검토.
  - 이점: **IAM task role**(정적 키 제거, S3는 role로), **오토스케일**, ALB/헬스체크, ECR 네이티브, CloudWatch 통합.
  - 트레이드오프: 설정 복잡도↑, 요금 모델 변화. 트래픽이 nano로 부족할 때 전환.
- 그 전까지는 Lightsail에서 power↑/scale↑로 대응 가능.

### Phase D — 관측성/안정성
- **로그/메트릭**: 컨테이너 로그 → CloudWatch, 에러율/지연 알람.
- **헬스체크 고도화**: `/api/health`가 DB readyState까지 반영하는 별도 readiness 경로 추가 검토.
- **배포 검증**: CI 배포 후 `/api/health` 200 확인 + 실패 시 자동 롤백 단계.
- **백업/DR**: Atlas 백업 정책 점검(앱은 stateless라 이미지 재배포로 복구).

### S3 업로드(진로달성 인증사진)
- **현재(옵션 A, 적용됨)**: 전용 버킷 **`lighthouse-uploads`**(ap-northeast-2), `uploads/*` 공개읽기(버킷정책) + CORS(app/test/localhost).
  - env: `S3_UPLOAD_BUCKET=lighthouse-uploads`, `S3_UPLOAD_PREFIX=uploads`, `S3_UPLOAD_PUBLIC_BASE=https://lighthouse-uploads.s3.ap-northeast-2.amazonaws.com`
  - 키 형식: `uploads/achievements/{uid}/{uuid}.{ext}` (presign PUT → 공개 GET).
  - SPA 호스팅 버킷(lighthouse-career-fe/-app)과 분리 → FE 배포 `--delete`에 안 쓸림.
- **옵션 B(향후 승격): 미디어 CDN 도메인** — 트래픽/이미지 늘면 전환.
  - `media.lighthouse.career` + CloudFront(OAC로 `lighthouse-uploads` 비공개 origin 읽기) + ACM 인증서 + Route53.
  - 그러면 버킷 **Block Public Access 전체 ON**으로 되돌리고(직접 공개 차단), 읽기는 CloudFront만 통하도록.
  - **코드 변경 없이 env `S3_UPLOAD_PUBLIC_BASE`만** `https://media.lighthouse.career` 로 교체하면 A→B 전환.
  - 이점: CDN 캐시·속도, 깔끔한 URL, origin 비공개(보안↑). 비용: CloudFront 배포 1개 추가.
  - 주의: CloudFront create-distribution 권한 확인 필요(현 자격증명 미확인).

### 기타 후속(미결)
- 옛 CloudFront(api `EAW8SQWOOJ150` / admin `E1PH97BDFMT1JF`) 삭제 — 비활성화 후 삭제 진행 중/예정.
- admin → Vercel 이전 완료(별도).
