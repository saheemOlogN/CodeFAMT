import { useEffect, useState } from 'react';
import { X, ArrowRight, ShieldCheck } from 'lucide-react';
import { post } from '../api.js';
import { useSession } from '../context/SessionContext.js';

export default function AuthModal({ close }) {
  const { setUser } = useSession();
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (event) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const controls = [
          ...document.querySelectorAll(
            '.modal button:not(:disabled), .modal input:not(:disabled), .modal a[href]',
          ),
        ];
        if (event.shiftKey && document.activeElement === controls[0]) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [close]);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!sent) {
        await post('/auth/otp', { email });
        setSent(true);
      } else {
        const data = await post('/auth/verify', { email, code });
        setUser(data.user);
        close();
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button modal-close" onClick={close} aria-label="Close sign in">
          <X size={20} />
        </button>
        <h1 id="auth-title">{sent ? 'Verify your email' : 'Sign in to CodeFAMT'}</h1>
        <p>
          {sent
            ? `We sent a 6-digit code to ${email}. It is valid for 10 minutes.`
            : 'Use your college email to receive a sign-in code.'}
        </p>
        <form onSubmit={submit}>
          <label>
            {sent ? 'Verification code' : 'College email'}
            {sent ? (
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="000000"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            ) : (
              <input
                autoFocus
                type="email"
                autoComplete="email"
                required
                placeholder="yourname@famt.ac.in"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? 'Please wait…' : sent ? 'Verify & continue' : 'Send verification code'}
            <ArrowRight size={16} />
          </button>
        </form>
        {sent && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode('');
              setError('');
            }}
          >
            Change email or request a new code
          </button>
        )}
        <div className="auth-note">
          <ShieldCheck size={15} />
          @famt.ac.in email addresses only
        </div>
      </section>
    </div>
  );
}
