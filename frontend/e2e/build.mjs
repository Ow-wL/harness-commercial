// E2E 용 production build (TASKS 5-3 B, D-035): 실제 .env(지도 Client ID·스타일)를 읽지 않도록 envDir 를 비어 있는
// e2e 폴더로 두고, 가짜 Client ID 만 넣는다 — SDK 요청은 테스트가 가짜 SDK 로 바꿔 치므로 네트워크로 나가지 않는다.
// 출력은 dist-e2e (git 제외). backend 가 FRONTEND_DIST=frontend/dist-e2e 로 같은 origin 에서 서빙한다(운영과 같은 구조).
import { build } from 'vite'

process.env.VITE_NAVER_MAP_CLIENT_ID = 'e2e-fake-client'
await build({ envDir: 'e2e', build: { outDir: 'dist-e2e', emptyOutDir: true }, logLevel: 'warn' })
