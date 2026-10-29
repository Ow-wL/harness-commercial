import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/tokens-a3.css'
import './styles/global.css'
import './styles/controls.css'
import App from './App.tsx'
// 인쇄 규칙은 App·컴포넌트 CSS 뒤에 — 같은 우선순위의 화면 규칙이 print 규칙을 덮지 않게 (12-28-R1)
import './styles/print.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
