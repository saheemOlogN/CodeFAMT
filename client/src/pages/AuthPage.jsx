import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/auth'
import PasswordField from '../components/PasswordField'
import StudentFields from '../components/StudentFields'

export default function AuthPage({ mode }) {
  return <AuthForm key={mode} mode={mode} />
}

function AuthForm({ mode }) {
  const { user, login, loading } = useAuth()
  const [values, setValues] = useState({
    name: '',
    email: '',
    password: '',
    department: '',
    year: '',
    otp: '',
  })
  const [step, setStep] = useState('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const verifying = step === 'otp'
  const completed = step === 'complete'
  const registering = mode === 'register'
  const resetting = mode === 'reset'
  let title = 'Welcome back'
  let description = 'Sign in with your college account.'
  let buttonText = 'Sign in'

  if (registering) {
    title = 'Create your account'
    description = 'Use your @famt.ac.in email to register.'
    buttonText = 'Create account'
  } else if (resetting) {
    title = 'Reset your password'
    description = 'We’ll send a reset code to your college email.'
    buttonText = 'Send reset code'
  }

  if (verifying) {
    title = registering ? 'Verify your email' : 'Choose a new password'
    buttonText = registering ? 'Verify email' : 'Update password'
    description = (
      <>
        Enter the six-digit code sent to
        <br />
        <strong>{values.email.trim().toLowerCase()}</strong>
      </>
    )
  }

  if (completed) {
    title = registering ? 'You’re all set' : 'Password updated'
    description = 'Sign in to continue to CodeFAMT.'
  }

  useEffect(() => {
    document.title = `${title} | CodeFAMT`
  }, [title])

  function change(event) {
    setValues({ ...values, [event.target.name]: event.target.value })
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    const email = values.email.trim().toLowerCase()
    if (!/^[^\s@]+@famt\.ac\.in$/.test(email)) {
      setError('Use your @famt.ac.in college email.')
      return
    }
    if (
      (registering || (resetting && verifying)) &&
      (values.password.length < 8 ||
        !values.password.trim() ||
        new TextEncoder().encode(values.password).length > 72)
    ) {
      setError(
        'Use a password with at least 8 characters and at most 72 bytes.',
      )
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, values.password)
      } else if (registering) {
        await api(verifying ? '/auth/verify-otp' : '/auth/register', {
          method: 'POST',
          body: { ...values, name: values.name.trim(), email },
        })
        if (verifying) {
          setStep('complete')
          setValues({ ...values, password: '', otp: '' })
        } else {
          setStep('otp')
          setCooldown(60)
        }
      } else {
        const data = await api(
          verifying ? '/auth/reset-password' : '/auth/forgot-password',
          {
            method: 'POST',
            body: verifying
              ? { email, otp: values.otp, newPassword: values.password }
              : { email },
          },
        )
        setMessage(data.message)
        setStep(verifying ? 'complete' : 'otp')
        setValues({ ...values, password: '', otp: '' })
        setCooldown(60)
      }
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await api(
        resetting ? '/auth/forgot-password' : '/auth/resend-otp',
        { method: 'POST', body: { email: values.email.trim().toLowerCase() } },
      )
      setMessage(data.message)
      setCooldown(60)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <div className="page-status" role="status">
        Loading your account...
      </div>
    )
  if (user)
    return (
      <Navigate to={user.role === 'admin' ? '/admin' : '/problems'} replace />
    )

  return (
    <section className="auth-page">
      <div
        className={`auth-card ${registering && !verifying && !completed ? 'auth-card-wide' : ''}`}
      >
        <div className="auth-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice notice-success" role="status">
            {message}
          </p>
        )}
        {completed ? (
          <Link className="primary-button full-width" to="/login">
            Go to sign in
          </Link>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {verifying ? (
                <>
                  <label>
                    Verification code
                    <input
                      className="otp-input"
                      name="otp"
                      value={values.otp}
                      onChange={change}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      placeholder="000000"
                    />
                  </label>
                  {resetting && (
                    <PasswordField
                      label="New password"
                      value={values.password}
                      onChange={change}
                      newPassword
                    />
                  )}
                </>
              ) : (
                <>
                  {registering && (
                    <StudentFields values={values} onChange={change} />
                  )}
                  <label>
                    College email
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      value={values.email}
                      onChange={change}
                      maxLength={254}
                      required
                      placeholder="you@famt.ac.in"
                    />
                  </label>
                  {!resetting && (
                    <PasswordField
                      value={values.password}
                      onChange={change}
                      newPassword={registering}
                    />
                  )}
                </>
              )}
              <button className="primary-button" type="submit">
                {busy ? 'Please wait...' : buttonText}
              </button>
            </fieldset>
          </form>
        )}
        {!completed &&
          (verifying ? (
            <div className="verification-actions">
              <p>Didn’t receive a code?</p>
              <button
                className="text-button"
                disabled={busy || cooldown > 0}
                onClick={resend}
              >
                {cooldown ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
              <button
                className="text-button muted"
                disabled={busy}
                onClick={() => {
                  setStep('details')
                  setError('')
                  setMessage('')
                  setValues({ ...values, otp: '' })
                }}
              >
                Edit your details
              </button>
              <p className="small-note">
                Keep this page open until verification is complete.
              </p>
            </div>
          ) : (
            <div className="auth-links">
              {mode === 'login' ? (
                <>
                  <Link to="/forgot-password">Forgot password?</Link>
                  <Link to="/register">Sign up</Link>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <Link to="/login">Sign in</Link>
                </>
              )}
            </div>
          ))}
        {mode === 'login' && error.includes('Verify') && (
          <p className="small-note">
            To finish verification,{' '}
            <Link to="/register">enter your registration details again</Link>.
          </p>
        )}
      </div>
    </section>
  )
}
