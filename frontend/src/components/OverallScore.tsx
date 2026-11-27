import { useId, useState } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { formatScore } from '../lib/format.ts'
import { gradeLabel, gradeOf } from '../lib/grade.ts'
import { scoreHelp } from '../lib/scoreHelp.ts'
import { useCountUp } from '../lib/useCountUp.ts'
import { RegulationBadge } from './ResultAlerts.tsx'
import './OverallScore.css'

/** 점수 고리: 280 기준 반지름 112, 둘레 */
const RING_R = 112
const RING_C = 2 * Math.PI * RING_R

/**
 * 종합 점수 (DESIGN.md §8.1, A3 §19.1): 큰 숫자 + "/ 100" + 등급 글자(13-4, 좋음·보통·약함·주의 — 색과 함께), 오른쪽에
 * "종합 적합도 · 다섯 관점 가중평균 · 순위 아님"과 [이 점수는?](8-C1d, 접힘 — 펼치면 '무엇인지' 한 줄(13-5) + 기존 항목).
 * 학교구역 경고가 있으면 숫자 옆 "규제 확인 필요" 배지(13-1). 종합 null이면 "산출 불가". 가장 높은·낮은 관점은 헤드라인이 맡는다.
 */
export function OverallScore({
  summary,
  engineVersion,
  regulated = false,
}: {
  summary: EngineResult['종합']
  engineVersion: string
  /** 학교구역 규제 경고가 있는 결과(lib/alerts.regulationAlert) */
  regulated?: boolean
}) {
  const userWeighted = summary.가중치_출처 !== '기본(업종그룹)'
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = useId()
  const grade = gradeOf(summary.점수)
  const counting = useCountUp(summary.점수)
  const ringId = useId()
  // 고리는 오르는 숫자를 따라 채워진다(움직임을 줄인 기기에서는 처음부터 최종값)
  const ringValue = counting.running ? counting.value : summary.점수

  return (
    <section className="overall" aria-labelledby="overall-caption">
      <div className="overall__score">
        <div className="overall__dial">
        {/* 점수 고리(13-54, §27): 숫자와 같은 값을 호의 길이로. 꾸밈이라 화면 읽기에서는 숨긴다 — 값은 아래 숫자 글자가 준다 */}
        <svg className="overall__ring" viewBox="0 0 280 280" aria-hidden="true">
          <defs>
            <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="overall__ring-stop overall__ring-stop--a" />
              <stop offset="0.55" className="overall__ring-stop overall__ring-stop--b" />
              <stop offset="1" className="overall__ring-stop overall__ring-stop--c" />
            </linearGradient>
          </defs>
          <circle className="overall__ring-track" cx="140" cy="140" r={RING_R} />
          {ringValue !== null && ringValue > 0 && (
            <circle
              className="overall__ring-arc"
              cx="140"
              cy="140"
              r={RING_R}
              stroke={`url(#${ringId})`}
              strokeDasharray={`${(Math.min(100, ringValue) / 100) * RING_C} ${RING_C}`}
              transform="rotate(-90 140 140)"
            />
          )}
        </svg>
        {summary.점수 === null ? (
          <p className="overall__unavailable">산출 불가</p>
        ) : (
          <p className={`overall__number${grade ? ` overall__number--${grade}` : ''}`}>
            {counting.running && counting.value !== null ? (
              <>
                {/* 결과 공개 연출(13-46): 오르는 숫자는 보이기만, 화면 읽기에는 최종값 */}
                <span className="overall__count" aria-hidden="true">
                  {formatScore(counting.value)}
                </span>
                <span className="visually-hidden">{formatScore(summary.점수)}</span>
              </>
            ) : (
              formatScore(summary.점수)
            )}
            <span className="overall__unit">/ 100</span>
            {grade && (
              <span className={`overall__grade grade grade--${grade}`}>
                <span className="visually-hidden">등급 </span>
                {gradeLabel(summary.점수)}
              </span>
            )}
            <RegulationBadge show={regulated} />
          </p>
        )}
        </div>
        <div className="overall__cap">
          <h2 id="overall-caption" className="overall__caption">
            종합 적합도
          </h2>
          {/* 종합은 관점 점수의 가중평균이라 백분위가 아니다 — "상위 N%"로 바꿔 표시하지 않는다 (docs/SCORE_EXPLANATION_AUDIT.md 3장) */}
          <p className="overall__note">
            {summary.점수 === null ? '점수를 낸 관점이 없어 계산하지 않음' : '다섯 관점 가중평균 · 순위 아님'}
          </p>
          <button
            type="button"
            className="overall__help-toggle"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((v) => !v)}
          >
            이 점수는?
          </button>
        </div>
      </div>
      {helpOpen && (
        <ul id={helpId} className="overall__help" aria-label="이 점수는?">
          {scoreHelp(engineVersion).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {userWeighted && (
        <p className="overall__weights">
          사용자 가중치 적용({summary.가중치_출처})
          {summary.기본가중치_종합점수 !== undefined &&
            ` · 기본 가중치 점수 ${formatScore(summary.기본가중치_종합점수)}`}
        </p>
      )}
    </section>
  )
}
