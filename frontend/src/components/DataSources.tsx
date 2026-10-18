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

/**
 * 관점별 점수 비교 대상 (docs/SCORE_EXPLANATION_AUDIT.md 4장, 엔진 v0.3 코드 기준 정적 내용).
 * 엔진 `meta.정규화_기준`("인천 전체 행정동 백분위")은 고객성에만 맞는 설명이라 화면에 쓰지 않는다.
 * 반경은 응답의 `meta.분석반경_m`을 쓴다.
 */
const comparisons = (radiusM: number) =>
  [
    { perspective: '시장성', target: '인천 11개 구', unit: '지점이 속한 구의 값' },
    { perspective: '고객성', target: '인천 158개 행정동', unit: '지점이 속한 행정동의 값' },
    {
      perspective: '경쟁성',
      target: '인천 158개 행정동의 점포 중심 지점 (점포당 잠재수요는 같은 업종이 있는 지점만)',
      unit: `지점 반경 ${radiusM}m`,
    },
    { perspective: '입지성', target: '인천 158개 행정동의 점포 중심 지점', unit: '지점 좌표' },
    {
      perspective: '안정성',
      target: '같은 업종의 3년 표본이 30건 이상인 인천 구',
      unit: '지점이 속한 구의 같은 업종 값',
    },
  ] as const

/**
 * 결과 주 화면의 서비스 고정 문장 (DESIGN.md §19.6 P1, 사용자 결정 2026-10-16 — 판단 보조 강조안).
 * 엔진 `면책` 원문은 바꾸지 않고 데이터 출처 섹션의 "엔진 면책 원문" 자리에 그대로 둔다
 */
export const SERVICE_DISCLAIMER =
  '공공데이터로 본 참고 지표예요. 창업 결정은 현장 확인과 함께 판단해 주세요. 순위·매출 예측이 아닙니다.'

/** 데이터 출처 · 엔진 면책 원문 (§9 부록, §19.6). 면책은 엔진 `면책` 원문 그대로(라벨과 한 줄 설명만 붙인다). */
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
      <h3 className="result-section__subtitle">점수 비교 대상</h3>
      <p className="result-section__note">
        관점마다 비교 대상이 다릅니다. 세부지표 점수는 비교 대상 대비 백분위이고, 관점·종합 점수는 그 가중평균이라
        인천 내 순위가 아닙니다.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">관점별 점수 비교 대상</caption>
          <thead>
            <tr>
              <th scope="col">관점</th>
              <th scope="col">비교 대상</th>
              <th scope="col">분석 지점 값</th>
            </tr>
          </thead>
          <tbody>
            {comparisons(meta.분석반경_m).map((c) => (
              <tr key={c.perspective}>
                <th scope="row" className="nowrap">
                  {c.perspective}
                </th>
                <td>{c.target}</td>
                <td>{c.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="result-section__note">
        분석 반경 {meta.분석반경_m}m · 업종코드 {meta.업종코드} · 엔진 {meta.엔진버전}
      </p>
      <h3 className="result-section__subtitle">엔진 면책 원문({meta.엔진버전})</h3>
      <p className="result-section__note">분석 엔진이 결과와 함께 내는 문장을 바꾸지 않고 그대로 옮겼습니다.</p>
      <p className="disclaimer">{disclaimer}</p>
    </section>
  )
}
