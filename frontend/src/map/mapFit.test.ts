import {
  boundsUsable,
  boxToRect,
  circleBox,
  fitZoom,
  infoPlacementOk,
  infoPlacements,
  panToUsable,
  rasterZoom,
  satisfiesSingle,
  usableArea,
  usableAreaChecked,
} from './mapFit.ts'

describe('mapFit — 사용 영역 U (D-022)', () => {
  it('장애물이 없으면 지도 사각형에서 pad만 뺀다', () => {
    expect(usableArea({ w: 800, h: 600 }, [])).toEqual({ x: 8, y: 8, w: 784, h: 584 })
  })

  it('장애물마다 가장 적게 잃는 변 쪽으로 민다 (왼쪽 아래 범례 → 아래, 오른쪽 위 확대 컨트롤 → 오른쪽)', () => {
    const u = usableArea({ w: 800, h: 600 }, [
      { x: 16, y: 480, w: 160, h: 104 }, // 범례: 아래로 미는 것(120×800)이 왼쪽(176×600)보다 싸다
      { x: 740, y: 10, w: 50, h: 79 }, // SMALL 확대 컨트롤: 오른쪽(60×480)이 위(89×800)보다 싸다
    ], 0)
    expect(u).toEqual({ x: 0, y: 0, w: 740, h: 480 })
  })

  it('퇴화한 U(장애물이 지도를 거의 다 덮어 폭이나 높이가 1/4 미만)는 장애물을 무시한 U로 되돌린다 (13-2, A2)', () => {
    const size = { w: 1400, h: 900 }
    // 지도를 왼쪽부터 거의 끝까지 덮는 장애물: 왼쪽 변으로 밀려 U 폭 0 → 이전에는 zoom 최소·지점이 오른쪽 끝(보고된 증상)
    const cover = [{ x: 0, y: 0, w: 1384, h: 900 }]
    expect(usableAreaChecked(size, cover)).toEqual({ u: { x: 8, y: 8, w: 1384, h: 884 }, degenerate: true })
    expect(usableArea(size, cover)).toEqual(usableArea(size, []))
    // 보통 장애물(오른쪽 결과 패널 398px·위 조건 바)은 그대로
    const normal = [
      { x: 986, y: 0, w: 414, h: 900 },
      { x: 0, y: 0, w: 1400, h: 56 },
    ]
    expect(usableAreaChecked(size, normal)).toEqual({ u: { x: 8, y: 64, w: 970, h: 828 }, degenerate: false })
  })

  it('크기 0인 장애물과 U 밖의 장애물은 무시한다', () => {
    const u = usableArea({ w: 400, h: 300 }, [{ x: 10, y: 10, w: 0, h: 50 }, { x: 500, y: 0, w: 20, h: 20 }], 0)
    expect(u).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
})

describe('mapFit — 원 사각형과 완료 조건', () => {
  const center = { lat: 37.4894, lng: 126.7246 }

  it('원 bbox는 반경을 위도·경도로 바꾼 사각형이다 (경도 폭은 cos(위도)만큼 넓다)', () => {
    const b = circleBox(center.lat, center.lng, 500)
    expect(b.n - b.s).toBeCloseTo(1000 / 111_320, 9)
    expect((b.e - b.w) * Math.cos((center.lat * Math.PI) / 180)).toBeCloseTo(1000 / 111_320, 9)
  })

  it('지도 bounds와 컨테이너 크기로 원의 화면 사각형을 계산한다 (지도 중심의 원은 화면 가운데)', () => {
    const box = circleBox(center.lat, center.lng, 500)
    // 원 bbox의 2배 폭·높이인 지도 → 원은 가운데 절반
    const bounds = circleBox(center.lat, center.lng, 1000)
    const r = boxToRect(box, { bounds, w: 800, h: 800 })
    expect(r.x).toBeCloseTo(200, 0)
    expect(r.w).toBeCloseTo(400, 0)
    expect(r.y + r.h / 2).toBeCloseTo(400, 0)
    expect(r.h).toBeCloseTo(400, 0)
  })

  it('완료 조건: U 안(±1px) + 지름 ≥ U 짧은 변의 절반', () => {
    const u = { x: 0, y: 0, w: 600, h: 400 }
    expect(satisfiesSingle({ x: 100, y: 50, w: 300, h: 300 }, u)).toBe(true)
    expect(satisfiesSingle({ x: 100, y: 50, w: 150, h: 150 }, u)).toBe(false) // 너무 작다(150 < 200)
    expect(satisfiesSingle({ x: 400, y: 50, w: 300, h: 300 }, u)).toBe(false) // 오른쪽으로 넘친다
    expect(satisfiesSingle({ x: -1, y: -1, w: 401, h: 401 }, u)).toBe(true) // ±1px 허용
  })
})

describe('mapFit — 맞춤 zoom (8-B0 직접 계산)', () => {
  const range = { min: 0, max: 21 }

  it('지금 zoom에서 잰 크기가 U에 들어가는 가장 큰 정수 zoom (1 오르면 2배)', () => {
    const u = { x: 0, y: 0, w: 928, h: 720 }
    // 1440 래스터 z15 원 264px → z16에서 528px(≤720), z17이면 1056px로 넘친다
    expect(fitZoom(15, { w: 264, h: 264 }, u, range)).toBe(16)
    // 너무 크면 줄인다: z18에서 2112px → z16
    expect(fitZoom(18, { w: 2112, h: 2112 }, u, range)).toBe(16)
  })

  it('GL·래스터 단위 차이와 무관: 같은 축척이면 화면 크기가 같다 (GL z14 = 래스터 z15)', () => {
    const u = { x: 0, y: 0, w: 928, h: 720 }
    const raster = fitZoom(15, { w: 264, h: 264 }, u, range)
    const gl = fitZoom(14, { w: 264, h: 264 }, u, range)
    expect(raster - gl).toBe(1)
    expect(rasterZoom(gl, 2)).toBe(raster)
    expect(rasterZoom(raster, 1)).toBe(raster)
  })

  it('소수 zoom(GL)은 반올림한 정수에서 계산하고, 그 차이만큼 크기를 고친다', () => {
    const u = { x: 0, y: 0, w: 700, h: 700 }
    // z14.6에서 300px → z15에서 약 396px(≤700), z16 792px 넘침 → 15
    expect(fitZoom(14.6, { w: 300, h: 300 }, u, range)).toBe(15)
  })

  it('U나 대상 크기가 0·무한이면 zoom을 바꾸지 않는다 (13-2 — 최소 zoom으로 튀지 않게)', () => {
    const range = { min: 6, max: 21 }
    expect(fitZoom(15, { w: 300, h: 300 }, { x: 8, y: 8, w: 0, h: 884 }, range)).toBe(15)
    expect(fitZoom(15, { w: Infinity, h: 300 }, { x: 8, y: 8, w: 900, h: 884 }, range)).toBe(15)
    expect(fitZoom(15, { w: Number.NaN, h: 300 }, { x: 8, y: 8, w: 900, h: 884 }, range)).toBe(15)
    expect(fitZoom(15, { w: 0, h: 0 }, { x: 8, y: 8, w: 900, h: 884 }, range)).toBe(15)
  })

  it('지도 bounds 유효성: 유한하고 동>서·북>남 (13-2)', () => {
    expect(boundsUsable({ s: 37.4, n: 37.6, w: 126.5, e: 126.8 })).toBe(true)
    expect(boundsUsable({ s: 37.5, n: 37.5, w: 126.6, e: 126.6 })).toBe(false)
    expect(boundsUsable({ s: Number.NaN, n: 37.6, w: 126.5, e: 126.8 })).toBe(false)
  })

  it('zoom 범위로 자른다', () => {
    const u = { x: 0, y: 0, w: 900, h: 900 }
    expect(fitZoom(15, { w: 1, h: 1 }, u, { min: 5, max: 20 })).toBe(20)
    expect(fitZoom(15, { w: 1e9, h: 1e9 }, u, { min: 5, max: 20 })).toBe(5)
  })

  it('panBy 값 = 지도 중심 − U 중심 (U가 왼쪽 위로 치우치면 양수)', () => {
    expect(panToUsable({ w: 1440, h: 900 }, { x: 16, y: 120, w: 928, h: 720 })).toEqual({ x: 240, y: -30 })
  })
})

describe('mapFit — 점포 정보창 배치 (분석 핀 가림 피하기)', () => {
  const u = { x: 0, y: 0, w: 800, h: 700 }
  const store = { x: 395, y: 365, w: 10, h: 10 }

  it('핀과 겹치지 않으면 기본 위치 하나뿐', () => {
    const def = { x: 300, y: 220, w: 200, h: 140 }
    expect(infoPlacements(def, store, [{ x: 100, y: 100, w: 16, h: 16 }]).map((p) => p.kind)).toEqual(['default'])
    expect(infoPlacementOk(def, [{ x: 100, y: 100, w: 16, h: 16 }], u)).toBe(true)
  })

  it('핀을 덮으면 기본 → 점포 아래 → 옆(이동이 작은 쪽 먼저) 순으로 후보를 낸다', () => {
    const def = { x: 300, y: 220, w: 200, h: 140 }
    const pin = { x: 440, y: 330, w: 16, h: 16 } // 정보창 오른쪽 아래쪽을 가린다
    const c = infoPlacements(def, store, [pin])
    // 왼쪽은 68px, 오른쪽은 164px 이동 → 왼쪽 먼저
    expect(c.map((p) => p.kind)).toEqual(['default', 'below', 'left', 'right'])
    expect(c[1]).toMatchObject({ offset: { x: 0, y: 375 + 8 - 220 }, disableAnchor: true })
    expect(c[2]).toMatchObject({ offset: { x: 440 - 8 - 500, y: 0 }, anchorSkew: true })
    expect(c[3]).toMatchObject({ offset: { x: 456 + 8 - 300, y: 0 }, anchorSkew: true })
    expect(infoPlacementOk(def, [pin], u)).toBe(false)
  })

  it('맞는 위치: U 밖으로 나가면 안 된다', () => {
    expect(infoPlacementOk({ x: 650, y: 100, w: 200, h: 100 }, [], u)).toBe(false)
    expect(infoPlacementOk({ x: 0, y: 0, w: 200, h: 100 }, [], u)).toBe(true)
  })
})
