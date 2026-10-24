import { APP_VERSION, RELEASES, formatReleaseDate, productionOf, versionKey, type Deployment } from './patchNotes.ts'

const prod = (date: string, app_version: string, extra: Partial<Deployment> = {}): Deployment => ({
  id: `${date}-${app_version}`,
  date,
  kind: 'production',
  result: 'done',
  app_version,
  source_commit: 'aaaaaaa',
  note: 'x',
  ...extra,
})

describe('패치노트 데이터 (D-031)', () => {
  it('앱 버전은 기준 파일의 최신 버전이고, 목록은 최신순이다', () => {
    expect(APP_VERSION).toBe(RELEASES[0]!.version)
    const keys = RELEASES.map((r) => versionKey(r.version))
    expect([...keys].sort((a, b) => b - a)).toEqual(keys)
    expect(versionKey('v0.0.10')).toBeGreaterThan(versionKey('v0.0.9'))
  })

  it('날짜: 하루는 점 표기, 같은 해 범위는 끝의 연도를 생략', () => {
    expect(formatReleaseDate({ date: '2026-10-19' })).toBe('2026.10.19')
    expect(formatReleaseDate({ date_from: '2026-10-05', date: '2026-10-08' })).toBe('2026.10.05~10.08')
    expect(formatReleaseDate({ date_from: '2025-12-30', date: '2026-01-02' })).toBe('2025.12.30~2026.01.02')
  })

  it('운영 반영: 그 버전 이상을 담은 첫 운영 전환(done)만 — 검증·실패·보류는 아니다', () => {
    const deps = [
      prod('2026-10-08', 'v0.0.1'),
      prod('2026-10-10', 'v0.0.3', { result: 'failed' }),
      prod('2026-10-11', 'v0.0.3', { kind: 'verification', result: 'passed' }),
      prod('2026-10-13', 'v0.0.4'),
    ]
    expect(productionOf('v0.0.1', deps)?.date).toBe('2026-10-08')
    expect(productionOf('v0.0.2', deps)?.date).toBe('2026-10-13')
    expect(productionOf('v0.0.5', deps)).toBeNull()
  })
})
