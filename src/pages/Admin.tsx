import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { byId, useClubs, useCoaches, useMatches, useRules, useSeasonClubs, useSeasons, type Match, type Rules, type Season } from '../lib/data'
import { fmtDate, normalize, PHASE_LABEL } from '../lib/format'
import { useAuth } from '../lib/auth'
import { must, rpc, supabase } from '../lib/supabase'
import { ResultForm } from '../components/ResultForm'
import { ClubLink, Crest, Empty, Field, Loading, MatchRow, PageHead, Q, Section, toast } from '../components/ui'

const TABS = [['temporada', 'Temporada'], ['resultados', 'Resultados'], ['playoffs', 'Playoffs'], ['clubes', 'Clubes'], ['usuarios', 'Usuarios'], ['mercado', 'Mercado'], ['reglas', 'Reglas']] as const
const STATUS: Record<string, string> = { draft: 'Por comenzar', regular: 'Fase regular', playoffs: 'Playoffs', closed: 'Cerrada' }
const CODES: [string, string][] = [['QA', 'Cuartos A'], ['QB', 'Cuartos B'], ['S1', 'Semifinal 1'], ['S2', 'Semifinal 2'], ['F', 'Final'], ['RA', 'Descenso A'], ['RB', 'Descenso B']]

function useAction<T = unknown>(fn: (arg: T) => Promise<unknown>, ok: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => { toast(ok); qc.invalidateQueries() }, onError: (e: Error) => toast(e.message, 'error') })
}

function SeasonTab({ season }: { season: Season }) {
  const matches = useMatches(season.id); const clubs = useClubs(); const ids = useSeasonClubs(season.id)
  const regular = matches.data?.filter((m) => m.phase === 'regular') ?? []; const played = regular.filter((m) => m.status === 'played').length
  const gen = useAction((replace: boolean) => rpc('admin_generate_fixture', { p_season: season.id, p_replace: replace }), 'Fixture generado.')
  const seed = useAction(() => rpc('admin_seed_playoffs', { p_season: season.id }), 'Cruces generados.')
  const close = useAction(() => rpc('admin_close_season', { p_season: season.id }), 'Temporada cerrada y premios acreditados.')
  const next = useAction(() => rpc('admin_create_next_season'), 'Nueva temporada creada.')
  const toggle = useAction(async ({ club, active }: { club: number; active: boolean }) => must(await supabase.from('season_clubs').upsert({ season_id: season.id, club_id: club, is_active: active }).select()), 'Participantes actualizados.')
  const locked = regular.length > 0
  return <>
    <div className="format"><div><b>{season.number}</b><span>temporada actual</span></div><div><b className="is-word">{STATUS[season.status]}</b><span>estado</span></div><div><b>{ids.data?.length ?? 0}</b><span>clubes</span></div><div><b>{played}/{regular.length}</b><span>partidos cargados</span></div></div>
    <Section title="Pasos de la temporada"><div className="panel"><div className="tools">
      <button className="btn btn--primary" disabled={gen.isPending || played > 0} onClick={() => { if (!locked || confirm('¿Reemplazar el fixture actual?')) gen.mutate(locked) }}>{locked ? 'Volver a generar fixture' : 'Generar fixture'}</button>
      <button className="btn" disabled={seed.isPending || !regular.length || played < regular.length} onClick={() => { if (confirm('¿Generar los cruces con la tabla actual?')) seed.mutate(undefined) }}>Generar playoffs</button>
      <button className="btn" disabled={close.isPending || season.status === 'closed'} onClick={() => { if (confirm('¿Cerrar la temporada? Se archiva la tabla y se acreditan los premios.')) close.mutate(undefined) }}>Cerrar temporada</button>
      <button className="btn" disabled={next.isPending || season.status !== 'closed'} onClick={() => next.mutate(undefined)}>Crear temporada {season.number + 1}</button>
    </div></div></Section>
    <Section title="Clubes participantes"><div className="panel">{locked && <p>El fixture ya existe. Para cambiar participantes hay que volver a generarlo antes de cargar resultados.</p>}<div className="club-grid">{clubs.data?.map((c) => <label className="check" key={c.id}><input type="checkbox" disabled={played > 0} checked={ids.data?.includes(c.id) ?? false} onChange={(e) => toggle.mutate({ club: c.id, active: e.target.checked })} /><Crest club={c} size={22} />{c.name}</label>)}</div></div></Section>
  </>
}

function ResultsTab({ season }: { season: Season }) {
  const matches = useMatches(season.id); const clubs = byId(useClubs().data); const [open, setOpen] = useState<number | null>(null); const [only, setOnly] = useState(true)
  return <Q q={matches}>{(rows) => { const list = rows.filter((m) => !only || m.status !== 'played'); return rows.length ? <>
    <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Mostrar solo pendientes</label>
    <div className="matches">{list.map((m) => <div key={m.id}><div className="match-admin"><MatchRow m={m} clubs={clubs} /><button className="btn btn--small" disabled={!m.home_club || !m.away_club} onClick={() => setOpen(open === m.id ? null : m.id)}>{m.phase === 'regular' ? `J${m.round}` : m.bracket_code}: {open === m.id ? 'Cerrar' : 'Cargar'}</button></div>{open === m.id && <ResultForm match={m} home={clubs.get(m.home_club!)!} away={clubs.get(m.away_club!)!} onDone={() => setOpen(null)} />}</div>)}</div>
    {!list.length && <Empty title="No quedan partidos pendientes." />}
  </> : <Empty title="Primero generá el fixture desde Temporada." /> }}</Q>
}

function PlayoffsTab({ season }: { season: Season }) {
  const matches = useMatches(season.id); const clubs = useClubs(); const ids = useSeasonClubs(season.id); const [code, setCode] = useState('RA'); const [h, setH] = useState(''); const [a, setA] = useState('')
  const set = useAction(() => rpc('admin_set_tie', { p_season: season.id, p_code: code, p_home: Number(h), p_away: Number(a) }), 'Cruce guardado.')
  const map = byId(clubs.data); const ko: Match[] = matches.data?.filter((m) => m.phase !== 'regular') ?? []; const opts = ids.data?.map((i) => map.get(i)).filter(Boolean) ?? []
  return <>
    <div className="panel"><strong>Definir un cruce manualmente</strong><p>Usalo para excepciones, o para el descenso cuando participan menos de 10 clubes.</p><div className="form-grid">
      <Field label="Cruce"><select value={code} onChange={(e) => setCode(e.target.value)}>{CODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {[['Local', h, setH], ['Visitante', a, setA]].map(([l, v, fn]) => <Field key={l as string} label={l as string}><select value={v as string} onChange={(e) => (fn as (s: string) => void)(e.target.value)}><option value="">Elegir club</option>{opts.map((c) => <option key={c!.id} value={c!.id}>{c!.name}</option>)}</select></Field>)}
      <button className="btn btn--primary" disabled={!h || !a || h === a || set.isPending} onClick={() => set.mutate(undefined)}>Guardar cruce</button>
    </div></div>
    <Section title="Cruces actuales">{ko.length ? <div className="matches">{ko.map((m) => <MatchRow key={m.id} m={m} clubs={map} />)}</div> : <Empty title="Todavía no hay cruces generados." />}</Section>
    <p className="note">{ko.length ? `Fases: ${[...new Set(ko.map((m) => PHASE_LABEL[m.phase]))].join(', ')}.` : ''}</p>
  </>
}

function ClubsTab({ season }: { season: Season }) {
  const clubs = useClubs(); const matches = useMatches(season.id); const [name, setName] = useState(''); const open = !matches.data?.length
  const add = useAction(async () => { const slug = normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const c = must(await supabase.from('clubs').insert({ name: name.trim(), slug }).select('id').single()) as { id: number }; if (open) must(await supabase.from('season_clubs').insert({ season_id: season.id, club_id: c.id }).select()); setName('') }, 'Club agregado.')
  const flag = useAction(async ({ id, active }: { id: number; active: boolean }) => must(await supabase.from('clubs').update({ is_active: active }).eq('id', id).select()), 'Club actualizado.')
  return <><div className="panel"><strong>Agregar club</strong><p>{open ? 'Se suma a la temporada actual.' : 'La temporada ya tiene fixture: sumalo desde Temporada si corresponde.'}</p><div className="form-grid"><Field label="Nombre"><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field><button className="btn btn--primary" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate(undefined)}>Agregar club</button></div></div>
    <Section title="Clubes"><Q q={clubs}>{(rows) => <div className="table-wrap"><table className="table"><tbody>{rows.map((c) => <tr key={c.id}><td><ClubLink club={c} /></td><td className="num"><button className="btn btn--small" onClick={() => { if (!c.is_active || confirm(`¿Desactivar ${c.name}?`)) flag.mutate({ id: c.id, active: !c.is_active }) }}>{c.is_active ? 'Desactivar' : 'Activar'}</button></td></tr>)}</tbody></table></div>}</Q></Section></>
}

type U = { id: string; email: string | null; display_name: string | null; role: string; club_id: number | null }
function UsersTab() {
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => rpc<U[]>('admin_list_users') }); const clubs = useClubs(); const coaches = useCoaches()
  const assign = useAction(({ user, name, club }: { user: string; name: string; club: number }) => rpc('admin_assign_coach', { p_user: user, p_coach_name: name, p_club: club }), 'Director técnico asignado.')
  return <Q q={users}>{(rows) => rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Usuario</th><th scope="col" className="hide-sm">Correo</th><th scope="col">Rol</th><th scope="col">Club</th></tr></thead><tbody>{rows.map((u) => <tr key={u.id}><td>{u.display_name}</td><td className="hide-sm">{u.email}</td><td>{u.role === 'admin' ? 'Administrador' : u.role === 'dt' ? 'DT' : 'Visitante'}</td><td><select aria-label={`Club de ${u.display_name}`} className="inline-select" value={u.club_id ?? ''} onChange={(e) => { const club = Number(e.target.value); if (!club) return; const known = coaches.data?.find((c) => c.coach_tenures.some((t) => t.is_current && t.club_id === club)); assign.mutate({ user: u.id, name: known?.name ?? u.display_name ?? u.email ?? 'DT', club }) }}><option value="" disabled={!!u.club_id}>Sin club</option>{clubs.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td></tr>)}</tbody></table></div> : <Empty title="Todavía no hay cuentas registradas." />}</Q>
}

function MarketTab({ season }: { season: Season }) {
  const win = useQuery({ queryKey: ['market-admin'], queryFn: async () => must(await supabase.from('market_windows').select('*').eq('is_open', true).maybeSingle()) as { id: number; closes_at: string | null } | null }); const [date, setDate] = useState('')
  const open = useAction(async () => must(await supabase.from('market_windows').insert({ season_id: season.id, closes_at: date ? new Date(date).toISOString() : null }).select()), 'Mercado abierto.')
  const close = useAction(async (id: number) => must(await supabase.from('market_windows').update({ is_open: false, closes_at: new Date().toISOString() }).eq('id', id).select()), 'Mercado cerrado.')
  const expired = !!win.data?.closes_at && new Date(win.data.closes_at) <= new Date()
  return <div className="panel"><strong>{win.data && !expired ? 'El mercado está abierto' : 'El mercado está cerrado'}</strong><p>{expired ? 'El plazo venció. Cerralo para poder abrir uno nuevo.' : win.data?.closes_at ? `Cierra el ${fmtDate(win.data.closes_at)}.` : win.data ? 'Sin fecha de cierre.' : 'Abrilo para que los DT puedan fichar y vender.'}</p>
    {win.data ? <button className="btn btn--danger" disabled={close.isPending} onClick={() => { if (confirm('¿Cerrar el mercado?')) close.mutate(win.data!.id) }}>Cerrar mercado</button> : <div className="form-grid"><Field label="Cierre, opcional"><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></Field><button className="btn btn--primary" disabled={open.isPending} onClick={() => open.mutate(undefined)}>Abrir mercado</button></div>}</div>
}

const TB: [string, string][] = [['points', 'Puntos'], ['goal_diff', 'Diferencia de gol'], ['goals_for', 'Goles a favor'], ['goals_against', 'Goles en contra'], ['wins', 'Victorias'], ['head_to_head', 'Resultado entre empatados']]
function RulesTab({ season }: { season: Season }) {
  const rules = useRules(season.id); const [f, setF] = useState<Rules | null>(null)
  useEffect(() => { if (rules.data) setF(rules.data) }, [rules.data])
  const save = useAction(async () => must(await supabase.from('season_rules').update({ budget: f!.budget, enforce_balance: f!.enforce_balance, squad_size: f!.squad_size, bench: f!.squad_size - 11, star_rating: f!.star_rating, clause_premium_pct: f!.clause_premium_pct, release_discount_pct: f!.release_discount_pct, tiebreakers: f!.tiebreakers }).eq('season_id', season.id).select()), 'Reglas guardadas.')
  if (!f) return <Loading />
  const num = (k: keyof Rules, label: string) => <Field label={label}><input type="number" step="any" value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></Field>
  return <div className="panel"><div className="form-grid">{num('budget', 'Presupuesto (M)')}{num('squad_size', 'Jugadores por plantilla')}{num('star_rating', 'Media del jugador obligatorio')}{num('clause_premium_pct', 'Recargo de cláusula (%)')}{num('release_discount_pct', 'Descuento al vender al club (%)')}
    {[0, 1, 2, 3].map((i) => <Field key={i} label={`Criterio de tabla ${i + 1}`}><select value={f.tiebreakers[i] ?? ''} onChange={(e) => { const next = [...f.tiebreakers]; if (e.target.value) next[i] = e.target.value; else next.splice(i, 1); setF({ ...f, tiebreakers: [...new Set(next.filter(Boolean))] }) }}><option value="">Ninguno</option>{TB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>)}</div>
    <label className="check"><input type="checkbox" checked={f.enforce_balance} onChange={(e) => setF({ ...f, enforce_balance: e.target.checked })} />Bloquear fichajes si no alcanza el saldo</label>
    <button className="btn btn--primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Guardar reglas</button></div>
}

export function Admin() {
  const { session, ready, profileLoading, isAdmin } = useAuth(); const seasons = useSeasons(); const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('seccion')) ? params.get('seccion')! : 'temporada'
  if (!ready || profileLoading) return <Loading />
  if (!session) return <Empty title="Este panel requiere una cuenta de administrador." action={<Link className="btn btn--primary" to="/ingresar">Ingresar</Link>} />
  if (!isAdmin) return <Empty title="Tu cuenta no tiene acceso a la administración." action={<Link className="btn" to="/">Volver al inicio</Link>} />
  const season = seasons.data?.find((s) => s.is_current)
  if (!season) return <Loading />
  return <>
    <PageHead title="Panel de administración" lead={`Temporada ${season.number}`} />
    <div className="admin-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => setParams({ seccion: k })}>{l}</button>)}</div>
    {tab === 'temporada' && <SeasonTab season={season} />}{tab === 'resultados' && <ResultsTab season={season} />}{tab === 'playoffs' && <PlayoffsTab season={season} />}{tab === 'clubes' && <ClubsTab season={season} />}{tab === 'usuarios' && <UsersTab />}{tab === 'mercado' && <MarketTab season={season} />}{tab === 'reglas' && <RulesTab season={season} />}
  </>
}
