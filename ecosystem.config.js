module.exports = {
  apps: [
    {
      name: 'lighthouse-api',
      script: 'server.js',
      instances: 'max', // CPU 코어 수만큼 인스턴스 생성
      exec_mode: 'cluster', // 클러스터 모드로 실행
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // 로그 설정
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 모니터링 설정
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      
      // 메모리 제한
      max_memory_restart: '1G',
      
      // 헬스체크
      health_check_grace_period: 3000,
      
      // 환경변수
      env_file: '.env'
    }
  ]
}; 