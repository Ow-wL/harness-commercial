/**
 * 선택형 프로필 입력 칸(R2 13-26) — AI 질문 창과 지원사업 카드(R3 13-33)가 같이 쓴다. 값은 lib/profile 의 writeProfile 로 저장한다(부르는 쪽).
 * 클래스는 질문 창 스타일(AskDialog.css)을 그대로 쓴다.
 */
import { PROFILE_PREFERRED, PROFILE_STAGES } from '../api/schemas.ts'
import { AI_TEXT } from '../content/ai.ts'
import type { Profile } from '../lib/profile.ts'
import './AskDialog.css'

export function ProfileFields({ profile, onChange, open = false }: { profile: Profile; onChange: (p: Profile) => void; open?: boolean }) {
  return (
    <details className="ask__profile" open={open || undefined}>
      <summary>{AI_TEXT.profileTitle}</summary>
      <p className="ask__privacy">{AI_TEXT.profileNote}</p>
      <label className="ask__field">
        창업 단계
        <select
          className="input"
          value={profile.stage ?? ''}
          onChange={(e) => onChange({ ...profile, stage: (e.target.value || null) as Profile['stage'] })}
        >
          <option value="">선택 안 함</option>
          {PROFILE_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="ask__field ask__field--check">
        <input
          type="checkbox"
          checked={profile.youth === true}
          onChange={(e) => onChange({ ...profile, youth: e.target.checked ? true : null })}
        />
        청년(39세 이하)
      </label>
      <fieldset className="ask__field ask__field--pref">
        <legend>우대 조건</legend>
        {PROFILE_PREFERRED.map((p) => (
          <label key={p} className="ask__field--check">
            <input
              type="checkbox"
              checked={profile.preferred.includes(p)}
              onChange={(e) =>
                onChange({ ...profile, preferred: e.target.checked ? [...profile.preferred, p] : profile.preferred.filter((x) => x !== p) })
              }
            />
            {p}
          </label>
        ))}
      </fieldset>
    </details>
  )
}
