# syntax=docker/dockerfile:1
# ── Stage 1: 의존성 설치 (네이티브 모듈 bcrypt 빌드 보장) ──
FROM node:20-slim AS deps
WORKDIR /app
# bcrypt 등 네이티브 모듈에 prebuild 없을 때를 대비한 빌드 도구
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: 런타임 (슬림) ──
FROM node:20-slim AS runtime
ENV NODE_ENV=production
# App Runner 기본 포트. server.js 는 process.env.PORT 를 사용한다.
ENV PORT=8080
WORKDIR /app

# 비루트 사용자로 실행
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node

EXPOSE 8080

# pm2 없이 단일 프로세스로 실행 — 스케일/재시작은 App Runner가 담당
CMD ["node", "server.js"]
