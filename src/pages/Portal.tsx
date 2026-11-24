import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogIn, LogOut } from 'lucide-react'
import { byId, useClubs, usePriceScale, useRules, useSeasons } from '../lib/data'
import { BASE, fmtDate, fmtMoney, fmtNumber } from '../lib/format'
import { googleEnabled, useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { Crest, Empty, Facts, PageHead, Q, Section } from '../components/ui'

const useCurrent = () => { const s = useSeasons(); return s.data?.find((x) => x.is_current) }

export function News() {
  const clubs = byId(useClubs().data)
  const q = useQuery({ queryKey: ['news'], queryFn: async () => must(await supabase.from('news_posts').select('*').eq('status', 'published').order('published_at', { ascending: false }).limit(40)) as { id: number; title: string | null; body: string; club_id: number | null; author_name: string; published_at: string }[] })
  return <>
    <PageHead title="Noticias" lead="Novedades oficiales y de cada club." />
    <Q q={q}>{(rows) => rows.length ? <div className="news-feed">{rows.map((n) => <article key={n.id}><header>{n.club_id && <Crest club={clubs.get(n.club_id)} size={30} />}<div><b>{n.title ?? clubs.get(n.club_id ?? 0)?.name ?? 'NG League'}</b><small>{n.author_name}, {fmtDate(n.published_at)}</small></div></header><p className="prose">{n.body}</p></article>)}</div> : <Empty title="Todavía no hay noticias publicadas." />}</Q>
  </>
}

export function Rules() {
  const season = useCurrent(); const rules = useRules(season?.id); const prices = usePriceScale(season?.id)
  const tb: Record<string, string> = { points: 'Puntos', goal_diff: 'Diferencia de gol', goals_for: 'Goles a favor', goals_against: 'Goles en contra', wins: 'Victorias', head_to_head: 'Resultado entre empatados' }
  return <>
    <PageHead title="Reglamento" lead={`Reglas vigentes de la temporada ${season?.number ?? ''}.`} />
    <Q q={rules}>{(r) => r ? <div className="two-col">
      <div className="prose-sections">
        <Section title="Competición"><p>NG League tiene una sola división. Los clubes juegan todos contra todos a una rueda. La victoria vale {r.points_win} puntos, el empate {r.points_draw} y la derrota {r.points_loss}.</p><p>Los desempates se aplican en este orden: {r.tiebreakers.map((t) => tb[t].toLowerCase()).join(', ')}.</p></Section>
        <Section title="Playoffs por el título"><p>Clasifican los seis primeros. En cuartos juegan 3.º contra 6.º y 4.º contra 5.º. En semifinales, 1.º contra el ganador de 4.º-5.º y 2.º contra el ganador de 3.º-6.º. Todos los cruces son a partido único y, si hay empate, se definen por penales.</p></Section>
        <Section title="Descensos"><p>Juegan los últimos cuatro puestos. Con 11 clubes, 11.º contra 8.º y 9.º contra 10.º. Los perdedores suman un descenso, sin consecuencias para la edición siguiente. No existe una segunda división.</p></Section>
        <Section title="Plantillas y mercado"><p>Cada plantilla tiene hasta {r.squad_size} jugadores: {r.starters} titulares y {r.bench} suplentes. Debe incluir {r.required_stars === 1 ? 'un jugador' : `${r.required_stars} jugadores`} de media {r.star_rating}, y nadie puede superar esa media.</p><p>La cláusula de rescisión equivale al valor del jugador más {fmtNumber(r.clause_premium_pct)} %. Se paga con el mercado abierto y no necesita la aceptación del club dueño. Los jugadores sin valor no tienen cláusula. Al dejar libre a un jugador se recibe su valor menos {fmtNumber(r.release_discount_pct)} %.</p></Section>
      </div>
      <aside><Section title="Precio según media" className="section--tint"><Q q={prices}>{(p) => <Facts items={p.filter((x) => x.value > 0).map((x) => [String(x.overall), fmtMoney(x.value)])} />}</Q><p className="note">Media {r.star_rating} y media 67 o menor: sin costo. Más de {r.star_rating}: no elegible.</p></Section></aside>
    </div> : <Empty title="Las reglas de esta temporada todavía no están cargadas." />}</Q>
  </>
}

export function Login() {
  const { session, profile, signOut, clubId } = useAuth(); const go = useNavigate(); const clubs = byId(useClubs().data)
  const [state, setState] = useState<'idle' | 'busy' | 'off' | 'error'>('idle')
  const start = async () => {
    setState('busy')
    try {
      if (!(await googleEnabled())) return setState('off')
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${BASE}` } })
      if (error) setState('error')
    } catch { setState('error') }
  }
  return <div className="login">
    <img src={`${BASE}brand/logo.webp`} alt="" width="86" height="125" />
    <h1>{session ? (profile?.display_name ?? 'Tu cuenta') : 'Ingresar a NG League'}</h1>
    {session ? <><p>{profile?.role === 'admin' ? 'Administrador' : clubId ? `Director técnico de ${clubs.get(clubId)?.name ?? 'tu club'}` : 'Tu cuenta todavía no está vinculada a un club.'}</p>{profile?.role === 'admin' && <Link className="btn btn--primary" to="/administracion">Ir al panel</Link>}<Link className="btn" to="/plantillas">Ir a plantillas</Link><button className="btn" onClick={async () => { await signOut(); go('/') }}><LogOut size={16} aria-hidden="true" />Cerrar sesión</button></> : <>
      <p>Los directores técnicos y el administrador ingresan con su cuenta de Google.</p>
      <button className="btn btn--primary" disabled={state === 'busy'} onClick={start}><LogIn size={16} aria-hidden="true" />{state === 'busy' ? 'Conectando' : 'Continuar con Google'}</button>
      {state === 'off' && <p className="form-msg" role="alert">El ingreso con Google todavía no está activado en este proyecto.</p>}
      {state === 'error' && <p className="form-msg" role="alert">No se pudo iniciar sesión. Intentá de nuevo.</p>}
    </>}
  </div>
}

export function NotFound() {
  return <Empty title="Esta página no existe." action={<Link className="btn btn--primary" to="/">Volver al inicio</Link>} />
}
