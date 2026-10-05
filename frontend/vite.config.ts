/// <reference types="vitest/config" />
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 서버는 backend API 경로를 그대로 FastAPI로 넘긴다 (backend에 CORS를 추가하지 않는다).
// 대상은 BACKEND_URL(.env, VITE_ 접두어 없음 = 브라우저 번들에 들어가지 않음)로 바꿀 수 있다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/businesses': backend,
        '/analyze': backend,
      },
      fs: {
        // 행정동 경계는 data/geo 원본을 그대로 읽는다 (frontend로 복사하지 않는다, DECISIONS D-009)
        allow: [searchForWorkspaceRoot(process.cwd()), '../data/geo'],
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
