/** 시간대 구간 표 (R1 13-15). 라벨·범위는 화면 문장에 그대로 쓴다 */
export type TimeBand = { key: 'morning' | 'day' | 'evening' | 'night'; label: string; range: string; hours: readonly number[] }

export const TIME_BANDS: readonly TimeBand[] = [
  { key: 'morning', label: '아침', range: '06~10시', hours: [6, 7, 8, 9, 10] },
  { key: 'day', label: '낮', range: '11~16시', hours: [11, 12, 13, 14, 15, 16] },
  { key: 'evening', label: '저녁', range: '17~21시', hours: [17, 18, 19, 20, 21] },
  { key: 'night', label: '밤', range: '22~05시', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
]
