import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Pretendard 를 사이트에 포함(13-53): 글자 범위별로 나뉜 woff2 중 화면에 쓰인 범위만 내려받는다. --font-sans 1순위와 같은 이름
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles/tokens.css'
import './styles/tokens-a3.css'
import './styles/global.css'
import './styles/controls.css'
import App from './App.tsx'
// 터치 목표 44px 은 컴포넌트 CSS 뒤에 — 같은 우선순위의 높이 규칙을 덮는다 (13-50)
import './styles/touch.css'
// 인쇄 규칙은 App·컴포넌트 CSS 뒤에 — 같은 우선순위의 화면 규칙이 print 규칙을 덮지 않게 (12-28-R1)
import './styles/print.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
