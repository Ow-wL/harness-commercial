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

  it('홈 화면 아이콘·manifest·위쪽 띠 색이 있고, manifest 의 아이콘 파일이 public/ 에 있다 (13-50)', () => {
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/)
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.json"/)
    expect(html).toMatch(/<meta name="theme-color" content="#07080A"/)
    const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf-8')) as { start_url: string; icons: { src: string }[] }
    expect(manifest.start_url).toBe('/')
    for (const icon of manifest.icons) expect(existsSync(join(root, 'public', icon.src))).toBe(true)
    expect(existsSync(join(root, 'public', 'apple-touch-icon.png'))).toBe(true)
    expect(JSON.stringify(manifest)).not.toMatch(/run\.app|web\.app|googleapis/)
  })

  it('메타에 클라우드 식별정보가 없고, 미리보기 이미지는 공개된 짧은 주소의 og.png 다 (13-51)', () => {
    expect(html).not.toMatch(/run\.app|googleapis|asia-northeast/)
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/harness-commercial\.web\.app\/og\.png"/)
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/harness-commercial\.web\.app\/"/)
    expect(existsSync(join(root, 'public', 'og.png'))).toBe(true)
  })

  it('public/ 에 favicon.svg·robots.txt 가 있고 robots 는 API 경로를 막는다', () => {
    expect(existsSync(join(root, 'public', 'favicon.svg'))).toBe(true)
    const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf-8')
    for (const p of ['/analyze', '/nearby-stores', '/health', '/businesses']) expect(robots).toContain(`Disallow: ${p}`)
    expect(robots).toContain('Allow: /')
  })
})
