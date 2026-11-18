import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, BookOpen, CalendarDays, CircleUser, Crown, Gauge, History, Home, LayoutGrid, ListOrdered, Medal, Menu, Newspaper, Search, Shield, Shirt, Trophy, UserRound, Users, X, type LucideIcon } from 'lucide-react'
import { useClubs, useCoaches } from '../lib/data'
import { BASE, normalize } from '../lib/format'
import { useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { Crest, Rating, Toaster } from './ui'

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean }
const NAV: { title: string; items: Item[] }[] = [
  { title: 'Competición', items: [
    { to: '/', label: 'Inicio', icon: Home, end: true }, { to: '/primera-division', label: 'Primera división', icon: Trophy },
    { to: '/fixture', label: 'Fixture y resultados', icon: CalendarDays }, { to: '/tabla', label: 'Tabla de posiciones', icon: ListOrdered } ] },
  { title: 'Clubes y jugadores', items: [
    { to: '/clubes', label: 'Clubes', icon: Shield }, { to: '/jugadores', label: 'Jugadores', icon: Users },
    { to: '/plantillas', label: 'Armado de plantillas', icon: Shirt }, { to: '/mercado', label: 'Mercado de pases', icon: ArrowLeftRight } ] },
  { title: 'Historia', items: [
    { to: '/campeones', label: 'Historial de campeones', icon: Crown }, { to: '/temporadas', label: 'Historial de temporadas', icon: History },
    { to: '/directores-tecnicos', label: 'Directores técnicos', icon: UserRound }, { to: '/records', label: 'Récords históricos', icon: Medal } ] },
  { title: 'La liga', items: [ { to: '/noticias', label: 'Noticias', icon: Newspaper }, { to: '/reglamento', label: 'Reglamento', icon: BookOpen }, { to: '/administracion', label: 'Panel de administración', icon: Gauge } ] },
]
const ALL = NAV.flatMap((g) => g.items)
const TABS = [ALL[0], ALL[2], ALL[3], ALL[4]]

function NavItems({ onPick }: { onPick?: () => void }) {
  return <>{NAV.map((g) => (
    <div className="nav-group" key={g.title}>
      <p>{g.title}</p>
      {g.items.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={onPick} title={label}><Icon size={18} aria-hidden="true" /><span>{label}</span></NavLink>)}
    </div>
  ))}</>
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const go = useNavigate()
  const clubs = useClubs(); const coaches = useCoaches()
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { const t = setTimeout(() => setTerm(normalize(text)), 220); return () => clearTimeout(t) }, [text])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const players = useQuery({ queryKey: ['quick-players', term], enabled: term.length >= 3, queryFn: async () => must(await supabase.from('player_directory').select('id,name,overall,position_code,club_name').ilike('search_name', `%${term}%`).order('overall', { ascending: false }).limit(6)) as { id: number; name: string; overall: number; position_code: string; club_name: string | null }[] })
  const open = (to: string) => { onClose(); go(to) }
  const sections = term ? ALL.filter((i) => normalize(i.label).includes(term)) : ALL.slice(0, 5)
  const clubHits = term ? (clubs.data ?? []).filter((c) => normalize(c.name).includes(term)).slice(0, 5) : []
  const coachHits = term ? (coaches.data ?? []).filter((c) => normalize(c.name).includes(term)).slice(0, 4) : []
  const none = term.length >= 2 && !sections.length && !clubHits.length && !coachHits.length && !players.data?.length && !players.isFetching
  return (
    <div className="dialog-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search" role="dialog" aria-modal="true" aria-label="Buscar en NG League">
        <div className="search__box"><Search size={18} aria-hidden="true" /><input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar clubes, jugadores, DT o secciones" aria-label="Buscar" /><button className="icon-btn" onClick={onClose} aria-label="Cerrar búsqueda"><X size={18} /></button></div>
        <div className="search__results">
          {clubHits.length > 0 && <div><h3>Clubes</h3>{clubHits.map((c) => <button key={c.id} onClick={() => open(`/clubes/${c.slug}`)}><Crest club={c} size={22} />{c.name}</button>)}</div>}
          {players.data && players.data.length > 0 && <div><h3>Jugadores</h3>{players.data.map((p) => <button key={p.id} onClick={() => open(`/jugadores/${p.id}`)}><Rating value={p.overall} />{p.name}<small>{p.position_code}{p.club_name ? `, ${p.club_name}` : ''}</small></button>)}</div>}
          {coachHits.length > 0 && <div><h3>Directores técnicos</h3>{coachHits.map((c) => <button key={c.id} onClick={() => open(`/directores-tecnicos/${c.id}`)}><UserRound size={18} aria-hidden="true" />{c.name}</button>)}</div>}
          {sections.length > 0 && <div><h3>Secciones</h3>{sections.map(({ to, label, icon: Icon }) => <button key={to} onClick={() => open(to)}><Icon size={18} aria-hidden="true" />{label}</button>)}</div>}
          {none && <p className="search__none">No hay resultados para “{text}”.</p>}
        </div>
      </div>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const loc = useLocation()
  const clubs = useClubs()
  const { session, profile } = useAuth()
  const strip = useMemo(() => [...(clubs.data ?? [])].filter((c) => c.is_active).sort((a, b) => a.id - b.id), [clubs.data])
  useEffect(() => { scrollTo(0, 0); setMenu(false) }, [loc.pathname])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select'))) { e.preventDefault(); setSearch(true) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  const account = session ? (profile?.display_name ?? 'Mi cuenta') : 'Ingresar'
  return (
    <div className="app">
      <a className="skip" href="#contenido">Ir al contenido</a>
      <aside className="rail">
        <Link to="/" className="brand" aria-label="NG League, inicio"><img src={`${BASE}brand/logo.webp`} alt="" width="30" height="44" /><span>NG League</span></Link>
        <nav aria-label="Secciones"><NavItems /></nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link to="/" className="brand brand--mobile" aria-label="NG League, inicio"><img src={`${BASE}brand/logo.webp`} alt="" width="26" height="38" /><span>NG League</span></Link>
          <nav className="strip" aria-label="Clubes">{strip.map((c) => <NavLink key={c.id} to={`/clubes/${c.slug}`} title={c.name} aria-label={c.name}><Crest club={c} size={30} /></NavLink>)}</nav>
          <div className="topbar__tools">
            <button className="search-trigger" onClick={() => setSearch(true)} aria-label="Buscar"><Search size={17} aria-hidden="true" /><span>Buscar</span><kbd>/</kbd></button>
            <NavLink className="account" to="/ingresar"><CircleUser size={19} aria-hidden="true" /><span>{account}</span></NavLink>
          </div>
        </header>
        <main id="contenido" key={loc.pathname} className="content">{children}</main>
        <footer className="footer"><span>NG League</span><Link to="/reglamento">Reglamento</Link><Link to="/temporadas">Historial</Link></footer>
      </div>
      <nav className="tabs" aria-label="Navegación principal">
        {TABS.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon size={20} aria-hidden="true" /><span>{label.split(' ')[0]}</span></NavLink>)}
        <button onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={20} aria-hidden="true" /><span>Más</span></button>
      </nav>
      {menu && <div className="dialog-layer dialog-layer--sheet" onMouseDown={(e) => e.target === e.currentTarget && setMenu(false)}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Todas las secciones">
          <div className="sheet__head"><strong><LayoutGrid size={18} aria-hidden="true" />Secciones</strong><button className="icon-btn" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X size={20} /></button></div>
          <nav><NavItems onPick={() => setMenu(false)} /></nav>
        </div>
      </div>}
      {search && <SearchDialog onClose={() => setSearch(false)} />}
      <Toaster />
    </div>
  )
}
