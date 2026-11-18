import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { must, supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase'

type Profile = { id: string; display_name: string | null; avatar_url: string | null; role: 'admin' | 'dt' | 'visitor'; email: string | null }
type Auth = { session: Session | null; ready: boolean; profile: Profile | null; signOut: () => Promise<void> }
const Ctx = createContext<Auth>({ session: null, ready: false, profile: null, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  const uid = session?.user.id
  const profile = useQuery({
    queryKey: ['profile', uid], enabled: !!uid,
    queryFn: async () => must(await supabase.from('profiles').select('id,display_name,avatar_url,role,email').eq('id', uid!).maybeSingle()) as Profile | null,
  })
  return <Ctx.Provider value={{ session, ready, profile: profile.data ?? null, signOut: async () => { await supabase.auth.signOut() } }}>{children}</Ctx.Provider>
}
export const useAuth = () => useContext(Ctx)

export async function googleEnabled() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
  if (!r.ok) throw new Error('No se pudo consultar el acceso')
  return Boolean((await r.json())?.external?.google)
}
