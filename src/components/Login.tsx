import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './Login.css'

type Mode = 'signin' | 'signup'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(action: () => Promise<{ error: { message: string } | null }>, success?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await action()
    setBusy(false)
    if (error) setError(error.message)
    else if (success) setNotice(success)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'signin') {
      run(() => supabase.auth.signInWithPassword({ email, password }))
    } else {
      run(() => supabase.auth.signUp({ email, password }), 'Account created. Check your inbox if confirmation is required.')
    }
  }

  function sendMagicLink() {
    if (!email) {
      setError('Enter your email first.')
      return
    }
    run(
      () => supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }),
      'Magic link sent. Check your inbox.',
    )
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">WorldKeeper</h1>
        <p className="login-sub">{mode === 'signin' ? 'Welcome back, worldbuilder.' : 'Start a new world.'}</p>

        <input type="email" placeholder="Email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" required minLength={6} value={password}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)} />

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="login-notice">{notice}</p>}

        <button type="submit" className="btn-primary" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={sendMagicLink}>
          Email me a magic link instead
        </button>

        <p className="login-switch">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button type="button" className="link-button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null) }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  )
}
