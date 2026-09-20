import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
// 注册三个自定义元素（副作用导入，须在渲染前完成）
import './element/registry'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
