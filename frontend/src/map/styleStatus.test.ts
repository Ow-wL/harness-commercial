import { lastStyleStatus, resetStyleStatusForTest, styleStatusSince } from './styleStatus.ts'

type Entry = { name: string; startTime: number; responseStatus?: number }
let entries: Entry[] = []

beforeEach(() => {
  entries = []
  resetStyleStatusForTest()
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => entries as unknown as PerformanceEntryList)
})

afterEach(() => vi.restoreAllMocks())

const styler = (startTime: number, responseStatus?: number): Entry => ({ name: 'https://oapi.map.naver.com/v3/styler/props?x=1', startTime, responseStatus })

describe('styleStatus — 스타일 요청 결과는 요청한 스타일 ID별로 기억한다 (Codex 검수 2026-10-19)', () => {
  it('t0 이후의 마지막 요청 결과를 돌려주고 그 스타일 ID의 마지막 결과로 기억한다', () => {
    entries = [styler(5, 200), styler(50, 400)]
    expect(styleStatusSince(10, 'dark')).toBe(400)
    expect(lastStyleStatus('dark')).toBe(400)
    expect(styleStatusSince(60, 'dark')).toBeNull()                      // 새 요청 없음
    expect(lastStyleStatus('dark')).toBe(400)                              // 기억은 그대로
  })

  it('다른 스타일의 실패가 정상 스타일의 기억을 덮지 않는다', () => {
    entries = [styler(5, 200)]
    expect(styleStatusSince(0, 'dark')).toBe(200)
    entries = [styler(5, 200), styler(100, 400)]
    expect(styleStatusSince(90, 'bad-light')).toBe(400)
    expect(lastStyleStatus('dark')).toBe(200)
    expect(lastStyleStatus('bad-light')).toBe(400)
    expect(lastStyleStatus('never')).toBeNull()
  })

  it('응답 상태가 없는 항목(브라우저 미지원)은 결과로 세지 않는다', () => {
    entries = [styler(5)]
    expect(styleStatusSince(0, 'dark')).toBeNull()
    expect(lastStyleStatus('dark')).toBeNull()
  })
})
