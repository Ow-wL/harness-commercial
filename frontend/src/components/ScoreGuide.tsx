import { useId, useState, type ReactNode } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { GUIDE_LABELS, PERSPECTIVE_GUIDE } from '../content/scoreGuide.ts'
import { BOTTLENECK_WARN_BELOW, formatRatio, groupName, MIN_COVERAGE, type Indicator } from '../lib/format.ts'
import { Icon } from './Icon.tsx'
import './ScoreGuide.css'

type Summary = EngineResult['종합']

/** 접힘 disclosure 1개 (DESIGN.md §7.8). 버튼 aria-expanded로 상태를 알리고, 펼친 내용은 이름 붙은 region. */
function Disclosure({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className={className}>
      <button
        type="button"
        className="button-ghost button-ghost--small guide__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron" data-open={open}>
          <Icon name="chevron-right" />
        </span>
        {label}
      </button>
      {open && (
        <div id={bodyId} role="region" aria-label={label} className="guide__body">
          {children}
        </div>
      )}
    </div>
  )
}

/** 관점 가중치 표기: 0–1 비율을 % 로 (충족률과 같은 규칙). 이 결과의 값은 모두 API 응답에서 온다. */
function weightList(weights: Partial<Record<Indicator['key'], number>>, indicators: readonly Indicator[]): string {
  return indicators
    .map((ind) => `${ind.label} ${weights[ind.key] === undefined ? '제외' : formatRatio(weights[ind.key]!)}`)
    .join(' · ')
}

/**
 * 관점 설명 (DESIGN.md §8.9a). 관점 아코디언 안의 2차 disclosure — 점수가 null이어도 연다.
 * 정적 문장은 content/scoreGuide.ts, "이 결과" 줄은 API 응답(기본·적용 가중치, 타겟 정의, 유인시설 기준).
 */
export function PerspectiveGuide({ indicator: ind, summary }: { indicator: Indicator; summary: Summary }) {
  const guide = PERSPECTIVE_GUIDE[ind.key]
  const applied = summary.적용_가중치[ind.key]
  const userWeighted = summary.가중치_출처 !== '기본(업종그룹)'

  return (
    <Disclosure label={`${ind.label}은 무엇을 보나요`} className="guide">
      <dl className="guide__list">
        <div>
          <dt>{GUIDE_LABELS.measures}</dt>
          <dd>{guide.measures}</dd>
        </div>
        <div>
          <dt>{GUIDE_LABELS.why}</dt>
          <dd>{guide.why}</dd>
        </div>
        <div>
          <dt>{GUIDE_LABELS.origin}</dt>
          <dd>{guide.origin}</dd>
        </div>
        <div>
          <dt>{GUIDE_LABELS.data}</dt>
          <dd>{guide.data}</dd>
        </div>
        <div>
          <dt>{GUIDE_LABELS.limits}</dt>
          <dd>
            <ul className="guide__limits">
              {guide.limits.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>이 결과</dt>
          <dd>
            {ind.key === 'customer' && <span className="guide__fact">이 업종의 타겟: {ind.raw.타겟_정의}</span>}
            {ind.key === 'location' && <span className="guide__fact">이 업종의 유인시설: {ind.raw.유인시설_기준}</span>}
            <span className="guide__fact">
              업종 그룹 기본 가중치 {formatRatio(summary.기본_가중치[ind.key])} ·{' '}
              {applied === undefined
                ? '이번 종합에서는 제외(점수 없음)'
                : `이번 종합에 적용 ${formatRatio(applied)}${userWeighted ? ' (사용자 가중치)' : ''}`}
            </span>
          </dd>
        </div>
      </dl>
    </Disclosure>
  )
}

/**
 * 점수 읽는 법 (DESIGN.md §8.9b). "왜 이런 점수가 나왔나" 섹션 맨 위 disclosure, 기본 접힘.
 * 규칙 설명은 엔진 v0.3 코드·docs/SCORE_EXPLANATION_AUDIT.md 기준, 이 결과의 가중치·충족률은 API 응답 값.
 */
export function ScoreReadingGuide({
  summary,
  meta,
  indicators,
}: {
  summary: Summary
  meta: EngineResult['meta']
  indicators: readonly Indicator[]
}) {
  const scored = indicators.filter((i) => i.score !== null).length

  return (
    <Disclosure label="점수 읽는 법" className="guide guide--reading">
      <section className="guide__section">
        <h3 className="guide__heading">세부지표 점수와 관점·종합 점수</h3>
        <p>
          세부지표 점수는 인천 비교 대상(관점마다 다름, 아래 "데이터 출처"의 비교 대상 표)과 견준 백분위입니다. 높을수록
          좋은 지표는 이 값보다 낮은 곳의 비율, 낮을수록 좋은 지표(동종업종 비중·최근접역 거리·폐업률·임대료)는 이 값과
          같거나 높은 곳의 비율이라 어느 쪽이든 높을수록 유리합니다. 1인 세대 비중은 업종에 따라 50점 쪽으로 당긴 값,
          유인시설 근접도는 시설 종류별 점수의 평균입니다.
        </p>
        <p>
          관점 점수는 세부지표 점수의 가중평균, 종합 점수는 관점 점수의 가중평균입니다. 평균을 거치면 순위 의미가
          사라지므로 관점·종합 점수는 인천 내 순위나 "상위 N%"가 아닙니다. 막대의 50 기준선은 0~100 척도의 중간입니다.
        </p>
      </section>

      <section className="guide__section">
        <h3 className="guide__heading">데이터가 없을 때</h3>
        <p>
          데이터가 없는 세부지표는 0점으로 치지 않고 빼고, 남은 지표의 가중치를 합이 1이 되게 다시 나눕니다. 세부지표가
          설계 가중치의 {formatRatio(MIN_COVERAGE)} 미만만 계산되면 그 관점은 점수를 내지 않고, 종합 점수는 점수를 낸
          관점끼리 가중치를 다시 나눠 계산합니다.
        </p>
        <p className="guide__fact">
          이 결과: 5개 관점 중 {scored}개 산출 · 이번 종합에 적용된 가중치 {weightList(summary.적용_가중치, indicators)}
        </p>
      </section>

      <section className="guide__section">
        <h3 className="guide__heading">충족률 · 신뢰도 · 병목</h3>
        <ul className="guide__limits">
          <li>
            충족률: 관점마다 설계 가중치 중 실제로 계산된 세부지표의 비율입니다. 종합의 데이터 충족률은 점수를 낸 관점의
            가중치 비율입니다(이 결과 {formatRatio(summary.데이터_충족률)}).
          </li>
          <li>
            신뢰도: 데이터 단위와 결측을 반영한 엔진 판정(높음·보통·낮음)입니다. 세부지표 충족률이 80% 미만이면 한 단계,
            50% 미만이면 두 단계 낮아집니다.
          </li>
          <li>
            병목: 5개 관점 중 가장 낮은 점수입니다. 병목 점수가 {BOTTLENECK_WARN_BELOW}점 미만이면 종합 점수와 별개로
            경고하고, 가중치가 바뀌어도 이 기준은 그대로입니다. 종합 점수가 무난해도 한 관점이 크게 낮을 수 있기
            때문입니다.
          </li>
        </ul>
      </section>

      <section className="guide__section">
        <h3 className="guide__heading">업종별 가중치</h3>
        <p>
          업종을 4개 그룹(고객밀착형·유동인구형·목적방문형·체류소비형)으로 나눠 그룹마다 관점 가중치를 다르게 둡니다.
          동네 단골이 중요한 업종과 지나가는 손님이 중요한 업종은 봐야 할 관점이 다르다는 설계 판단이며, 안정성에
          비교적 큰 비중을 둔 것도 "버틸 수 있는가"를 함께 보려는 선택입니다. 이 숫자들은 성공·폐업 사후 데이터로
          검증한 값이 아닙니다(실증 전).
        </p>
        <p className="guide__fact">
          이 업종({meta.업종} · {groupName(meta.업종그룹)}) 기본 가중치: {weightList(summary.기본_가중치, indicators)}
        </p>
      </section>

      <section className="guide__section">
        <h3 className="guide__heading">성공 확률이나 매출 예측이 아닙니다</h3>
        <p>
          점수는 공공데이터 지표를 인천 비교 대상과 견준 값을 합친 것입니다. 창업 성공 확률이나 매출·수익을 예측하지
          않습니다. 인천은 행정동 단위 매출 원자료가 공개되지 않아 매출은 추정하지 않습니다. 임대 조건·유동 동선·경쟁
          점포의 실제 상태는 현장에서 확인해야 합니다.
        </p>
      </section>

      <section className="guide__section">
        <h3 className="guide__heading">일반 웹 분석에서 임대료가 빠지는 이유</h3>
        <p>
          임대료 자료(한국부동산원 소규모상가 임대료)는 인천에서 9개 상권만 공표되고 상권 경계가 이미지로만 제공되어,
          지도에서 고른 위치를 어느 상권에 연결할 근거가 없습니다. 그래서 일반 웹 분석은 모든 위치에서 임대료를 빼고
          안정성을 생존율·폐업률·업력으로 계산합니다. 임대료를 넣어 계산한 보고서의 부평역 예시와 웹 점수가 다를 수
          있습니다.
        </p>
      </section>
    </Disclosure>
  )
}
