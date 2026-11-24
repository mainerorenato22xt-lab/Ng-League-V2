import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle, RotateCw } from 'lucide-react'
import type { Club, Match, Row } from '../lib/data'
import { crestUrl, fmtSigned, initials } from '../lib/format'

export function Loading({ label = 'Cargando datos' }: { label?: string }) {
  return <div className="state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <div><strong>No se pudieron cargar estos datos.</strong><p>{message ?? 'Revisá tu conexión e intentá de nuevo.'}</p></div>
      {onRetry && <button className="btn" onClick={onRetry}><RotateCw size={15} aria-hidden="true" />Reintentar</button>}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>
}

export function Q<T>({ q, children, label }: { q: UseQueryResult<T>; children: (d: T) => ReactNode; label?: string }) {
  if (q.isPending) return <Loading label={label} />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return <>{children(q.data)}</>
}

export function PageHead({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return <header className="page-head"><div><h1>{title}</h1>{lead && <p>{lead}</p>}</div>{children && <div className="page-head__tools">{children}</div>}</header>
}

export function Section({ title, to, linkLabel, children, className = '' }: { title: string; to?: string; linkLabel?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      <div className="section__head"><h2>{title}</h2>{to && <Link to={to} className="text-link">{linkLabel}</Link>}</div>
      {children}
    </section>
  )
}

export function Crest({ club, size = 28 }: { club?: Pick<Club, 'id' | 'name' | 'crest_path'> | null; size?: number }) {
  if (!club) return <span className="crest crest--empty" style={{ width: size, height: size }} aria-hidden="true" />
  return <img className="crest" src={crestUrl(club)} alt="" width={size} height={size} loading="lazy" style={{ width: size, height: size }} />
}

export function ClubLink({ club, size = 26 }: { club?: Club | null; size?: number }) {
  if (!club) return <span className="club-link club-link--tbd"><Crest size={size} />Por definir</span>
  return <Link className="club-link" to={`/clubes/${club.slug}`}><Crest club={club} size={size} /><span>{club.name}</span></Link>
}

export function Avatar({ name, src, size = 44 }: { name: string; src?: string | null; size?: number }) {
  return src ? <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} /> : <span className="avatar avatar--initials" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(name)}</span>
}

export function Rating({ value }: { value: number }) {
  return <span className={`rating ${value >= 85 ? 'rating--top' : value >= 75 ? 'rating--high' : ''}`}>{value}</span>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

export function StandingsTable({ rows, clubs, compact = false }: { rows: Row[]; clubs: Map<number, Club>; compact?: boolean }) {
  const n = rows.length
  const zone = (p: number) => (p <= 6 ? 'title' : n >= 10 && p > n - 4 ? 'rel' : '')
  return (
    <div className="table-wrap">
      <table className={`table standings ${compact ? 'standings--compact' : ''}`}>
        <thead><tr><th className="num" scope="col"><abbr title="Posición">Pos</abbr></th><th scope="col">Club</th><th className="num" scope="col"><abbr title="Partidos jugados">PJ</abbr></th>
          {!compact && <><th className="num wide" scope="col"><abbr title="Ganados">G</abbr></th><th className="num wide" scope="col"><abbr title="Empatados">E</abbr></th><th className="num wide" scope="col"><abbr title="Perdidos">P</abbr></th><th className="num wide" scope="col"><abbr title="Goles a favor">GF</abbr></th><th className="num wide" scope="col"><abbr title="Goles en contra">GC</abbr></th></>}
          <th className="num" scope="col"><abbr title="Diferencia de gol">DG</abbr></th><th className="num" scope="col">Pts</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.club_id} data-zone={zone(r.position)}>
              <td className="num pos">{r.position}</td><td><ClubLink club={clubs.get(r.club_id)} size={24} /></td><td className="num">{r.played}</td>
              {!compact && <><td className="num wide">{r.won}</td><td className="num wide">{r.drawn}</td><td className="num wide">{r.lost}</td><td className="num wide">{r.goals_for}</td><td className="num wide">{r.goals_against}</td></>}
              <td className="num">{fmtSigned(r.goal_diff)}</td><td className="num pts">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ZoneLegend({ count }: { count: number }) {
  return <p className="legend"><span><i className="is-title" />Playoffs por el título</span>{count >= 10 && <span><i className="is-rel" />Playoffs por el descenso</span>}</p>
}

export function MatchRow({ m, clubs }: { m: Match; clubs: Map<number, Club> }) {
  const played = m.status === 'played'
  const home = m.home_club ? clubs.get(m.home_club) : null
  const away = m.away_club ? clubs.get(m.away_club) : null
  return (
    <Link className="match" to={`/partidos/${m.id}`} aria-label={`${home?.name ?? 'Por definir'} contra ${away?.name ?? 'Por definir'}`}>
      <span className={`match__team ${m.winner_club === m.home_club && played ? 'is-winner' : ''}`}><span>{home?.name ?? m.home_source ?? 'Por definir'}</span><Crest club={home} size={24} /></span>
      <span className={`match__score ${played ? '' : 'match__score--pending'}`}>{played ? <>{m.home_goals}<i>-</i>{m.away_goals}</> : 'vs'}{m.home_penalties != null && <small>{m.home_penalties}-{m.away_penalties} pen.</small>}</span>
      <span className={`match__team match__team--away ${m.winner_club === m.away_club && played ? 'is-winner' : ''}`}><Crest club={away} size={24} /><span>{away?.name ?? m.away_source ?? 'Por definir'}</span></span>
    </Link>
  )
}

type Tie = { code: string; label?: string; homeLabel: string; awayLabel: string }
export function Bracket({ columns, matches, clubs }: { columns: { title: string; ties: Tie[] }[]; matches: Match[]; clubs: Map<number, Club> }) {
  const find = (c: string) => matches.find((m) => m.bracket_code === c)
  return (
    <div className="bracket" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 380px))` }}>
      {columns.map((col) => (
        <div className="bracket__col" key={col.title}>
          <h3>{col.title}</h3>
          <div className="bracket__ties">
            {col.ties.map((t) => {
              const m = find(t.code)
              const line = (id: number | null | undefined, fallback: string, goals: number | null | undefined, pens: number | null | undefined) => {
                const c = id ? clubs.get(id) : null
                return <div className={`tie__line ${m?.winner_club && m.winner_club === id ? 'is-winner' : ''}`}><Crest club={c} size={20} /><span>{c?.name ?? fallback}</span><b>{goals ?? ''}{pens != null ? ` (${pens})` : ''}</b></div>
              }
              const body = <>{line(m?.home_club, t.homeLabel, m?.home_goals, m?.home_penalties)}{line(m?.away_club, t.awayLabel, m?.away_goals, m?.away_penalties)}</>
              return m ? <Link key={t.code} className="tie" to={`/partidos/${m.id}`}>{body}</Link> : <div key={t.code} className="tie tie--pending">{body}</div>
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export const titleColumns = [
  { title: 'Cuartos', ties: [{ code: 'QA', homeLabel: '3.º de la tabla', awayLabel: '6.º de la tabla' }, { code: 'QB', homeLabel: '4.º de la tabla', awayLabel: '5.º de la tabla' }] },
  { title: 'Semifinales', ties: [{ code: 'S1', homeLabel: '1.º de la tabla', awayLabel: 'Ganador 4.º-5.º' }, { code: 'S2', homeLabel: '2.º de la tabla', awayLabel: 'Ganador 3.º-6.º' }] },
  { title: 'Final', ties: [{ code: 'F', homeLabel: 'Ganador semifinal 1', awayLabel: 'Ganador semifinal 2' }] },
]

export function toast(message: string, kind: 'ok' | 'error' = 'ok') { dispatchEvent(new CustomEvent('ngl-toast', { detail: { message, kind } })) }
export function Toaster() {
  const [item, setItem] = useState<{ message: string; kind: string } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const on = (e: Event) => { setItem((e as CustomEvent).detail); clearTimeout(timer); timer = setTimeout(() => setItem(null), 4200) }
    addEventListener('ngl-toast', on); return () => { removeEventListener('ngl-toast', on); clearTimeout(timer) }
  }, [])
  return item ? <div className={`toast toast--${item.kind}`} role="status">{item.message}</div> : null
}
