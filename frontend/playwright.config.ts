/**
 * 자동 E2E smoke (TASKS 5-3 B, D-035). `npm run e2e` = e2e 용 build(dist-e2e) → backend(엔진 v0.5.1, 같은 origin 서빙)
 * → Playwright(Chromium, 가짜 NAVER SDK). 기본 전체 check 에는 넣지 않고 `scripts/check.py --only e2e` 로 돌린다.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '..')
const PY = [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(existsSync) ?? 'python'
const PORT = 8765

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },              // 첫 반경 분석은 비교 모집단 계산(약 10초)을 기다린다
  workers: 1,                               // backend 하나를 함께 쓴다
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `"${PY}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port ${PORT}`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      FRONTEND_DIST: join(ROOT, 'frontend', 'dist-e2e'),
      SCORING_ENGINE_VERSION: 'v0_5_1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  },
})
