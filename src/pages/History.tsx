import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { byId, useArchives, useAwards, useClubs, useHonours, useMatches, useScorers, useSeasons, useStandings, type Match } from '../lib/data'
import { must, supabase } from '../lib/supabase'
import { Bracket, ClubLink, Crest, Empty, Loading, PageHead, Q, Section, StandingsTable, titleColumns, ZoneLegend } from '../components/ui'
import { relegationColumns } from './Competition'

export function Champions() {
  const honours = useHonours(); const seasons = useSeasons(); const archives = useArchives(); const clubs = byId(useClubs().data)
  return <>
    <PageHead title="Historial de campeones" lead="Palmarés de NG League, temporada por temporada." />
    <Q q={honours}>{(rows) => <ol className="honours">{rows.filter((r) => r.titles > 0).map((r, i) => <li key={r.club_id} style={{ '--w': `${(r.titles / rows[0].titles) * 100}%` } as React.CSSProperties}><span className="honours__pos">{i + 1}</span><ClubLink club={clubs.get(r.club_id)} size={38} /><b>{r.titles}</b></li>)}</ol>}</Q>
    <Section title="Por temporada"><Q q={seasons}>{(list) => <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Temporada</th><th scope="col">Campeón</th><th scope="col" className="hide-sm">Subcampeón</th><th scope="col" className="hide-sm">Final</th></tr></thead><tbody>{list.filter((s) => !s.is_current).map((s) => { const a = archives.data?.find((x) => x.season_id === s.id); return <tr key={s.id}><td><Link to={`/temporadas/${s.number}`}>Temporada {s.number}</Link></td><td>{a?.champion_club ? <ClubLink club={clubs.get(a.champion_club)} size={24} /> : <span className="muted">Sin registro</span>}</td><td className="hide-sm">{a?.runner_up_club ? <ClubLink club={clubs.get(a.runner_up_club)} size={24} /> : <span className="muted">Sin registro</span>}</td><td className="hide-sm">{a?.final_score ?? <span className="muted">Sin registro</span>}</td></tr> })}</tbody></table></div>}</Q>
      <p className="note">De las temporadas 1 a 7 por ahora solo está registrado el campeón.</p></Section>
  </>
}

export function Seasons() {
  const seasons = useSeasons(); const archives = useArchives(); const clubs = byId(useClubs().data); const honours = useHonours()
  const relegated = [...(honours.data ?? [])].filter((h) => h.symbolic_relegations > 0).sort((x, y) => y.symbolic_relegations - x.symbolic_relegations || x.club_name.localeCompare(y.club_name))
  const total = relegated.reduce((n, h) => n + h.symbolic_relegations, 0); const dated = (archives.data ?? []).reduce((n, a) => n + a.relegated_clubs.length, 0)
  return <>
    <PageHead title="Historial de temporadas" lead="Archivo de cada edición de NG League." />
    <Q q={seasons}>{(list) => <div className="season-list">{list.map((s) => { const a = archives.data?.find((x) => x.season_id === s.id); const c = a?.champion_club ? clubs.get(a.champion_club) : null; return <Link key={s.id} to={`/temporadas/${s.number}`}><b>{s.number}</b><span>{s.is_current ? 'Temporada actual' : c ? c.name : 'Sin registro detallado'}</span>{c && <Crest club={c} size={32} />}</Link> })}</div>}</Q>
    {relegated.length > 0 && <Section title="Descensos simbólicos"><ol className="honours">{relegated.map((h, i) => <li key={h.club_id} style={{ '--w': `${(h.symbolic_relegations / relegated[0].symbolic_relegations) * 100}%` } as React.CSSProperties}><span className="honours__pos">{i + 1}</span><ClubLink club={clubs.get(h.club_id)} size={38} /><b>{h.symbolic_relegations}</b></li>)}</ol>{total > dated && <p className="note">Son los totales por club. Falta registrar en qué temporada ocurrieron {total - dated} de los {total}.</p>}</Section>}
  </>
}

export function SeasonPage() {
  const { number } = useParams(); const seasons = useSeasons(); const clubs = byId(useClubs().data); const archives = useArchives()
  const season = seasons.data?.find((s) => s.number === Number(number))
  const table = useStandings(season); const matches = useMatches(season?.id); const scorers = useScorers(season?.id); const awards = useAwards(season?.id)
  if (seasons.isPending) return <Loading />
  if (!season) return <Empty title="Esta temporada no existe." action={<Link className="btn" to="/temporadas">Ver temporadas</Link>} />
  const a = archives.data?.find((x) => x.season_id === season.id); const label: Record<string, string> = { mvp: 'Mejor jugador', revelation: 'Jugador revelación', coach: 'Mejor DT', bettor: 'Rey de las apuestas' }
  const hasTable = table.data?.length && (season.is_current || season.status === 'closed')
  if (season.data_quality === 'missing' || season.data_quality === 'partial') {
    const champion = a?.champion_club ? clubs.get(a.champion_club) : null
    return <><PageHead title={`Temporada ${season.number}`} />{champion && <div className="season-champ"><Crest club={champion} size={68} /><div><small>Campeón</small><b>{champion.name}</b></div></div>}<Section title="Detalle de la temporada"><Empty title="Todavía no hay tabla, partidos ni premios registrados.">Se pueden sumar cuando estén disponibles.</Empty></Section></>
  }
  return <>
    <PageHead title={`Temporada ${season.number}`} lead={season.is_current ? 'Temporada actual' : undefined} />
    {a?.champion_club && <div className="season-champ"><Crest club={clubs.get(a.champion_club)} size={68} /><div><small>Campeón</small><b>{clubs.get(a.champion_club)?.name}</b></div>{a.final_score && <p>Final: {a.final_score}</p>}</div>}
    <div className="two-col">
      <div>
        <Section title="Tabla">{hasTable ? <><StandingsTable rows={table.data!} clubs={clubs} /><ZoneLegend count={table.data!.length} /></> : <Loading />}</Section>
        <Section title="Playoffs por el título"><Q q={matches}>{(m) => <Bracket columns={titleColumns} matches={m} clubs={clubs} />}</Q></Section>
        <Section title="Descenso simbólico"><Q q={matches}>{(m) => <Bracket columns={relegationColumns(season)} matches={m} clubs={clubs} />}</Q></Section>
      </div>
      <aside>
        <Section title="Goleadores" className="section--tint"><Q q={scorers}>{(rows) => rows.length ? <ul className="plain-list">{rows.map((s) => <li key={s.raw_player_name}><Crest club={clubs.get(s.club_id)} size={20} />{s.raw_player_name}<b className="push">{s.goals}</b></li>)}</ul> : <Empty title="Sin goleadores registrados." />}</Q></Section>
        <Section title="Premios"><Q q={awards}>{(rows) => rows.length ? <dl className="facts">{rows.map((x) => <div key={x.category}><dt>{label[x.category] ?? x.category}</dt><dd>{x.label}</dd></div>)}</dl> : <Empty title="Sin premios registrados." />}</Q></Section>
        {!!a?.relegated_clubs.length && <Section title="Descendió"><ul className="plain-list">{a.relegated_clubs.map((id) => <li key={id}><ClubLink club={clubs.get(id)} size={22} /></li>)}</ul></Section>}
      </aside>
    </div>
  </>
}

export function Records() {
  const clubs = byId(useClubs().data); const honours = useHonours(); const seasons = useSeasons()
  const all = useQuery({ queryKey: ['record-matches'], queryFn: async () => must(await supabase.from('matches').select('*').eq('status', 'played')) as Match[] })
  const scorers = useQuery({ queryKey: ['record-scorers'], queryFn: async () => must(await supabase.from('season_scorer_snapshots').select('club_id,raw_player_name,goals,season_id').order('goals', { ascending: false }).limit(3)) as { club_id: number; raw_player_name: string; goals: number; season_id: number }[] })
  const snaps = useQuery({ queryKey: ['record-snaps'], queryFn: async () => must(await supabase.from('season_table_snapshots').select('club_id,season_id,points,goals_for,goals_against').order('points', { ascending: false })) as { club_id: number; season_id: number; points: number; goals_for: number; goals_against: number }[] })
  return <>
    <PageHead title="Récords históricos" lead="Calculados con los partidos registrados. Hoy cubren la temporada 8." />
    <Q q={all}>{(m) => {
      const num = (id: number) => seasons.data?.find((s) => s.id === id)?.number
      const goals = (x: Match) => (x.home_goals ?? 0) + (x.away_goals ?? 0); const diff = (x: Match) => Math.abs((x.home_goals ?? 0) - (x.away_goals ?? 0))
      const wide = [...m].sort((a, b) => diff(b) - diff(a) || goals(b) - goals(a))[0]; const most = [...m].sort((a, b) => goals(b) - goals(a) || diff(a) - diff(b))[0]
      const line = (x?: Match) => x ? <Link to={`/partidos/${x.id}`}>{clubs.get(x.home_club!)?.name} {x.home_goals}-{x.away_goals} {clubs.get(x.away_club!)?.name}</Link> : 'Sin dato'
      const pts = snaps.data?.[0]; const gf = [...(snaps.data ?? [])].sort((a, b) => b.goals_for - a.goals_for)[0]; const gc = [...(snaps.data ?? [])].sort((a, b) => a.goals_against - b.goals_against)[0]; const champ = honours.data?.[0]; const top = scorers.data?.[0]
      const items: [string, React.ReactNode, React.ReactNode][] = [
        ['Más títulos', champ?.titles, clubs.get(champ?.club_id ?? 0)?.name], ['Más puntos en fase regular', pts?.points, pts && `${clubs.get(pts.club_id)?.name}, temporada ${num(pts.season_id)}`],
        ['Más goles a favor', gf?.goals_for, gf && `${clubs.get(gf.club_id)?.name}, temporada ${num(gf.season_id)}`], ['Menos goles en contra', gc?.goals_against, gc && `${clubs.get(gc.club_id)?.name}, temporada ${num(gc.season_id)}`],
        ['Más goles de un jugador', top?.goals, scorers.data?.filter((s) => s.goals === top?.goals).map((s) => s.raw_player_name).join(', ')], ['Mayor diferencia en un partido', wide && diff(wide), line(wide)], ['Partido con más goles', most && goals(most), line(most)],
      ]
      return <div className="records">{items.map(([k, v, d]) => <div key={k}><span>{k}</span><b>{v ?? 'Sin dato'}</b><p>{d}</p></div>)}</div>
    }}</Q>
  </>
}
