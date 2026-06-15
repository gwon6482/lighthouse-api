const { S3Client } = require('@aws-sdk/client-s3');

// S3 업로드용 클라이언트.
// 자격증명은 명시 env(AWS_ACCESS_KEY_ID/SECRET)가 있으면 사용하고,
// 없으면 SDK 기본 체인(~/.aws, 인스턴스/태스크 프로파일)으로 자동 해석한다.
const REGION = process.env.AWS_REGION || 'ap-northeast-2';

const credentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  : undefined;

const s3Client = new S3Client({ region: REGION, ...(credentials ? { credentials } : {}) });

// 업로드 대상 버킷 / prefix / 공개 URL base
const UPLOAD_BUCKET = process.env.S3_UPLOAD_BUCKET || 'lighthouse-career-fe';
const UPLOAD_PREFIX = (process.env.S3_UPLOAD_PREFIX || 'uploads').replace(/^\/+|\/+$/g, '');
// 공개 조회 URL prefix (CloudFront). 없으면 S3 가상호스팅 URL 로 폴백.
const PUBLIC_BASE = (process.env.S3_UPLOAD_PUBLIC_BASE
  || `https://${UPLOAD_BUCKET}.s3.${REGION}.amazonaws.com`).replace(/\/+$/, '');

// key 로 공개 조회 URL 생성
function publicUrlForKey(key) {
  return `${PUBLIC_BASE}/${key}`;
}

module.exports = {
  s3Client,
  REGION,
  UPLOAD_BUCKET,
  UPLOAD_PREFIX,
  PUBLIC_BASE,
  publicUrlForKey
};
