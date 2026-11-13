import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './components/Login'
import PageView from './components/PageView'
import ProjectHome from './components/ProjectHome'
import ProjectLayout from './components/ProjectLayout'
import ProjectList from './components/ProjectList'
import { startAuthListener, useAuth } from './state/auth'
import './App.css'

export default function App() {
  const session = useAuth((s) => s.session)
  const loading = useAuth((s) => s.loading)

  useEffect(startAuthListener, [])

  if (loading) return <div className="app-splash">WorldKeeper</div>
  if (!session) return <Login />

  return (
    <Routes>
      <Route path="/" element={<ProjectList />} />
      <Route path="/project/:projectId" element={<ProjectLayout />}>
        <Route index element={<ProjectHome />} />
        <Route path="page/:pageId" element={<PageView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
