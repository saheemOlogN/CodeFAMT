import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './context/auth'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import ProfilePage from './pages/ProfilePage'
import ProblemsPage from './pages/ProblemsPage'
const ProblemPage = lazy(() => import('./pages/ProblemPage'))
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage'))
const SubmissionDetailPage = lazy(() => import('./pages/SubmissionsPage').then(module => ({ default: module.SubmissionDetailPage })))
import ContestsPage from './pages/ContestsPage'
import ContestPage from './pages/ContestPage'
import SolvedPage from './pages/SolvedPage'
import LeaderboardPage from './pages/LeaderboardPage'
const AdminPage = lazy(() => import('./pages/AdminPage'))
import RoadmapPage from './pages/RoadmapPage'
import IntuitionPage from './pages/IntuitionPage'
import { RealtimeProvider } from './context/RealtimeProvider'
import './App.css'
import './Platform.css'
import './pages/ProfilePage.css'

function ProtectedPage({ admin = false, children }) {
  const { user, loading, error, refreshUser } = useAuth()
  if (loading)
    return (
      <div className="page-status" role="status">
        Loading your account...
      </div>
    )
  if (error)
    return (
      <div className="page-status">
        <p role="alert">{error}</p>
        <button onClick={() => refreshUser()}>Try again</button>
      </div>
    )
  if (!user) return <Navigate to="/login" replace />
  if (admin && user.role !== 'admin') return <Navigate to="/profile" replace />
  return children || <ProfilePage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
        <Layout>
          <Suspense fallback={<div className="page-status" role="status">Loading page…</div>}><Routes>
            <Route path="/" element={<Navigate to="/problems" replace />} />
            <Route path="/dashboard" element={<Navigate to="/problems" replace />} />
            <Route path="/problems" element={<ProtectedPage><ProblemsPage /></ProtectedPage>} />
            <Route path="/problems/:problemId" element={<ProtectedPage><ProblemPage /></ProtectedPage>} />
            <Route path="/submissions" element={<ProtectedPage><SubmissionsPage /></ProtectedPage>} />
            <Route path="/submissions/:submissionId" element={<ProtectedPage><SubmissionDetailPage /></ProtectedPage>} />
            <Route path="/contests" element={<ProtectedPage><ContestsPage /></ProtectedPage>} />
            <Route path="/contests/:contestId" element={<ProtectedPage><ContestPage /></ProtectedPage>} />
            <Route path="/contests/:contestId/problems/:problemId" element={<ProtectedPage><ProblemPage /></ProtectedPage>} />
            <Route path="/solved" element={<ProtectedPage><SolvedPage /></ProtectedPage>} />
            <Route path="/leaderboard" element={<ProtectedPage><LeaderboardPage /></ProtectedPage>} />
            <Route path="/roadmap" element={<ProtectedPage><RoadmapPage /></ProtectedPage>} />
            <Route path="/intuition" element={<IntuitionPage />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route
              path="/forgot-password"
              element={<AuthPage mode="reset" />}
            />
            <Route path="/profile" element={<ProtectedPage />} />
            <Route path="/admin" element={<ProtectedPage admin><AdminPage /></ProtectedPage>} />
            <Route path="*" element={<Navigate to="/problems" replace />} />
          </Routes></Suspense>
        </Layout>
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
