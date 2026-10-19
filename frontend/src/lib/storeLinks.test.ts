import {
  buildStoreLinks,
  fitEncoded,
  GOOGLE_MAPS_URL_MAX,
  NAVER_WEB_SEARCH_VERIFIED,
  naverAppName,
  STORE_LINKS_NOTE,
  storeQueryParts,
} from './storeLinks.ts'

const STORE = { name: '라네이즈PC방', road_address: '인천광역시 부평구 부평대로 3', jibun_address: '인천광역시 부평구 부평동 549-39' }

describe('점포 외부 링크 (storeLinks, 계획 2-4)', () => {
  it('검색어는 상호 → 주소(도로명 우선, 없으면 지번) 순. 공백만 있는 값은 없는 것으로 본다', () => {
    expect(storeQueryParts(STORE)).toEqual(['라네이즈PC방', '인천광역시 부평구 부평대로 3'])
    expect(storeQueryParts({ ...STORE, road_address: null })).toEqual(['라네이즈PC방', '인천광역시 부평구 부평동 549-39'])
    expect(storeQueryParts({ name: '  ', road_address: null, jibun_address: null })).toEqual([])
  })

  it('구글: Maps URLs 검색(api=1, query=<상호>,<주소>), URL 인코딩', () => {
    const links = buildStoreLinks(STORE)!
    expect(links.google).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('라네이즈PC방,인천광역시 부평구 부평대로 3')}`,
    )
    expect(links.google).not.toMatch(/[가-힣 ]/)
  })

  it('네이버: 실측 전(기본)에는 공식 앱 스킴 nmap://search?query=…&appname=…, 실측 통과면 웹 검색 URL', () => {
    const links = buildStoreLinks(STORE)!
    const query = encodeURIComponent('라네이즈PC방 인천광역시 부평구 부평대로 3')
    if (NAVER_WEB_SEARCH_VERIFIED) {
      expect(links.naver).toBe(`https://map.naver.com/p/search/${query}`)
    } else {
      expect(links.naver).toBe(`nmap://search?query=${query}&appname=${encodeURIComponent(naverAppName())}`)
    }
  })

  it('appname은 브라우저 origin(jsdom: http://localhost:3000)', () => {
    expect(naverAppName()).toBe(window.location.origin)
    expect(naverAppName()).toMatch(/^https?:\/\//)
  })

  it('상호가 없으면 주소만으로, 상호·주소가 모두 없으면 링크를 만들지 않는다 (좌표로 검색하지 않는다)', () => {
    const noName = buildStoreLinks({ ...STORE, name: null })!
    expect(noName.google).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('인천광역시 부평구 부평대로 3')}`)
    expect(noName.naver).toContain(encodeURIComponent('인천광역시 부평구 부평대로 3'))
    expect(buildStoreLinks({ name: null, road_address: null, jibun_address: null })).toBeNull()
  })

  it('구글 URL은 2,048자를 넘지 않게 검색어 끝을 자른다(인코딩 길이 기준)', () => {
    const long = { name: '가'.repeat(300), road_address: '나'.repeat(300), jibun_address: null }
    const links = buildStoreLinks(long)!
    expect(links.google.length).toBeLessThanOrEqual(GOOGLE_MAPS_URL_MAX)
    expect(links.google.startsWith(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('가가가')}`)).toBe(true)
    // 짧은 검색어는 자르지 않는다
    expect(fitEncoded('https://x/?q=', '부평', 2048)).toBe(`https://x/?q=${encodeURIComponent('부평')}`)
    // 접미사가 있으면 그 길이도 넣어 센다
    expect(fitEncoded('a=', '가가가가', 'a='.length + 9 * 2 + '&b=1'.length, '&b=1')).toBe(`a=${encodeURIComponent('가가')}&b=1`)
  })

  it('안내 문구는 계획 문서 그대로', () => {
    expect(STORE_LINKS_NOTE).toBe('검색 결과로 열립니다(같은 가게가 아닐 수 있음)')
  })
})
