import { parseShareQuery, shareQuery, shareUrl, versionsDiffer } from './shareLink.ts'

describe('조건 공유 링크 (12-3) — 쿼리 ↔ 조건', () => {
  it('좌표·업종·반경·비교 B·버전을 읽는다 (좌표는 쓴 숫자 그대로)', () => {
    const c = parseShareQuery('?lat=37.4894&lng=126.7246&biz=R10406&r=1000&blat=37.502726&blng=126.727619&data=2026-06&engine=mvp-0.5.1')
    expect(c).toEqual({
      lat: 37.4894,
      lng: 126.7246,
      biz: 'R10406',
      radius: 1000,
      b: { lat: 37.502726, lng: 126.727619 },
      data: '2026-06',
      engine: 'mvp-0.5.1',
    })
  })

  it('반경·B·버전이 없으면 null 로 둔다 (서버 기본 반경·비교 없음)', () => {
    expect(parseShareQuery('lat=37.4894&lng=126.7246&biz=R10406')).toEqual({
      lat: 37.4894,
      lng: 126.7246,
      biz: 'R10406',
      radius: null,
      b: null,
      data: null,
      engine: null,
    })
  })

  it('조건 키가 하나도 없으면 null (보통 첫 방문)', () => {
    expect(parseShareQuery('')).toBeNull()
    expect(parseShareQuery('?utm=1')).toBeNull()
  })

  it.each([
    ['위도 범위 밖', 'lat=91&lng=126.7&biz=R10406'],
    ['경도가 숫자가 아님', 'lat=37.4&lng=abc&biz=R10406'],
    ['경도 없음', 'lat=37.4&biz=R10406'],
    ['업종 코드 형식 아님', 'lat=37.4&lng=126.7&biz=pcbang'],
    ['업종 없음', 'lat=37.4&lng=126.7'],
    ['반경이 정수가 아님', 'lat=37.4&lng=126.7&biz=R10406&r=5e2'],
    ['반경 0', 'lat=37.4&lng=126.7&biz=R10406&r=0'],
    ['Infinity', 'lat=Infinity&lng=126.7&biz=R10406'],
  ])('필수 조건이 어긋나면 링크 전체를 무시한다: %s', (_name, query) => {
    expect(parseShareQuery(query)).toBeNull()
  })

  it('B 좌표가 어긋나면 B 만 빼고, 버전 태그가 이상하면 그 값만 뺀다', () => {
    const c = parseShareQuery('lat=37.4&lng=126.7&biz=R10406&blat=99&blng=126.7&data=2026%2F06&engine=mvp-0.5.1')
    expect(c?.b).toBeNull()
    expect(c?.data).toBeNull()
    expect(c?.engine).toBe('mvp-0.5.1')
    expect(parseShareQuery('lat=37.4&lng=126.7&biz=R10406&blat=37.5')?.b).toBeNull()
  })

  it('조건 → 쿼리 → 조건이 같다 (왕복)', () => {
    const c = {
      lat: 37.4894,
      lng: 126.7246,
      biz: 'R10406',
      radius: 300,
      b: { lat: 37.5, lng: 126.73 },
      data: '2026-06',
      engine: 'mvp-0.5.1',
    }
    expect(parseShareQuery(shareQuery(c))).toEqual(c)
    const simple = { lat: 37.4894, lng: 126.7246, biz: 'R10406', radius: null, b: null, data: null, engine: null }
    expect(shareQuery(simple)).toBe('lat=37.4894&lng=126.7246&biz=R10406')
    expect(shareUrl(simple, 'https://example.test/')).toBe('https://example.test/?lat=37.4894&lng=126.7246&biz=R10406')
  })
})

describe('링크 시점과 지금 서버의 버전 비교', () => {
  it('둘 다 알고 다를 때만 true — 모르는 쪽이 있으면 비교하지 않는다', () => {
    expect(versionsDiffer({ data: '2026-05', engine: 'mvp-0.5.1' }, { data: '2026-06', engine: 'mvp-0.5.1' })).toBe(true)
    expect(versionsDiffer({ data: '2026-06', engine: 'mvp-0.5' }, { data: '2026-06', engine: 'mvp-0.5.1' })).toBe(true)
    expect(versionsDiffer({ data: '2026-06', engine: 'mvp-0.5.1' }, { data: '2026-06', engine: 'mvp-0.5.1' })).toBe(false)
    expect(versionsDiffer({ data: null, engine: null }, { data: '2026-06', engine: 'mvp-0.5.1' })).toBe(false)
    expect(versionsDiffer({ data: '2026-05', engine: null }, { data: null, engine: null })).toBe(false)
  })
})
