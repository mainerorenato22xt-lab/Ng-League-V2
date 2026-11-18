import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { byId, useClubs, type PlayerRow } from '../lib/data'
import { ATTRIBUTE_GROUPS, fmtMoney, normalize } from '../lib/format'
import { must, supabase } from '../lib/supabase'
import { Avatar, ClubLink, Empty, Facts, Field, PageHead, Q, Rating, Section } from '../components/ui'

const PAGE = 40
type Position = { id: number; code: string; name: string; line: string }
export const usePositions = () => useQuery({ queryKey: ['positions'], staleTime: Infinity, queryFn: async () => must(await supabase.from('positions').select('*').order('id')) as Position[] })
const useCountries = () => useQuery({ queryKey: ['countries'], staleTime: Infinity, queryFn: async () => must(await supabase.from('countries').select('id,name').not('name', 'is', null).order('name')) as { id: number; name: string }[] })
const EMPTY = { q: '', country: '', position: '', ageMin: '', ageMax: '', ovrMin: '', ovrMax: '', priceMax: '', club: '', status: '', sort: 'overall.desc' }

export function PlayersPage() {
  const [f, setF] = useState(EMPTY); const [page, setPage] = useState(0); const [term, setTerm] = useState('')
  const positions = usePositions(); const countries = useCountries(); const clubs = useClubs()
  useEffect(() => { const t = setTimeout(() => setTerm(normalize(f.q)), 260); return () => clearTimeout(t) }, [f.q])
  const set = (k: keyof typeof EMPTY, v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(0) }
  const key = { ...f, q: term }
  const list = useQuery({
    queryKey: ['players', key, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      const [col, dir] = f.sort.split('.')
      let q = supabase.from('player_directory').select('id,name,country_name,age,position_code,overall,market_value,club_id,club_name,club_slug,is_eligible,is_available,reserved_club_name', { count: 'estimated' })
      if (term) q = q.ilike('search_name', `%${term}%`)
      if (f.country) q = q.eq('country_id', +f.country)
      if (f.position) q = q.or(`main_position.eq.${+f.position},secondary_positions.cs.{${+f.position}}`)
      if (f.ageMin) q = q.gte('age', +f.ageMin); if (f.ageMax) q = q.lte('age', +f.ageMax)
      if (f.ovrMin) q = q.gte('overall', +f.ovrMin); if (f.ovrMax) q = q.lte('overall', +f.ovrMax)
      if (f.priceMax) q = q.lte('market_value', +f.priceMax)
      if (f.club) q = q.eq('club_id', +f.club)
      if (f.status === 'free') q = q.eq('is_available', true)
      if (f.status === 'signed') q = q.not('club_id', 'is', null)
      if (f.status === 'ineligible') q = q.eq('is_eligible', false)
      const res = await q.order(col, { ascending: dir === 'asc', nullsFirst: false }).order('id').range(page * PAGE, page * PAGE + PAGE - 1)
      if (res.error) throw new Error(res.error.message)
      return { rows: res.data as unknown as PlayerRow[], count: res.count ?? 0 }
    },
  })
  const num = (k: keyof typeof EMPTY, ph: string, label: string) => <input type="number" inputMode="numeric" aria-label={label} placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} />
  return <>
    <PageHead title="Jugadores" lead="Base completa de NG League, con precios y disponibilidad de la temporada actual." />
    <form className="filters" onSubmit={(e) => e.preventDefault()}>
      <Field label="Nombre"><input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Buscar jugador" /></Field>
      <Field label="Nacionalidad"><select value={f.country} onChange={(e) => set('country', e.target.value)}><option value="">Todas</option>{countries.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Posición"><select value={f.position} onChange={(e) => set('position', e.target.value)}><option value="">Todas</option>{positions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Club"><select value={f.club} onChange={(e) => set('club', e.target.value)}><option value="">Todos</option>{clubs.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Disponibilidad"><select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Todos</option><option value="free">Libres y elegibles</option><option value="signed">Con club</option><option value="ineligible">No elegibles</option></select></Field>
      <Field label="Edad"><span className="range">{num('ageMin', 'Mín', 'Edad mínima')}{num('ageMax', 'Máx', 'Edad máxima')}</span></Field>
      <Field label="Media"><span className="range">{num('ovrMin', 'Mín', 'Media mínima')}{num('ovrMax', 'Máx', 'Media máxima')}</span></Field>
      <Field label="Precio máximo">{num('priceMax', 'Millones', 'Precio máximo')}</Field>
      <Field label="Ordenar por"><select value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="overall.desc">Mayor media</option><option value="overall.asc">Menor media</option><option value="market_value.desc">Mayor precio</option><option value="market_value.asc">Menor precio</option><option value="age.asc">Menor edad</option><option value="age.desc">Mayor edad</option></select></Field>
      <button type="button" className="btn" onClick={() => { setF(EMPTY); setPage(0) }}><RotateCcw size={15} aria-hidden="true" />Limpiar</button>
    </form>
    <Q q={list} label="Buscando jugadores">{({ rows, count }) => rows.length ? <>
      <div className={`table-wrap ${list.isFetching ? 'is-stale' : ''}`}><table className="table"><thead><tr><th className="num" scope="col">Media</th><th scope="col">Jugador</th><th scope="col">Pos</th><th className="num hide-sm" scope="col">Edad</th><th scope="col" className="hide-sm">Nacionalidad</th><th scope="col" className="hide-sm">Club</th><th className="num" scope="col">Precio</th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.id}><td className="num"><Rating value={p.overall} /></td><td><Link to={`/jugadores/${p.id}`}>{p.name}</Link></td><td>{p.position_code}</td><td className="num hide-sm">{p.age ?? 'Sin dato'}</td><td className="hide-sm">{p.country_name ?? <span className="muted">Sin confirmar</span>}</td><td className="hide-sm">{p.club_slug ? <Link to={`/clubes/${p.club_slug}`}>{p.club_name}</Link> : <span className="muted">{p.reserved_club_name ? `Reservado para ${p.reserved_club_name}` : p.is_eligible ? 'Libre' : 'No elegible'}</span>}</td><td className="num">{fmtMoney(p.market_value)}</td></tr>)}</tbody></table></div>
      <div className="pager"><span>Página {page + 1}{count ? ` de ${Math.max(1, Math.ceil(count / PAGE)).toLocaleString('es-AR')}` : ''}</span><button className="btn" disabled={page === 0} onClick={() => { setPage(page - 1); scrollTo(0, 0) }}><ChevronLeft size={16} aria-hidden="true" />Anterior</button><button className="btn" disabled={rows.length < PAGE} onClick={() => { setPage(page + 1); scrollTo(0, 0) }}>Siguiente<ChevronRight size={16} aria-hidden="true" /></button></div>
    </> : <Empty title="Ningún jugador coincide con estos filtros." action={<button className="btn" onClick={() => setF(EMPTY)}>Limpiar filtros</button>} />}</Q>
  </>
}

export function PlayerPage() {
  const { id } = useParams(); const positions = usePositions(); const clubs = byId(useClubs().data)
  const player = useQuery({ queryKey: ['player', id], queryFn: async () => {
    const dir = must(await supabase.from('player_directory').select('*').eq('id', Number(id)).maybeSingle()) as PlayerRow | null
    if (!dir) return null
    const extra = must(await supabase.from('players').select('attributes').eq('id', Number(id)).single()) as { attributes: number[] | null }
    return { ...dir, attributes: extra.attributes }
  } })
  const history = useQuery({ queryKey: ['player-clubs', id], queryFn: async () => must(await supabase.from('squad_memberships').select('id,club_id,joined_at,left_at').eq('player_id', Number(id)).order('joined_at', { ascending: false })) as { id: number; club_id: number; joined_at: string; left_at: string | null }[] })
  const listing = useQuery({ queryKey: ['listing', id], queryFn: async () => must(await supabase.from('transfer_market').select('asking_price').eq('player_id', Number(id)).maybeSingle()) as { asking_price: number | null } | null })
  return <Q q={player}>{(p) => {
    if (!p) return <Empty title="Este jugador no está disponible." action={<Link className="btn" to="/jugadores">Ver jugadores</Link>} />
    const main = positions.data?.find((x) => x.id === p.main_position)
    const second = p.secondary_positions.map((i) => positions.data?.find((x) => x.id === i)?.code).filter(Boolean)
    return <>
      <header className="player-head">
        {p.photo_path ? <img className="avatar" src={p.photo_path} alt="" width="104" height="104" /> : <Avatar name={p.name} size={104} />}
        <div><h1>{p.name}</h1><p>{main?.name}{p.club_slug && <>, <Link to={`/clubes/${p.club_slug}`}>{p.club_name}</Link></>}</p>{listing.data && <Link className="text-link" to="/mercado">Transferible{listing.data.asking_price != null ? `, pide ${fmtMoney(listing.data.asking_price)}` : ''}</Link>}</div>
        <span className="player-head__ovr">{p.overall}<small>media</small></span>
      </header>
      <div className="two-col">
        <div>{ATTRIBUTE_GROUPS.filter((g) => g.title !== 'Portero' || p.main_position === 0).map((g) => <Section key={g.title} title={g.title}><div className="bars">{g.items.map(([n, i]) => { const v = p.attributes?.[i] ?? 0; return <div key={n}><span>{n}</span><i><em style={{ width: `${v}%` }} /></i><b>{v}</b></div> })}</div></Section>)}</div>
        <aside>
          <Section title="Ficha" className="section--tint"><Facts items={[['Edad', p.age ?? 'Sin dato'], ['Nacionalidad', p.country_name ?? 'Sin confirmar'], ['Altura', p.height_cm ? `${p.height_cm} cm` : 'Sin dato'], ['Peso', p.weight_kg ? `${p.weight_kg} kg` : 'Sin dato'], ['Pie hábil', p.foot === 'left' ? 'Izquierdo' : p.foot === 'right' ? 'Derecho' : 'Sin dato'], ['Posiciones secundarias', second.length ? second.join(', ') : 'Ninguna']]} /></Section>
          <Section title="Mercado"><Facts items={[['Precio', fmtMoney(p.market_value)], ['Cláusula de rescisión', p.release_clause ? fmtMoney(p.release_clause) : 'No tiene'], ['Estado', p.club_id ? 'Con club' : p.reserved_club_name ? `Reservado para ${p.reserved_club_name}` : p.is_eligible ? 'Libre' : 'No elegible']]} /></Section>
          <Section title="Historial de clubes"><Q q={history}>{(h) => h.length ? <ul className="plain-list">{h.map((x) => <li key={x.id}><ClubLink club={clubs.get(x.club_id)} size={20} /><span className="push muted">{x.left_at ? 'Anterior' : 'Actual'}</span></li>)}</ul> : <Empty title="Sin clubes registrados." />}</Q></Section>
        </aside>
      </div>
    </>
  }}</Q>
}
