import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/auth'
import Brand from './Brand'

export default function Layout({ children }) {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  const isWorkspace = /^\/(problems\/[^/]+|contests\/[^/]+\/problems\/[^/]+)$/.test(location.pathname)
  return (
    <div className={`app-shell${isWorkspace ? ' app-shell-workspace' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to={user ? '/problems' : '/login'} aria-label="CodeFAMT home">
            <Brand />
          </Link>
          {user && <button className="icon-button mobile-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>}
          <nav id="main-navigation" className={menuOpen ? 'navigation-open' : ''} aria-label="Main navigation">
            {user ? (
              <>
                
                <NavLink to="/problems">Problems</NavLink>
                <NavLink to="/contests">Contests</NavLink>
                <NavLink to="/roadmap">Roadmap</NavLink>
                <NavLink to="/leaderboard">Leaderboard</NavLink>
                <NavLink to="/submissions">Submissions</NavLink>
                {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <NavLink to="/register" className="register-link">
                  Create account
                </NavLink>
              </>
            )}
          </nav>
          {user && <div className="header-account"><NavLink className="account-link" to="/profile" title="My profile" aria-label="My profile">{user.name.charAt(0).toUpperCase()}</NavLink></div>}
        </div>
      </header>
      <main id="main">{children}</main>
      {!isWorkspace && <footer className="site-footer">
        <span>CodeFAMT</span>
        <span>Finolex Academy of Management and Technology</span>
      </footer>}
    </div>
  )
}
