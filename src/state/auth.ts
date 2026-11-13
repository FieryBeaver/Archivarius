import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  /** True until the initial getSession() call resolves. */
  loading: boolean
}

export const useAuth = create<AuthState>(() => ({ session: null, loading: true }))

let started = false

/** Wire the store to Supabase auth. Safe to call more than once. */
export function startAuthListener(): void {
  if (started) return
  started = true
  supabase.auth.getSession().then(({ data }) => {
    useAuth.setState({ session: data.session, loading: false })
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({ session, loading: false })
  })
}

export function signOut(): Promise<unknown> {
  return supabase.auth.signOut()
}
