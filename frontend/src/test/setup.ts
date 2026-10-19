import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// 로컬 frontend/.env의 다크 스타일 ID가 테스트에 들어오지 않게 한다 — 기본은 스타일 없음(밝은 지도, 8-DK 이전과 같은 경로).
// 다크 경로는 MapView.test.tsx가 vi.stubEnv로 켠다
import.meta.env.VITE_NAVER_MAP_STYLE_ID = ''
import.meta.env.VITE_NAVER_MAP_LIGHT_STYLE_ID = ''

// 첫 방문 안내(묶음 D)는 기본으로 완료 상태 — 기존 테스트 화면에 말풍선이 끼지 않게. 온보딩 테스트만 이 값을 지운다
beforeEach(() => {
  try {
    window.localStorage.setItem('onboarding', 'done')
    window.localStorage.setItem('onboarding.result', 'done')
  } catch {
    // jsdom 저장소가 없으면 무시
  }
})

afterEach(() => {
  cleanup()
})

// jsdom에는 ResizeObserver가 없다. App이 sticky 헤더 높이를 관찰하므로(스크롤 여백) 아무 일도 하지 않는 대역을 둔다.
// 크기 변화를 흉내 내야 하는 테스트는 vi.stubGlobal로 덮어쓴다 (MapView.test.tsx)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
