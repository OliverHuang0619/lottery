import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Workspace from './Workspace.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {import.meta.env.VITE_STATIC_DASHBOARD === 'true' ? <App /> : <Workspace />}
  </StrictMode>,
)
