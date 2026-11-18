import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogIn, LogOut } from 'lucide-react'
import { byId, useClubs, useCoaches, usePriceScale, useRules, useSeasons } from '../lib/data'
import { BASE, fmtDate, fmtMoney, fmtNumber } from '../lib/format'
import { googleEnabled, useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { ClubLink, Crest, Empty, Facts, Loading, PageHead, Q, Section } from '../components/ui'

const KIND: Record<string, string> = { purchase: 'Compra', free_signing: 'Jugador libre', club_release: 'Venta al club', loan_start: 'Préstamo', loan_return: 'Fin de préstamo', loan_purchase: 'Compra tras préstamo', swap: 'Intercambio', release_clause: 'Cláusula de rescisión', admin: 'Ajuste' }
const useCurrent = () => { const s = useSeasons(); return s.data?.find((x) => x.is_current) }

export function Market() {
  const clubs = byId(useClubs().data); const season = useCurrent(); const rules = useRules(season?.id)
  const win = useQuery({ queryKey: ['market-window'], queryFn: async () => must(await supabase.from('market_windows').select('*').eq('is_open', true).maybeSingle()) as { closes_at: string | null } | null })
  const list = useQuery({ queryKey: ['transfers'], queryFn: async () => must(await supabase.from('transfers').select('id,kind,amount,from_club,to_club,occurred_at,player:players(id,name)').order('occurred_at', { ascending: false }).limit(50)) as unknown as { id: number; kind: string; amount: number; from_club: number | null; to_club: number | null; occurred_at: string; player: { id: number; name: string } }[] })
  return <>
    <PageHead title="Mercado de pases" lead={win.data ? (win.data.closes_at ? `Abierto hasta el ${fmtDate(win.data.closes_at)}.` : 'Abierto.') : 'El mercado de la web nueva todavía no está abierto.'} />
    {rules.data && <div className="format"><div><b>+{fmtNumber(rules.data.clause_premium_pct)} %</b><span>cláusula sobre el valor del jugador</span></div><div><b>−{fmtNumber(rules.data.release_discount_pct)} %</b><span>al vender un jugador al club</span></div><div><b>{rules.data.squad_size}</b><span>jugadores por plantilla</span></div></div>}
    <Section title="Transferencias"><Q q={list}>{(rows) => rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Jugador</th><th scope="col">Operación</th><th scope="col" className="hide-sm">Desde</th><th scope="col" className="hide-sm">Hacia</th><th className="num" scope="col">Importe</th></tr></thead><tbody>{rows.map((t) => <tr key={t.id}><td><Link to={`/jugadores/${t.player.id}`}>{t.player.name}</Link></td><td>{KIND[t.kind]}</td><td className="hide-sm">{t.from_club ? <ClubLink club={clubs.get(t.from_club)} size={20} /> : 'Libre'}</td><td className="hide-sm">{t.to_club ? <ClubLink club={clubs.get(t.to_club)} size={20} /> : 'Libre'}</td><td className="num">{fmtMoney(t.amount)}</td></tr>)}</tbody></table></div> : <Empty title="Todavía no hay transferencias registradas." />}</Q></Section>
  </>
}

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
        <Section title="Descenso simbólico"><p>Juegan los últimos cuatro puestos. Con 11 clubes, 11.º contra 8.º y 9.º contra 10.º. Los perdedores reciben un descenso simbólico, sin consecuencias para la edición siguiente. No existe una segunda división.</p></Section>
        <Section title="Plantillas y mercado"><p>Cada plantilla tiene hasta {r.squad_size} jugadores: {r.starters} titulares y {r.bench} suplentes. Debe incluir {r.required_stars === 1 ? 'un jugador' : `${r.required_stars} jugadores`} de media {r.star_rating}, y nadie puede superar esa media.</p><p>La cláusula de rescisión equivale al valor del jugador más {fmtNumber(r.clause_premium_pct)} %. Se paga con el mercado abierto y no necesita la aceptación del club dueño. Los jugadores sin valor no tienen cláusula. Al vender un jugador al club se recibe su valor menos {fmtNumber(r.release_discount_pct)} %.</p></Section>
      </div>
      <aside><Section title="Precio según media" className="section--tint"><Q q={prices}>{(p) => <Facts items={p.filter((x) => x.value > 0).map((x) => [String(x.overall), fmtMoney(x.value)])} />}</Q><p className="note">Media {r.star_rating} y media 67 o menor: sin costo. Más de {r.star_rating}: no elegible.</p></Section></aside>
    </div> : <Empty title="Las reglas de esta temporada todavía no están cargadas." />}</Q>
  </>
}

export function Login() {
  const { session, profile, signOut } = useAuth(); const go = useNavigate()
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
    {session ? <><p>{profile?.role === 'admin' ? 'Administrador' : profile?.role === 'dt' ? 'Director técnico' : 'Tu cuenta todavía no está vinculada a un club.'}</p><button className="btn" onClick={async () => { await signOut(); go('/') }}><LogOut size={16} aria-hidden="true" />Cerrar sesión</button></> : <>
      <p>Los directores técnicos y el administrador ingresan con su cuenta de Google.</p>
      <button className="btn btn--primary" disabled={state === 'busy'} onClick={start}><LogIn size={16} aria-hidden="true" />{state === 'busy' ? 'Conectando' : 'Continuar con Google'}</button>
      {state === 'off' && <p className="form-msg" role="alert">El ingreso con Google todavía no está activado en este proyecto.</p>}
      {state === 'error' && <p className="form-msg" role="alert">No se pudo iniciar sesión. Intentá de nuevo.</p>}
    </>}
  </div>
}

export function Admin() {
  const { session, ready, profile } = useAuth(); const clubs = useClubs(); const coaches = useCoaches(); const seasons = useSeasons()
  const users = useQuery({ queryKey: ['admin-users'], enabled: profile?.role === 'admin', queryFn: async () => must(await supabase.rpc('admin_list_users')) as { id: string; email: string | null; display_name: string | null; role: string; club_id: number | null }[] })
  if (!ready) return <Loading />
  if (!session) return <Empty title="Este panel requiere una cuenta de administrador." action={<Link className="btn btn--primary" to="/ingresar">Ingresar</Link>} />
  if (profile && profile.role !== 'admin') return <Empty title="Tu cuenta no tiene acceso a la administración." action={<Link className="btn" to="/">Volver al inicio</Link>} />
  const map = byId(clubs.data); const cur = seasons.data?.find((s) => s.is_current)
  return <>
    <PageHead title="Panel de administración" lead={`Temporada ${cur?.number ?? ''}`} />
    <div className="format"><div><b>{clubs.data?.length ?? 0}</b><span>clubes</span></div><div><b>{coaches.data?.length ?? 0}</b><span>directores técnicos</span></div><div><b>{users.data?.length ?? 0}</b><span>cuentas registradas</span></div></div>
    <Section title="Usuarios"><Q q={users}>{(rows) => <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Nombre</th><th scope="col" className="hide-sm">Correo</th><th scope="col">Rol</th><th scope="col">Club</th></tr></thead><tbody>{rows.map((u) => <tr key={u.id}><td>{u.display_name}</td><td className="hide-sm">{u.email}</td><td>{u.role === 'admin' ? 'Administrador' : u.role === 'dt' ? 'DT' : 'Visitante'}</td><td>{u.club_id ? <ClubLink club={map.get(u.club_id)} size={20} /> : <span className="muted">Sin club</span>}</td></tr>)}</tbody></table></div>}</Q></Section>
  </>
}

export function NotFound() {
  return <Empty title="Esta página no existe." action={<Link className="btn btn--primary" to="/">Volver al inicio</Link>} />
}
