import { SessionContext } from './context/SessionContext.js';
import AuthModal from './components/AuthModal.jsx';
import Empty from './components/Empty.jsx';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Code2, LogOut, Sun, Moon } from 'lucide-react';
import { api, post } from './api.js';
import Practice from './pages/Practice.jsx';
const Contests = lazy(() => import('./pages/Contests.jsx'));
const Workspace = lazy(() => import('./pages/Workspace.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

export default function App() {
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('codefamt-theme') || 'dark');
  useEffect(() => {
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('codefamt-theme', theme);
  }, [theme]);
  return (
    <SessionContext.Provider value={{ user, setUser, signIn: () => setAuthOpen(true) }}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-icon">
              <Code2 size={23} strokeWidth={2.7} />
            </span>
            Code<span>FAMT</span>
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              Problems
            </NavLink>
            <NavLink to="/contests">Contests</NavLink>
            <NavLink to="/community">Community</NavLink>
            {user?.admin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="header-actions">
            <button
              className="icon-button theme-toggle"
              aria-label="Toggle color theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {user ? (
              <>
                <span className="user-avatar" title={user.email}>
                  {user.name.slice(0, 2).toUpperCase()}
                </span>
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  onClick={async () => {
                    try {
                      await post('/auth/logout', {});
                      setUser(null);
                      window.location.reload();
                    } catch (error) {
                      alert(error.message);
                    }
                  }}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button className="button primary small" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>
      <Suspense
        fallback={
          <div className="empty" role="status">
            Loading…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Practice />} />
          <Route path="/problems/:slug" element={<Workspace />} />
          <Route path="/contests" element={<Contests />} />
          <Route path="/contests/:id" element={<Contests />} />
          <Route path="/community" element={<Community />} />
          <Route path="/admin" element={<Admin />} />
          <Route
            path="*"
            element={
              <Empty title="Page not found">
                <Link to="/">Back to problems</Link>
              </Empty>
            }
          />
        </Routes>
      </Suspense>
      {authOpen && <AuthModal close={() => setAuthOpen(false)} />}
    </SessionContext.Provider>
  );
}
