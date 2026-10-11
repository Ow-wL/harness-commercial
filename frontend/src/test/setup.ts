import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
