import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { byId, useArchives, useAwards, useClubs, useMatches, useScorers, useSeasons, useStandings } from '../lib/data'
import { BASE, fmtDate } from '../lib/format'
import { Crest, ClubLink, Empty, ErrorState, Loading, MatchRow, Section, StandingsTable, ZoneLegend } from '../components/ui'
import { must, supabase } from '../lib/supabase'

const STATUS: Record<string, string> = { draft: 'Por comenzar', regular: 'Fase regular en juego', playoffs: 'Playoffs en juego', closed: 'Finalizada' }

export function Home() {
  const seasons = useSeasons(); const clubsQ = useClubs(); const archives = useArchives()
  const current = seasons.data?.find((s) => s.is_current)
  const last = seasons.data?.find((s) => s.status === 'closed' && archives.data?.some((a) => a.season_id === s.id && a.champion_club))
  const archive = archives.data?.find((a) => a.season_id === last?.id)
  const clubs = byId(clubsQ.data)
  const currentMatches = useMatches(current?.id); const lastMatches = useMatches(last?.id)
  const currentTable = useStandings(current); const lastTable = useStandings(last)
  const scorers = useScorers(last?.id); const awards = useAwards(last?.id)
  const news = useQuery({ queryKey: ['home-news'], queryFn: async () => must(await supabase.from('news_feed').select('id,title,body,club_id,published_at,is_auto').eq('status', 'published').eq('is_auto', false).order('published_at', { ascending: false }).limit(4)) as { id: number; title: string | null; body: string; club_id: number | null; published_at: string; is_auto: boolean }[] })
  const moves = useQuery({ queryKey: ['home-moves'], queryFn: async () => must(await supabase.from('transfers').select('id,kind,amount,to_club,from_club,player:players(id,name)').order('occurred_at', { ascending: false }).limit(4)) as unknown as { id: number; kind: string; amount: number; to_club: number | null; from_club: number | null; player: { id: number; name: string } }[] })
  if (seasons.isError || clubsQ.isError) return <ErrorState onRetry={() => { seasons.refetch(); clubsQ.refetch() }} />
  if (!seasons.data || !clubsQ.data || !archives.data) return <Loading />

  const champion = archive?.champion_club ? clubs.get(archive.champion_club) : null
  const final = lastMatches.data?.find((m) => m.bracket_code === 'F')
  const upcoming = (currentMatches.data ?? []).filter((m) => m.status === 'scheduled')
  const nextRound = upcoming[0]?.round
  const nextMatches = upcoming.filter((m) => m.round === nextRound)
  const hasPlayed = currentTable.data?.some((r) => r.played > 0)
  const tableRows = hasPlayed ? currentTable.data : lastTable.data
  const regular = (lastMatches.data ?? []).filter((m) => m.phase === 'regular')
  const goals = regular.reduce((n, m) => n + (m.home_goals ?? 0) + (m.away_goals ?? 0), 0)
  const rows = lastTable.data ?? []
  const attack = rows.length ? Math.max(...rows.map((r) => r.goals_for)) : 0
  const defense = rows.length ? Math.min(...rows.map((r) => r.goals_against)) : 0
  const mvp = awards.data?.find((a) => a.category === 'mvp')
  const topGoals = scorers.data?.[0]?.goals
  const leaders = scorers.data?.filter((s) => s.goals === topGoals) ?? []
  const home = final?.home_club ? clubs.get(final.home_club) : null
  const away = final?.away_club ? clubs.get(final.away_club) : null

  return (
    <div className="home">
      <div className="bento">
        <section className="hero">
          <img className="hero__photo" src={`${BASE}brand/portada.jpg`} alt="Plantel de Deportivo Athuel con el trofeo de campeón" width="1360" height="768" />
          <div className="hero__copy">
            <span className="chip">{STATUS[current?.status ?? 'draft']}</span>
            <h1>Temporada {current?.number}</h1>
            <div className="hero__actions"><Link className="btn btn--primary" to="/fixture">Ver fixture</Link><Link className="btn btn--glass" to="/tabla">Ver tabla</Link></div>
          </div>
        </section>
        {champion && <Link to={`/clubes/${champion.slug}`} className="tile tile--champion"><Crest club={champion} size={76} /><span><small>Campeón vigente</small><b>{champion.name}</b></span></Link>}
        {final && <Link className="tile tile--final" to={`/partidos/${final.id}`}>
          <small>Última final, temporada {last?.number}</small>
          <span className="final-score"><Crest club={home} size={44} /><b>{final.home_goals}-{final.away_goals}</b><Crest club={away} size={44} /></span>
          <em>{home?.name} y {away?.name}</em>
        </Link>}
      </div>

      <div className="home__grid">
        <div className="home__main">
          <Section title={nextRound ? `Jornada ${nextRound}` : 'Próxima jornada'} to="/fixture" linkLabel="Fixture completo">
            {nextMatches.length ? <div className="matches">{nextMatches.map((m) => <MatchRow key={m.id} m={m} clubs={clubs} />)}</div>
              : <Empty title="El fixture de esta temporada todavía no está generado.">Cuando se publique vas a ver acá los partidos de la próxima jornada.</Empty>}
          </Section>
          <Section title={hasPlayed ? 'Tabla de posiciones' : `Tabla final, temporada ${last?.number}`} to="/tabla" linkLabel="Tabla completa">
            {tableRows ? <><StandingsTable rows={tableRows} clubs={clubs} compact /><ZoneLegend count={tableRows.length} /></> : <Loading />}
          </Section>
          <Section title="Últimas noticias" to="/noticias" linkLabel="Todas las noticias">
            {news.data?.length ? <div className="news-list">{news.data.map((n) => <Link key={n.id} to={`/noticias#n${n.id}`}><Crest club={n.club_id ? clubs.get(n.club_id) : null} size={24} /><span><b>{n.title ?? n.body.split('\n')[0].slice(0, 90)}</b><small>{n.club_id ? clubs.get(n.club_id)?.name : 'NG League'}, {fmtDate(n.published_at)}</small></span></Link>)}</div>
              : <Empty title="Todavía no hay noticias publicadas." />}
          </Section>
        </div>
        <aside className="home__side">
          <Section title={`Lo mejor de la temporada ${last?.number ?? ''}`} className="section--tint">
            {mvp && <div className="spotlight"><small>Mejor jugador, por votación</small><b>{mvp.label}</b>{mvp.club_id && <ClubLink club={clubs.get(mvp.club_id)} size={20} />}</div>}
            <dl className="stat-list">
              <div><dt>Goles en fase regular</dt><dd>{goals}</dd></div>
              <div><dt>Mejor ataque</dt><dd>{rows.filter((r) => r.goals_for === attack).map((r) => <Crest key={r.club_id} club={clubs.get(r.club_id)} size={20} />)}{attack}</dd></div>
              <div><dt>Mejor defensa</dt><dd>{rows.filter((r) => r.goals_against === defense).map((r) => <Crest key={r.club_id} club={clubs.get(r.club_id)} size={20} />)}{defense}</dd></div>
              <div><dt>Máximos goleadores</dt><dd>{topGoals ?? 'Sin dato'}</dd></div>
            </dl>
            <ul className="plain-list">{leaders.map((s) => <li key={s.raw_player_name}><Crest club={clubs.get(s.club_id)} size={20} />{s.raw_player_name}</li>)}</ul>
          </Section>
          <Section title="Mercado" to="/mercado" linkLabel="Ir al mercado">
            {moves.data?.length ? <ul className="plain-list">{moves.data.map((t) => <li key={t.id}><Link to={`/jugadores/${t.player.id}`}>{t.player.name}</Link></li>)}</ul>
              : <Empty title="Sin movimientos registrados en la web nueva." />}
          </Section>
        </aside>
      </div>
    </div>
  )
}
