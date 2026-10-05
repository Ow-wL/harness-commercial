import { useState } from 'react'
import type { ApiFailure } from '../api/client.ts'
import { errorView, type ErrorAction } from '../lib/errorView.ts'
import { Icon } from './Icon.tsx'
import './ErrorBlock.css'

const TONE_ICON = { info: 'info', warning: 'alert-triangle', danger: 'alert-triangle' } as const

/** 오류 블록 (§10.3): 카드, 왼쪽 아이콘 20px, 제목 + 안내 + 행동 버튼 하나. role="alert" */
export function ErrorBlock({
  failure,
  onAction,
}: {
  failure: ApiFailure
  onAction: (action: ErrorAction) => void
}) {
  const view = errorView(failure)
  return (
    <div className={`error-block error-block--${view.tone}`} role="alert">
      <span className="error-block__icon">
        <Icon name={TONE_ICON[view.tone]} size={20} />
      </span>
      <div className="error-block__content">
        <p className="error-block__title">{view.title}</p>
        {view.body && <p className="error-block__body">{view.body}</p>}
        <button
          type="button"
          className={`button ${view.action.primary ? 'button--primary' : 'button--secondary'}`}
          onClick={() => onAction(view.action.kind)}
        >
          {view.action.label}
        </button>
        {view.requestId && <RequestId id={view.requestId} />}
      </div>
    </div>
  )
}

/** request_id: 작은 보조 정보 + 복사 (§10.3). 굵게·색칠하지 않는다 */
function RequestId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      ?.writeText(id)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }
  return (
    <p className="error-block__request-id">
      <span>
        문의 코드 <span className="mono" title={id}>{id.slice(0, 8)}…</span>
      </span>
      <button type="button" className="button-ghost button-ghost--small" onClick={copy} aria-label={`문의 코드 ${id} 복사`}>
        복사
      </button>
      <span aria-live="polite">{copied ? '복사됨' : ''}</span>
    </p>
  )
}
