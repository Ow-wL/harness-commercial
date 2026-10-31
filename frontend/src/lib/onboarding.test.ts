import { act, renderHook } from '@testing-library/react'
import {
  flagsToWrite,
  initialState,
  ONBOARDING_KEY,
  ONBOARDING_RESULT_KEY,
  readFlags,
  reduce,
  stepIndex,
  useOnboarding,
  type OnboardingState,
} from './onboarding.ts'

const fresh = (): OnboardingState => initialState({ tourDone: false, resultDone: false })

// 공용 setup은 안내 완료 상태를 기본으로 둔다(기존 테스트 보호) — 여기서는 첫 방문을 본다
beforeEach(() => window.localStorage.clear())

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('첫 방문 안내 상태 전이 (lib/onboarding)', () => {
  it('첫 방문은 ①위치부터, 다음·다음·확인으로 끝나면 안내 완료 플래그', () => {
    let s = fresh()
    expect(s.step).toBe('location')
    s = reduce(s, { type: 'next' })
    expect(s.step).toBe('business')
    s = reduce(s, { type: 'next' })
    expect(s.step).toBe('analyze')
    s = reduce(s, { type: 'next' })
    expect(s.step).toBeNull()
    expect(s.flags.tourDone).toBe(true)
    expect(s.flags.resultDone).toBe(false)                               // 결과 안내는 별도
  })

  it('행동으로 자동 진행: 위치 선택 → ②, 업종 선택 → ③, 분석 성공 → 안내 완료 + 결과 안내 ④', () => {
    let s = fresh()
    s = reduce(s, { type: 'location-picked' })
    expect(s.step).toBe('business')
    s = reduce(s, { type: 'business-picked' })
    expect(s.step).toBe('analyze')
    s = reduce(s, { type: 'analyzed' })
    expect(s.flags.tourDone).toBe(true)
    expect(s.step).toBe('result')
    s = reduce(s, { type: 'next' })
    expect(s.step).toBeNull()
    expect(s.flags.resultDone).toBe(true)
  })

  it('단계와 맞지 않는 행동은 무시한다 (③에서 위치를 다시 골라도 ①로 돌아가지 않는다)', () => {
    let s = reduce(reduce(fresh(), { type: 'next' }), { type: 'next' })
    expect(s.step).toBe('analyze')
    s = reduce(s, { type: 'location-picked' })
    expect(s.step).toBe('analyze')
    s = reduce(s, { type: 'business-picked' })
    expect(s.step).toBe('analyze')
  })

  it('건너뛰기는 결과 안내(④)까지 안내 전체를 끝내고 저장한다 — 결과 화면에서 새 말풍선이 또 뜨지 않는다(팀 D7)', () => {
    let s = reduce(fresh(), { type: 'skip' })
    expect(s.step).toBeNull()
    expect(s.flags).toEqual({ tourDone: true, resultDone: true })
    s = reduce(s, { type: 'location-picked' })                           // 더는 반응하지 않는다
    expect(s.step).toBeNull()
    s = reduce(s, { type: 'analyzed' })
    expect(s.step).toBeNull()
  })

  it('이미 안내를 마친 사용자(예전 방문)는 첫 결과에서 ④를 따로 보지 않는다 — 다시 보기는 ? 버튼(D7)', () => {
    const s = reduce(initialState({ tourDone: true, resultDone: false }), { type: 'analyzed' })
    expect(s.step).toBeNull()
    expect(reduce(s, { type: 'replay', screen: 'result' }).step).toBe('result')
  })

  it('공유 링크로 바로 결과에 온 첫 방문: ④만 보이고 ①~③은 끝낸 것으로 한다', () => {
    const s = reduce(fresh(), { type: 'analyzed' })
    expect(s.step).toBe('result')
    expect(s.flags.tourDone).toBe(true)
    s.flags.resultDone = false
    expect(reduce(s, { type: 'conditions-shown' }).step).toBeNull()
  })

  it('Escape(dismiss)는 지금 말풍선만 숨기고, 다음 행동을 하면 다음 단계가 다시 보인다 — 저장하지 않는다', () => {
    let s = reduce(fresh(), { type: 'dismiss' })
    expect(s.step).toBeNull()
    expect(s.hidden).toBe('location')
    expect(s.flags.tourDone).toBe(false)
    s = reduce(s, { type: 'next' })                                      // 보이는 말풍선이 없으면 next는 무시
    expect(s.step).toBeNull()
    s = reduce(s, { type: 'location-picked' })
    expect(s.step).toBe('business')
    expect(s.hidden).toBeNull()
  })

  it('두 번째 방문(안내 완료)은 아무것도 보이지 않고, 결과 안내도 완료면 분석 뒤에도 없다', () => {
    let s = initialState({ tourDone: true, resultDone: true })
    expect(s.step).toBeNull()
    s = reduce(s, { type: 'location-picked' })
    s = reduce(s, { type: 'analyzed' })
    expect(s.step).toBeNull()
  })

  it('결과 안내가 열린 채 조건 화면으로 돌아가면 닫히되 완료로 치지 않아 다음 결과에서 다시 보인다', () => {
    let s = reduce(fresh(), { type: 'analyzed' })
    expect(s.step).toBe('result')
    s = reduce(s, { type: 'conditions-shown' })
    expect(s.step).toBeNull()
    expect(s.flags.resultDone).toBe(false)
    s = reduce(s, { type: 'analyzed' })
    expect(s.step).toBe('result')
  })

  it('다시 보기: 분석 전 화면은 ①부터, 결과 화면은 ④ — 완료 상태여도 열린다', () => {
    const done = initialState({ tourDone: true, resultDone: true })
    expect(reduce(done, { type: 'replay', screen: 'conditions' }).step).toBe('location')
    expect(reduce(done, { type: 'replay', screen: 'result' }).step).toBe('result')
  })

  it('stepIndex: ①~③은 n/3, 결과 안내는 단독', () => {
    expect(stepIndex('location')).toEqual({ index: 1, total: 3 })
    expect(stepIndex('analyze')).toEqual({ index: 3, total: 3 })
    expect(stepIndex('result')).toBeNull()
  })
})

describe('저장 (localStorage)', () => {
  it('저장된 값이 없으면 둘 다 미완료, 읽을 수 없으면 둘 다 완료로 본다(반복 노출 방지)', () => {
    expect(readFlags()).toEqual({ tourDone: false, resultDone: false })
    window.localStorage.setItem(ONBOARDING_KEY, 'done')
    expect(readFlags()).toEqual({ tourDone: true, resultDone: false })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readFlags()).toEqual({ tourDone: true, resultDone: true })
  })

  it('flagsToWrite는 false → true 된 키만 돌려준다', () => {
    expect(flagsToWrite({ tourDone: false, resultDone: false }, { tourDone: true, resultDone: false })).toEqual([ONBOARDING_KEY])
    expect(flagsToWrite({ tourDone: true, resultDone: false }, { tourDone: true, resultDone: true })).toEqual([ONBOARDING_RESULT_KEY])
    expect(flagsToWrite({ tourDone: true, resultDone: true }, { tourDone: true, resultDone: true })).toEqual([])
  })

  it('useOnboarding: 완료되면 저장하고, 새로 마운트하면 보이지 않는다', () => {
    const { result, unmount } = renderHook(() => useOnboarding())
    expect(result.current.state.step).toBe('location')
    act(() => result.current.send({ type: 'analyzed' }))                  // 안내 중 첫 결과 → ④
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('done')
    expect(window.localStorage.getItem(ONBOARDING_RESULT_KEY)).toBeNull()
    expect(result.current.state.step).toBe('result')
    act(() => result.current.send({ type: 'next' }))
    expect(window.localStorage.getItem(ONBOARDING_RESULT_KEY)).toBe('done')
    unmount()
    const again = renderHook(() => useOnboarding())
    expect(again.result.current.state.step).toBeNull()
    act(() => again.result.current.send({ type: 'analyzed' }))
    expect(again.result.current.state.step).toBeNull()
  })
})
