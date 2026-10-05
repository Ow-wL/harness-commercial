import type { EngineResult } from '../api/schemas.ts'

/**
 * 데이터 출처·기준시점 표 (DESIGN.md §9 부록). 현재 API에 출처가 없으므로 정적 내용이다.
 * 근거: sources/team_v0.3/00_README.md "데이터 출처", docs/DATA.md. 데이터가 바뀌면 함께 갱신한다.
 */
const SOURCES = [
  { perspective: '경쟁성 · 입지성', name: '소상공인시장진흥공단 상가(상권)정보', asOf: '2026-06-30' },
  { perspective: '고객성', name: '행안부 행정동 성별·연령별 인구, SGIS 행정구역 통계', asOf: '2026-08-31, 2024' },
  { perspective: '시장성', name: '서울시 수도권 생활이동(KT)', asOf: '2026-08' },
  { perspective: '입지성', name: '전국도시철도 역사정보, 전국초중등학교 위치', asOf: '2024-12 / 2026-03' },
  { perspective: '안정성', name: '행안부 인허가: 인터넷컴퓨터게임시설제공업', asOf: '2026-05-07' },
  { perspective: '안정성', name: '행안부 인허가: 일반음식점·휴게음식점 (인천)', asOf: '2026-09-29' },
  { perspective: '안정성 (임대료)', name: '한국부동산원 R-ONE 소규모상가 임대료', asOf: '2026년 2분기' },
  { perspective: '초보자 접근성', name: '법령(식품위생법 등 9개)', asOf: '2026-10-02 확인' },
] as const

/** 데이터 출처 · 면책 (§9 부록). 면책은 엔진 `면책` 원문, 접지 않는다. */
export function DataSources({ meta, disclaimer }: { meta: EngineResult['meta']; disclaimer: string }) {
  return (
    <section id="data-sources" className="result-section" aria-labelledby="sources-title">
      <h2 id="sources-title" className="result-section__title">
        데이터 출처
      </h2>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">사용한 데이터와 기준시점</caption>
          <thead>
            <tr>
              <th scope="col">데이터</th>
              <th scope="col">기준시점</th>
              <th scope="col">쓰는 곳</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td className="nowrap">{s.asOf}</td>
                <td className="nowrap">{s.perspective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="result-section__note">
        {meta.정규화_기준} · 분석 반경 {meta.분석반경_m}m · 엔진 {meta.엔진버전}
      </p>
      <p className="disclaimer">{disclaimer}</p>
    </section>
  )
}
