/** 거미줄 그래프 좌표 (13-13, components/RadarChart). 순수 함수 — 테스트·다른 화면이 같이 쓴다 */
export type RadarPoint = { x: number; y: number }

/** 다섯 축의 각도(위에서 시계 방향). 순서는 엔진 지표 순서 그대로(시장성→안정성) */
export const radarAngle = (i: number, n: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n

/** 점수 0~100 → 좌표. null 은 중심이 아니라 "없음" — 다각형에서 뺀다(호출 쪽) */
export function radarPoint(i: number, n: number, score: number, r: number, c: number): RadarPoint {
  const a = radarAngle(i, n)
  const d = (Math.max(0, Math.min(100, score)) / 100) * r
  return { x: c + d * Math.cos(a), y: c + d * Math.sin(a) }
}
