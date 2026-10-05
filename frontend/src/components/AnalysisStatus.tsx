import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import './AnalysisStatus.css'

/**
 * 분석 진행 (DESIGN.md §5.B, §10.1). 요청은 하나라 가짜 퍼센트 progress를 만들지 않는다.
 * 결과와 같은 모양의 skeleton + 1초 뒤 한 줄 상태, 5초를 넘으면 보조 문구.
 */
export function AnalysisLoading() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t1 = setTimeout(() => setElapsed(1), 1000)
    const t5 = setTimeout(() => setElapsed(5), 5000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t5)
    }
  }, [])

  return (
    <div className="loading" aria-busy="true">
      <div className="loading__status" aria-live="polite">
        {elapsed >= 1 && (
          <p className="loading__line">
            <span className="spinner" aria-hidden="true" />
            분석 중… 위치 확인 → 지표 계산 → 결과 정리
          </p>
        )}
        {elapsed >= 5 && <p className="loading__sub">처음 분석하는 업종은 조금 더 걸립니다</p>}
      </div>
      <div className="loading__skeleton" aria-hidden="true">
        <span className="skeleton skeleton--overall" />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skeleton skeleton--row" />
        ))}
        <span className="skeleton skeleton--meta" />
      </div>
    </div>
  )
}

/** 분석 전 빈 상태 (§10.2): line icon + 안내 + 3단계. 일러스트 없음 */
export function AnalysisEmpty() {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name="map-pin" size={24} />
      </span>
      <p className="empty__text">위치와 업종을 고르면 이곳에 분석 결과가 나옵니다</p>
      <ol className="empty__steps">
        <li>지도에서 위치를 고릅니다</li>
        <li>업종을 고릅니다</li>
        <li>분석하기를 누릅니다</li>
      </ol>
    </div>
  )
}
