import { useId, useState } from 'react'
import { Icon } from './Icon.tsx'
import './ResultTools.css'

/**
 * 결과 활용 줄 (1차 "활용", 계획 1-1·1-2·1-3): 결과·비교 머리 위의 작은 조작 — 링크 복사 · 인쇄 · 보관.
 * - 링크 복사(12-3): 지금 조건의 공유 링크(lib/shareLink)를 클립보드에. 막히면(권한·옛 브라우저) 주소를 읽기 전용 입력란에
 *   보여 직접 복사하게 한다. 링크에는 점수가 없다 — 여는 쪽에서 같은 조건으로 다시 분석한다.
 * - 인쇄(12-15)·보관(보관함)은 부르는 쪽이 넘길 때만 그린다.
 * 결과 내용은 바꾸지 않는다. 분석 요청도 보내지 않는다.
 */
export function ResultTools({
  shareUrl,
  onPrint,
  save,
}: {
  /** 지금 조건의 공유 링크. null 이면 링크 복사 없음 */
  shareUrl: string | null
  /** 인쇄 (브라우저 인쇄 대화상자) */
  onPrint?: () => void
  /** 보관함에 저장. saved: 같은 조건이 이미 보관돼 있음(누르면 지금 결과로 갱신) */
  save?: { saved: boolean; full: boolean; onSave: () => void }
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [fallback, setFallback] = useState(false)
  const inputId = useId()

  const copy = async () => {
    if (!shareUrl) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard 없음')
      await navigator.clipboard.writeText(shareUrl)
      setFallback(false)
      setStatus('링크를 복사했습니다. 링크로 열면 같은 조건으로 다시 분석합니다.')
    } catch {
      setFallback(true)
      setStatus('자동 복사가 되지 않아 아래 주소를 직접 복사하세요.')
    }
  }

  return (
    <div className="result-tools" role="group" aria-label="결과 활용">
      <div className="result-tools__row">
        {shareUrl && (
          <button type="button" className="button-ghost button-ghost--small result-tools__button" onClick={() => void copy()}>
            <Icon name="link" size={16} />
            링크 복사
          </button>
        )}
        {onPrint && (
          <button type="button" className="button-ghost button-ghost--small result-tools__button" onClick={onPrint}>
            <Icon name="printer" size={16} />
            인쇄
          </button>
        )}
        {save && (
          <button
            type="button"
            className="button-ghost button-ghost--small result-tools__button"
            aria-pressed={save.saved}
            onClick={save.onSave}
          >
            <Icon name="bookmark" size={16} />
            {save.saved ? '보관됨 · 갱신' : '보관'}
          </button>
        )}
      </div>
      {status && (
        <p className="result-tools__status" role="status">
          {status}
        </p>
      )}
      {fallback && shareUrl && (
        <p className="result-tools__fallback">
          <label className="visually-hidden" htmlFor={inputId}>
            공유 링크
          </label>
          <input
            id={inputId}
            className="input result-tools__url"
            type="text"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
        </p>
      )}
    </div>
  )
}
