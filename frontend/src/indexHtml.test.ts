import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 12-5: index.html 메타·아이콘과 public 정적 파일. 서비스 URL·클라우드 식별정보는 공개 번들에 넣지 않는다 */
const root = process.cwd()
const html = readFileSync(join(root, 'index.html'), 'utf-8')

describe('index.html 메타 (12-5)', () => {
  it('설명·OG·아이콘이 있고, 설명은 순위·매출 예측이 아니라고 밝힌다', () => {
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]*순위나 매출 예측이 아닙니다[^"]*"/)
    expect(html).toMatch(/<meta property="og:title" content="우리동네 상권분석 매니저"/)
    expect(html).toMatch(/<meta\s+property="og:description"\s+content="[^"]+"/)
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/)
  })

  it('메타에 서비스 주소·클라우드 식별정보가 없다', () => {
    expect(html).not.toMatch(/run\.app|googleapis|asia-northeast|og:url|og:image/)
  })

  it('public/ 에 favicon.svg·robots.txt 가 있고 robots 는 API 경로를 막는다', () => {
    expect(existsSync(join(root, 'public', 'favicon.svg'))).toBe(true)
    const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf-8')
    for (const p of ['/analyze', '/nearby-stores', '/health', '/businesses']) expect(robots).toContain(`Disallow: ${p}`)
    expect(robots).toContain('Allow: /')
  })
})
