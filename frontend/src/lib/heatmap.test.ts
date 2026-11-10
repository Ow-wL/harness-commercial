import { heatLayer, heatmapMatches, heatTone, loadHeatmap, resetHeatmapForTest, topDongs, type Heatmap } from './heatmap.ts'

const FILE: Heatmap = {
  engine: 'mvp-0.5.1',
  data: '2026-09',
  radius_m: 500,
  dongs: [
    { gu_code: '28237', gu: '부평구', dong: '부평1동', lat: 37.49, lng: 126.72 },
    { gu_code: '28200', gu: '남동구', dong: '간석4동', lat: 37.46, lng: 126.71 },
    { gu_code: '28710', gu: '강화군', dong: '화도면', lat: 37.6, lng: 126.4 },
  ],
  scores: { I21201: [60.3, 66.1, null] },
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetHeatmapForTest()
})

describe('업종 지도 자료 (13-46, D-045)', () => {
  it('색 구간: 50(인천 동네 평균 지점)을 가운데로 위 파랑 2·회색·아래 주황 2, 점수 없음은 none — 경계값은 위 구간', () => {
    expect([70, 65, 64.9, 55, 54.9, 45, 44.9, 35, 34.9, 0].map(heatTone)).toEqual([
      'high2', 'high2', 'high1', 'high1', 'mid', 'mid', 'low1', 'low1', 'low2', 'low2',
    ])
    expect(heatTone(null)).toBe('none')
    expect(heatTone(undefined)).toBe('none')
  })

  it('서버와 엔진·데이터가 모두 같은 파일만 쓴다 (모르면 쓰지 않는다)', () => {
    expect(heatmapMatches(FILE, { engine: 'mvp-0.5.1', data: '2026-09' })).toBe(true)
    expect(heatmapMatches(FILE, { engine: 'mvp-0.3', data: '2026-09' })).toBe(false)
    expect(heatmapMatches(FILE, { engine: 'mvp-0.5.1', data: '2026-06' })).toBe(false)
    expect(heatmapMatches(FILE, { engine: null, data: '2026-09' })).toBe(false)
  })

  it('업종 층은 경계 열쇠(시군구코드|행정동명)로 점수·이름을 잇고, 높은 동은 점수 없는 동을 빼고 점수순', () => {
    const layer = heatLayer(FILE, 'I21201')!
    expect(layer.scores.get('28237|부평1동')).toBe(60.3)
    expect(layer.scores.get('28710|화도면')).toBeNull()
    expect(layer.names.get('28200|간석4동')).toBe('남동구 간석4동')
    expect(topDongs(layer, 3).map((t) => [t.name, t.score])).toEqual([
      ['남동구 간석4동', 66.1],
      ['부평구 부평1동', 60.3],
    ])
    expect(heatLayer(FILE, 'R10406')).toBeNull()
  })

  it('파일은 한 번만 받고, 실패하면 다음에 다시 받는다. 형식이 다르면 거절한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(FILE), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadHeatmap()).rejects.toThrow('업종 지도 파일 응답 404')
    await expect(loadHeatmap()).resolves.toEqual(FILE)
    await loadHeatmap()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resetHeatmapForTest()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...FILE, scores: { I21201: ['x'] } }))))
    await expect(loadHeatmap()).rejects.toThrow()
  })
})
