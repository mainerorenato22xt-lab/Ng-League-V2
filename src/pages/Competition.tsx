import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { byId, useClubs, useMatches, useRules, useSeasonClubs, useSeasons, useStandings, type Match, type Season } from '../lib/data'
import { fmtDate, PHASE_LABEL } from '../lib/format'
import { must, supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ResultForm } from '../components/ResultForm'
import { Bracket, ClubLink, Crest, Empty, ErrorState, Field, Loading, MatchRow, PageHead, Q, Section, StandingsTable, titleColumns, ZoneLegend } from '../components/ui'

function useSelectedSeason() {
  const seasons = useSeasons()
  const [params, setParams] = useSearchParams()
  const available = (seasons.data ?? []).filter((s) => s.number >= 8)
  const n = Number(params.get('temporada'))
  const season = available.find((s) => s.number === n) ?? available.find((s) => s.is_current)
  const select = <Field label="Temporada"><select value={season?.number ?? ''} onChange={(e) => setParams({ temporada: e.target.value })}>{available.map((s) => <option key={s.id} value={s.number}>Temporada {s.number}</option>)}</select></Field>
  return { seasons, season, select }
}

export function relegationColumns(season?: Season, clubs = 11) {
  return season?.number === 8
    ? [{ title: 'Primera ronda', ties: [{ code: 'RA', homeLabel: '7.º de la tabla', awayLabel: '10.º de la tabla' }, { code: 'RB', homeLabel: '8.º de la tabla', awayLabel: '9.º de la tabla' }] }, { title: 'Final de descenso', ties: [{ code: 'RF', homeLabel: 'Perdedor', awayLabel: 'Perdedor' }] }]
    : [{ title: 'Cruces', ties: [{ code: 'RA', homeLabel: `${clubs}.º de la tabla`, awayLabel: `${clubs - 3}.º de la tabla` }, { code: 'RB', homeLabel: `${clubs - 2}.º de la tabla`, awayLabel: `${clubs - 1}.º de la tabla` }] }]
}

export function Division() {
  const { seasons, season, select } = useSelectedSeason()
  const clubsQ = useClubs(); const clubs = byId(clubsQ.data)
  const ids = useSeasonClubs(season?.id); const rules = useRules(season?.id); const matches = useMatches(season?.id)
  if (seasons.isPending || clubsQ.isPending) return <Loading />
  if (seasons.isError) return <ErrorState onRetry={() => seasons.refetch()} />
  const n = ids.data?.length ?? 0
  const rounds = n ? (n % 2 ? n : n - 1) : 0
  return (
    <>
      <PageHead title="Primera división" lead="Una sola división, todos contra todos y playoffs a partido único.">{select}</PageHead>
      <div className="format">
        <div><b>{n}</b><span>clubes</span></div><div><b>{rounds}</b><span>fechas</span></div><div><b>6</b><span>clasifican a playoffs</span></div><div><b>4</b><span>juegan el descenso simbólico</span></div>
      </div>
      <Section title="Participantes"><div className="club-grid">{(ids.data ?? []).map((id) => clubs.get(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name)).map((c) => <ClubLink key={c!.id} club={c} size={30} />)}</div></Section>
      <Section title="Playoffs por el título"><Q q={matches}>{(m) => <Bracket columns={titleColumns} matches={m} clubs={clubs} />}</Q></Section>
      <Section title="Playoffs de descenso simbólico">
        <Q q={matches}>{(m) => <Bracket columns={relegationColumns(season, n || 11)} matches={m} clubs={clubs} />}</Q>
        <p className="note">{season?.number === 8 ? 'La temporada 8 usó el formato anterior, con final de descenso.' : 'Los perdedores de ambos cruces reciben un descenso simbólico, sin consecuencias para la edición siguiente.'}{rules.data && n < 10 && ' Con menos de 10 clubes, el administrador define los cruces.'}</p>
      </Section>
    </>
  )
}

export function Standings() {
  const { seasons, season, select } = useSelectedSeason()
  const clubsQ = useClubs(); const table = useStandings(season); const clubs = byId(clubsQ.data)
  if (seasons.isPending) return <Loading />
  return (
    <>
      <PageHead title="Tabla de posiciones" lead={season?.status === 'closed' ? `Tabla final de la temporada ${season.number}.` : `Temporada ${season?.number}. Se actualiza con cada resultado.`}>{select}</PageHead>
      <Q q={table}>{(rows) => <><StandingsTable rows={rows} clubs={clubs} /><ZoneLegend count={rows.length} /></>}</Q>
    </>
  )
}

export function Fixture() {
  const { seasons, season, select } = useSelectedSeason()
  const clubsQ = useClubs(); const matches = useMatches(season?.id); const clubs = byId(clubsQ.data)
  const [round, setRound] = useState('all')
  const [a, setA] = useState(''); const [b, setB] = useState('')
  const h2h = useQuery({
    queryKey: ['h2h', a, b], enabled: !!a && !!b && a !== b,
    queryFn: async () => must(await supabase.from('matches').select('*').eq('status', 'played').or(`and(home_club.eq.${a},away_club.eq.${b}),and(home_club.eq.${b},away_club.eq.${a})`).order('season_id', { ascending: false })) as Match[],
  })
  const groups = useMemo(() => {
    const out = new Map<string, Match[]>()
    for (const m of matches.data ?? []) { const k = m.phase === 'regular' ? `Jornada ${m.round}` : PHASE_LABEL[m.phase]; out.set(k, [...(out.get(k) ?? []), m]) }
    return [...out]
  }, [matches.data])
  if (seasons.isPending) return <Loading />
  const shown = round === 'all' ? groups : groups.filter(([k]) => k === round)
  const stats = h2h.data?.reduce((s, m) => { const w = m.winner_club; if (w === +a) s.a++; else if (w === +b) s.b++; else s.d++; return s }, { a: 0, b: 0, d: 0 })
  return (
    <>
      <PageHead title="Fixture y resultados" lead={`Temporada ${season?.number}`}>{select}{groups.length > 0 && <Field label="Fecha"><select value={round} onChange={(e) => setRound(e.target.value)}><option value="all">Todas</option>{groups.map(([k]) => <option key={k}>{k}</option>)}</select></Field>}</PageHead>
      <Q q={matches}>{() => shown.length ? <div className="rounds">{shown.map(([k, list]) => <Section key={k} title={k}><div className="matches">{list.map((m) => <MatchRow key={m.id} m={m} clubs={clubs} />)}</div></Section>)}</div> : <Empty title="El fixture de esta temporada todavía no está generado.">Mientras tanto podés consultar los resultados de la temporada 8.<br /><Link className="text-link" to="/fixture?temporada=8">Ver temporada 8</Link></Empty>}</Q>
      <Section title="Historial entre dos clubes">
        <div className="filters filters--two">
          {[[a, setA, 'Primer club'], [b, setB, 'Segundo club']].map(([v, set, l]) => <Field key={l as string} label={l as string}><select value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)}><option value="">Elegir club</option>{clubsQ.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>)}
        </div>
        {a && b && a === b && <p className="note">Elegí dos clubes distintos.</p>}
        {h2h.isFetching && <Loading />}
        {h2h.data && stats && <><div className="format format--small"><div><b>{stats.a}</b><span>victorias de {clubs.get(+a)?.name}</span></div><div><b>{stats.d}</b><span>empates</span></div><div><b>{stats.b}</b><span>victorias de {clubs.get(+b)?.name}</span></div></div>
          {h2h.data.length ? <div className="matches">{h2h.data.map((m) => <MatchRow key={m.id} m={m} clubs={clubs} />)}</div> : <Empty title="No hay partidos registrados entre estos clubes." />}</>}
      </Section>
    </>
  )
}

export function MatchPage() {
  const { isAdmin } = useAuth()
  const { id } = useParams(); const clubsQ = useClubs(); const clubs = byId(clubsQ.data); const seasons = useSeasons()
  const q = useQuery({ queryKey: ['match', id], queryFn: async () => must(await supabase.from('matches').select('*').eq('id', Number(id)).maybeSingle()) as Match | null })
  const events = useQuery({ queryKey: ['events', id], queryFn: async () => must(await supabase.from('match_events').select('id,kind,club_id,minute,raw_player_name,player:players(id,name)').eq('match_id', Number(id)).order('minute')) as unknown as { id: number; kind: string; club_id: number; minute: number | null; raw_player_name: string | null; player: { id: number; name: string } | null }[] })
  return <Q q={q}>{(m) => {
    if (!m) return <Empty title="Este partido no existe." action={<Link className="btn" to="/fixture">Ir al fixture</Link>} />
    const h = m.home_club ? clubs.get(m.home_club) : null; const a = m.away_club ? clubs.get(m.away_club) : null
    const s = seasons.data?.find((x) => x.id === m.season_id)
    const label = { goal: 'Gol', own_goal: 'Gol en contra', assist: 'Asistencia', yellow_card: 'Amarilla', red_card: 'Roja' } as Record<string, string>
    return <>
      <p className="crumb"><Link to={`/fixture?temporada=${s?.number ?? ''}`}>Temporada {s?.number}</Link>, {m.phase === 'regular' ? `jornada ${m.round}` : PHASE_LABEL[m.phase].toLowerCase()}</p>
      <section className="scoreboard">
        <div><Crest club={h} size={76} />{h ? <Link to={`/clubes/${h.slug}`}>{h.name}</Link> : 'Por definir'}</div>
        <strong>{m.status === 'played' ? `${m.home_goals}-${m.away_goals}` : 'vs'}{m.home_penalties != null && <small>Penales {m.home_penalties}-{m.away_penalties}</small>}</strong>
        <div><Crest club={a} size={76} />{a ? <Link to={`/clubes/${a.slug}`}>{a.name}</Link> : 'Por definir'}</div>
      </section>
      <p className="note note--center">{m.scheduled_at ? fmtDate(m.scheduled_at) : 'Sin fecha registrada'}</p>
      {isAdmin && h && a && <Section title="Cargar resultado"><ResultForm match={m} home={h} away={a} /></Section>}
      <Section title="Detalle del partido"><Q q={events}>{(ev) => ev.length ? <ul className="plain-list">{ev.map((e) => <li key={e.id}><Crest club={clubs.get(e.club_id)} size={20} />{label[e.kind]}: {e.player ? <Link to={`/jugadores/${e.player.id}`}>{e.player.name}</Link> : e.raw_player_name}{e.minute != null && ` (${e.minute}')`}</li>)}</ul> : <Empty title="No hay goleadores ni tarjetas registrados para este partido." />}</Q></Section>
    </>
  }}</Q>
}
