import { describe, expect, it } from 'vitest'
import type { Station } from '../api/schemas.ts'
import { matchStations } from './stations.ts'

const S = (name: string, transfer = false): Station => ({ name, lat: 37.5, lng: 126.7, lines: [], transfer })
const STATIONS = [S('부평역', true), S('부평시장역'), S('부평구청역', true), S('동인천역'), S('인천역'), S('송도달빛축제공원역')]

describe('stations — 역 이름 자동완성 (13-17)', () => {
  it('앞부분 일치가 먼저, 그다음 포함 일치. "역"·공백은 무시', () => {
    expect(matchStations(STATIONS, '부평').map((s) => s.name)).toEqual(['부평역', '부평시장역', '부평구청역'])
    expect(matchStations(STATIONS, '부평역').map((s) => s.name)).toEqual(['부평역', '부평시장역', '부평구청역'])
    expect(matchStations(STATIONS, '인천').map((s) => s.name)).toEqual(['인천역', '동인천역'])
    expect(matchStations(STATIONS, ' 송도 ').map((s) => s.name)).toEqual(['송도달빛축제공원역'])
  })

  it('빈 질의는 빈 목록, limit 적용', () => {
    expect(matchStations(STATIONS, '')).toEqual([])
    expect(matchStations(STATIONS, '   ')).toEqual([])
    expect(matchStations(STATIONS, '부', 2)).toHaveLength(2)
  })
})
