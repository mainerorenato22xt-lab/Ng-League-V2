import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { byId, useClubs, useCoaches, useHonours, useSeasons, useSummaries, type Club, type Match, type PlayerRow } from '../lib/data'
import { fmtDec, fmtMoney } from '../lib/format'
import { must, supabase } from '../lib/supabase'
import { Avatar, ClubLink, Crest, Empty, Facts, Loading, MatchRow, PageHead, Q, Rating, Section } from '../components/ui'

const currentCoach = (coaches: ReturnType<typeof useCoaches>['data'], clubId: number) => coaches?.find((c) => c.coach_tenures.some((t) => t.club_id === clubId && t.is_current))

export function ClubsPage() {
  const clubs = useClubs(); const coaches = useCoaches(); const honours = useHonours(); const sums = useSummaries()
  return <>
    <PageHead title="Clubes" lead="Los clubes que forman parte de NG League." />
    <Q q={clubs}>{(rows) => <div className="table-wrap"><table className="table">
      <thead><tr><th scope="col">Club</th><th scope="col" className="hide-sm">Director técnico</th><th className="num" scope="col">Títulos</th><th className="num hide-sm" scope="col">Jugadores</th><th className="num" scope="col">Plantel</th><th className="num hide-sm" scope="col">Media</th></tr></thead>
      <tbody>{rows.map((c) => { const s = sums.data?.find((x) => x.club_id === c.id); const h = honours.data?.find((x) => x.club_id === c.id); const dt = currentCoach(coaches.data, c.id)
        return <tr key={c.id}><td><ClubLink club={c} size={32} /></td><td className="hide-sm">{dt ? <Link to={`/directores-tecnicos/${dt.id}`}>{dt.name}</Link> : <span className="muted">Sin DT</span>}</td><td className="num pts">{h?.titles ?? 0}</td><td className="num hide-sm">{s?.players ?? 0}</td><td className="num">{fmtMoney(s?.squad_value)}</td><td className="num hide-sm">{s?.avg_overall ? fmtDec(s.avg_overall) : 'Sin dato'}</td></tr> })}</tbody>
    </table></div>}</Q>
  </>
}

export function ClubPage() {
  const { slug } = useParams(); const clubsQ = useClubs(); const coaches = useCoaches(); const honours = useHonours(); const sums = useSummaries(); const seasons = useSeasons()
  const clubs = byId(clubsQ.data); const club = clubsQ.data?.find((c) => c.slug === slug)
  const id = club?.id
  const squad = useQuery({ queryKey: ['club-squad', id], enabled: !!id, queryFn: async () => must(await supabase.from('player_directory').select('*').eq('club_id', id!).order('main_position').order('overall', { ascending: false })) as PlayerRow[] })
  const matches = useQuery({ queryKey: ['club-matches', id], enabled: !!id, queryFn: async () => must(await supabase.from('matches').select('*').eq('status', 'played').or(`home_club.eq.${id},away_club.eq.${id}`).order('season_id', { ascending: false }).order('id', { ascending: false })) as Match[] })
  const history = useQuery({ queryKey: ['club-history', id], enabled: !!id, queryFn: async () => must(await supabase.from('season_table_snapshots').select('season_id,position,points,final_rank').eq('club_id', id!)) as { season_id: number; position: number; points: number; final_rank: number | null }[] })
  const rivals = useQuery({ queryKey: ['club-rivals', id], enabled: !!id, queryFn: async () => must(await supabase.from('rivalries').select('*').or(`club_a.eq.${id},club_b.eq.${id}`)) as { id: number; club_a: number; club_b: number; name: string }[] })
  const news = useQuery({ queryKey: ['club-news', id], enabled: !!id, queryFn: async () => must(await supabase.from('news_posts').select('id,title,body').eq('club_id', id!).eq('status', 'published').order('published_at', { ascending: false }).limit(4)) as { id: number; title: string | null; body: string }[] })
  if (clubsQ.isPending) return <Loading />
  if (!club) return <Empty title="Este club no existe." action={<Link className="btn" to="/clubes">Ver clubes</Link>} />
  const s = sums.data?.find((x) => x.club_id === club.id); const h = honours.data?.find((x) => x.club_id === club.id); const dt = currentCoach(coaches.data, club.id)
  const best = squad.data?.filter((p) => p.market_value != null).reduce<PlayerRow | null>((b, p) => (!b || p.market_value! > b.market_value! ? p : b), null)
  return <>
    <header className="club-head" style={club.primary_color ? { borderColor: club.primary_color } : undefined}>
      <Crest club={club} size={112} />
      <div><h1>{club.name}</h1><p>{dt ? <>Dirige <Link to={`/directores-tecnicos/${dt.id}`}>{dt.name}</Link></> : 'Sin director técnico asignado'}</p></div>
      <div className="club-head__titles"><b>{h?.titles ?? 0}</b><span>{h?.titles === 1 ? 'título' : 'títulos'}</span></div>
    </header>
    <div className="two-col">
      <div>
        <Section title="Plantilla actual" to={`/plantillas?club=${club.slug}`} linkLabel="Ver en la cancha">
          <Q q={squad}>{(rows) => rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th className="num" scope="col">Media</th><th scope="col">Jugador</th><th scope="col">Pos</th><th className="num hide-sm" scope="col">Edad</th><th className="num" scope="col">Valor</th></tr></thead><tbody>{rows.map((p) => <tr key={p.id}><td className="num"><Rating value={p.overall} /></td><td><Link to={`/jugadores/${p.id}`}>{p.name}</Link></td><td>{p.position_code}</td><td className="num hide-sm">{p.age ?? 'Sin dato'}</td><td className="num">{fmtMoney(p.market_value)}</td></tr>)}</tbody></table></div> : <Empty title="Este club todavía no tiene plantilla cargada." />}</Q>
        </Section>
        <Section title="Últimos resultados"><Q q={matches}>{(rows) => rows.length ? <div className="matches">{rows.slice(0, 6).map((m) => <MatchRow key={m.id} m={m} clubs={clubs} />)}</div> : <Empty title="Este club todavía no tiene partidos registrados." />}</Q></Section>
        <Section title="Historia">{club.history ? <p className="prose">{club.history}</p> : <Empty title="La historia del club todavía no está cargada." />}</Section>
      </div>
      <aside>
        <Section title="Ficha" className="section--tint"><Facts items={[['Fundación', club.founded_year ?? 'Sin dato'], ['Estadio', club.stadium ?? 'Sin dato'], ['Apodo', club.nickname ?? 'Sin dato'], ['Valor del plantel', fmtMoney(s?.squad_value)], ['Media del plantel', s?.avg_overall ? fmtDec(s.avg_overall) : 'Sin dato'], ['Jugador más valioso', best ? <Link to={`/jugadores/${best.id}`}>{best.name}</Link> : 'Sin dato']]} /></Section>
        <Section title="Palmarés"><Facts items={[['Campeonatos', h?.titles ?? 0], ['Subcampeonatos registrados', h?.runner_ups ?? 0], ['Descensos simbólicos registrados', h?.symbolic_relegations ?? 0]]} /></Section>
        <Section title="Temporadas"><Q q={history}>{(rows) => rows.length ? <ul className="plain-list">{rows.map((r) => { const n = seasons.data?.find((x) => x.id === r.season_id)?.number; return <li key={r.season_id}><Link to={`/temporadas/${n}`}>Temporada {n}</Link><span className="push">{r.position}.º, {r.points} pts</span></li> })}</ul> : <Empty title="Sin temporadas registradas." />}</Q></Section>
        {!!rivals.data?.length && <Section title="Clásicos"><ul className="plain-list">{rivals.data.map((r) => { const o: Club | undefined = clubs.get(r.club_a === club.id ? r.club_b : r.club_a); return <li key={r.id}><Crest club={o} size={20} /><span>{r.name}{o ? <small> contra {o.name}</small> : null}</span></li> })}</ul></Section>}
        <Section title="Noticias del club"><Q q={news}>{(rows) => rows.length ? <ul className="plain-list">{rows.map((n) => <li key={n.id}><Link to="/noticias">{n.title ?? n.body.slice(0, 70)}</Link></li>)}</ul> : <Empty title="Este club todavía no publicó noticias." />}</Q></Section>
      </aside>
    </div>
  </>
}

type Snap = { season_id: number; club_id: number; position: number; played: number; won: number; drawn: number; lost: number }
const useSnaps = () => useQuery({ queryKey: ['all-snapshots'], queryFn: async () => must(await supabase.from('season_table_snapshots').select('season_id,club_id,position,played,won,drawn,lost')) as Snap[] })
function coachStats(c: NonNullable<ReturnType<typeof useCoaches>['data']>[number], snaps: Snap[]) {
  const rows = snaps.filter((s) => c.coach_tenures.some((t) => t.club_id === s.club_id && (t.from_season ?? 0) <= s.season_id && (t.to_season ?? 9999) >= s.season_id))
  const t = rows.reduce((a, r) => ({ pj: a.pj + r.played, g: a.g + r.won, e: a.e + r.drawn, p: a.p + r.lost, best: Math.min(a.best, r.position) }), { pj: 0, g: 0, e: 0, p: 0, best: 99 })
  return { ...t, seasons: rows.length, pct: t.pj ? (t.g / t.pj) * 100 : null }
}

export function Coaches() {
  const coaches = useCoaches(); const clubs = byId(useClubs().data); const snaps = useSnaps()
  return <>
    <PageHead title="Directores técnicos" lead="Estadísticas de fase regular registradas desde la temporada 8." />
    <Q q={coaches}>{(rows) => <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Director técnico</th><th scope="col" className="hide-sm">Club actual</th><th className="num" scope="col">PJ</th><th className="num hide-sm" scope="col">G</th><th className="num hide-sm" scope="col">E</th><th className="num hide-sm" scope="col">P</th><th className="num" scope="col">% vict.</th></tr></thead><tbody>
      {rows.map((c) => { const s = coachStats(c, snaps.data ?? []); const t = c.coach_tenures.find((x) => x.is_current); return <tr key={c.id}><td><Link className="club-link" to={`/directores-tecnicos/${c.id}`}><Avatar name={c.name} src={c.avatar_url} size={28} /><span>{c.name}</span></Link></td><td className="hide-sm"><ClubLink club={t ? clubs.get(t.club_id) : null} size={22} /></td><td className="num">{s.pj}</td><td className="num hide-sm">{s.g}</td><td className="num hide-sm">{s.e}</td><td className="num hide-sm">{s.p}</td><td className="num">{s.pct == null ? 'Sin dato' : `${fmtDec(s.pct)} %`}</td></tr> })}
    </tbody></table></div>}</Q>
  </>
}

export function CoachPage() {
  const { id } = useParams(); const coaches = useCoaches(); const clubs = byId(useClubs().data); const snaps = useSnaps(); const honours = useSeasons()
  return <Q q={coaches}>{(rows) => {
    const c = rows.find((x) => x.id === Number(id)); if (!c) return <Empty title="Este director técnico no existe." action={<Link className="btn" to="/directores-tecnicos">Ver directores técnicos</Link>} />
    const s = coachStats(c, snaps.data ?? []); const t = c.coach_tenures.find((x) => x.is_current); const from = honours.data?.find((x) => x.id === t?.from_season)?.number
    return <>
      <header className="club-head"><Avatar name={c.name} src={c.avatar_url} size={96} /><div><h1>{c.name}</h1><p>{t ? <>Dirige a {clubs.get(t.club_id)?.name} desde la temporada {from}</> : 'Sin club actual'}</p></div></header>
      <div className="format"><div><b>{s.seasons}</b><span>temporadas registradas</span></div><div><b>{s.pj}</b><span>partidos</span></div><div><b>{s.g}-{s.e}-{s.p}</b><span>ganados, empatados y perdidos</span></div><div><b>{s.pct == null ? 'Sin dato' : `${fmtDec(s.pct)} %`}</b><span>de victorias</span></div></div>
      <Section title="Mejor posición">{s.seasons ? <p className="big-line">{s.best}.º en fase regular</p> : <Empty title="Todavía no hay temporadas registradas con este club." />}</Section>
      <p className="note">Los títulos y clubes anteriores se agregan cuando se complete el historial de las temporadas 1 a 7.</p>
    </>
  }}</Q>
}
