import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import { Copy, Download, MessageSquareText, Save } from 'lucide-react'
import { useClubs, useRules, useSeasons, useSummaries, type Club, type PlayerRow } from '../lib/data'
import { BASE, crestUrl, fmtDec, fmtMoney, normalize } from '../lib/format'
import { must, rpc, supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Crest, Empty, Field, Loading, PageHead, Q, Rating, Section, toast } from '../components/ui'
import { usePositions } from './Players'

const FORMATIONS: Record<string, [number, number, number][]> = {
  '4-3-3': [[0,50,89],[2,14,70],[1,38,76],[1,62,76],[3,86,70],[5,28,50],[4,50,58],[5,72,50],[9,16,22],[12,50,15],[10,84,22]],
  '4-4-2': [[0,50,89],[2,14,70],[1,38,76],[1,62,76],[3,86,70],[6,14,48],[5,38,54],[5,62,54],[7,86,48],[12,36,19],[12,64,19]],
  '4-2-3-1': [[0,50,89],[2,14,70],[1,38,76],[1,62,76],[3,86,70],[4,36,58],[4,64,58],[6,16,38],[8,50,36],[7,84,38],[12,50,16]],
  '3-5-2': [[0,50,89],[1,22,76],[1,50,78],[1,78,76],[6,10,50],[5,30,54],[4,50,60],[5,70,54],[7,90,50],[12,36,19],[12,64,19]],
  '3-4-3': [[0,50,89],[1,22,76],[1,50,78],[1,78,76],[6,14,52],[5,38,56],[5,62,56],[7,86,52],[9,18,22],[12,50,15],[10,82,22]],
}
type SlotState = { slot: number; player_id: number | null; position_id: number | null; x: number | null; y: number | null }
type Lineup = { id: number; formation: string; status: 'draft' | 'submitted'; lineup_slots: SlotState[] }
type Selection = { slot: number } | { player: number } | null
const shortName = (n: string) => n.split(' ').slice(-1)[0]

function emptySlots(formation: string, size: number): SlotState[] {
  return Array.from({ length: size }, (_, i) => { const f = FORMATIONS[formation]?.[i]; return { slot: i, player_id: null, position_id: f?.[0] ?? null, x: f?.[1] ?? null, y: f?.[2] ?? null } })
}
function normalizeSlots(l: Lineup | null, size: number): SlotState[] {
  const used = Math.max(size, ...(l?.lineup_slots ?? []).map((s) => s.slot + 1))
  const base = emptySlots(l?.formation ?? '4-3-3', used)
  for (const s of l?.lineup_slots ?? []) if (base[s.slot]) base[s.slot] = { ...base[s.slot], ...s, x: s.x ?? base[s.slot].x, y: s.y ?? base[s.slot].y, position_id: s.position_id ?? base[s.slot].position_id }
  return base
}

const collision: CollisionDetection = (args) => { const hits = pointerWithin(args); const exact = hits.filter((h) => String(h.id).startsWith('t')); return exact.length ? exact : hits }

function PitchToken({ s, p, code, editable, picked, onTap }: { s: SlotState; p?: PlayerRow; code: string; editable: boolean; picked: boolean; onTap: () => void }) {
  const drag = useDraggable({ id: `s${s.slot}`, disabled: !editable || !p }); const drop = useDroppable({ id: `t${s.slot}`, disabled: !editable })
  const style: CSSProperties = { left: `${s.x ?? 50}%`, top: `${s.y ?? 50}%`, transform: `translate(-50%, -50%)${drag.transform ? ` translate(${drag.transform.x}px, ${drag.transform.y}px)` : ''}` }
  const cls = `pitch__player ${editable ? 'is-editable' : ''} ${picked ? 'is-picked' : ''} ${drop.isOver ? 'is-over' : ''} ${drag.isDragging ? 'is-dragging' : ''}`
  if (!editable) return <div className={`${cls} ${p ? '' : 'is-empty'}`} style={style}>{p ? <Link to={`/jugadores/${p.id}`}><b>{p.overall}</b><span>{shortName(p.name)}</span></Link> : <span>Vacío</span>}<small>{code}</small></div>
  return <div ref={drag.setNodeRef} className={cls} style={style}><button type="button" ref={drop.setNodeRef} className={p ? '' : 'is-vacant'} onClick={onTap} {...(p ? { ...drag.listeners, ...drag.attributes } : {})} aria-label={p ? `${p.name}, ${code}` : `Puesto libre, ${code}`}><b>{p?.overall ?? '+'}</b><span>{p ? shortName(p.name) : 'Libre'}</span></button><small>{code}</small></div>
}

function BenchRow({ id, dropId, p, label, editable, picked, onTap }: { id: string; dropId?: string; p?: PlayerRow; label: string; editable: boolean; picked: boolean; onTap: () => void }) {
  const drag = useDraggable({ id, disabled: !editable || !p }); const drop = useDroppable({ id: dropId ?? `none-${id}`, disabled: !editable || !dropId })
  const style = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)` } : undefined
  const body = <>{p ? <Rating value={p.overall} /> : null}<span>{p?.name ?? 'Puesto libre'}</span><small>{p ? p.position_code : label}</small></>
  if (!editable) return p ? <Link className="bench-row" to={`/jugadores/${p.id}`}>{body}</Link> : <div className="bench-row muted">{body}</div>
  return <button type="button" ref={(n) => { drag.setNodeRef(n); drop.setNodeRef(n) }} style={style} onClick={onTap} className={`bench-row ${picked ? 'is-picked' : ''} ${drop.isOver ? 'is-over' : ''} ${drag.isDragging ? 'is-dragging' : ''}`} {...(p ? { ...drag.listeners, ...drag.attributes } : {})}>{body}</button>
}

function UnplacedZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unplaced' })
  return <div ref={setNodeRef} className={`drop-zone bench ${isOver ? 'is-over' : ''}`}>{children}</div>
}
function PitchArea({ children, editable, label }: { children: ReactNode; editable: boolean; label: string }) {
  const { setNodeRef } = useDroppable({ id: 'pitch', disabled: !editable })
  return <div ref={setNodeRef} id="squad-pitch" className={`pitch ${editable ? 'pitch--edit' : ''}`} role="group" aria-label={label} style={{ backgroundImage: `url(${BASE}brand/cancha.svg)` }}>{children}</div>
}

async function downloadImage(club: Club, formation: string, slots: SlotState[], players: Map<number, PlayerRow>, codes: (id: number | null) => string, value: string) {
  await document.fonts.ready
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1500; const g = c.getContext('2d')!
  const font = (w: number, s: number) => `${w} ${s}px "Archivo Variable", sans-serif`
  g.fillStyle = '#07101f'; g.fillRect(0, 0, 1080, 1500)
  const crest = new Image(); crest.crossOrigin = 'anonymous'; crest.src = crestUrl(club); await crest.decode().catch(() => null)
  if (crest.naturalWidth) { const h = 96, w = crest.naturalWidth * h / crest.naturalHeight; g.drawImage(crest, 56, 40, w, h) }
  g.fillStyle = '#f5f8fc'; g.font = font(750, 50); g.fillText(club.name, 172, 88); g.fillStyle = '#aebfd3'; g.font = font(450, 26); g.fillText(`${formation}, plantel de ${value}`, 172, 126)
  const X = 56, Y = 170, W = 968, H = 980
  g.fillStyle = '#0f2038'; g.beginPath(); g.roundRect(X, Y, W, H, 24); g.fill()
  g.strokeStyle = 'rgba(169,200,234,.25)'; g.lineWidth = 3; g.strokeRect(X + 30, Y + 30, W - 60, H - 60); g.beginPath(); g.moveTo(X + 30, Y + H / 2); g.lineTo(X + W - 30, Y + H / 2); g.stroke(); g.beginPath(); g.arc(X + W / 2, Y + H / 2, 90, 0, 7); g.stroke()
  g.textAlign = 'center'
  slots.slice(0, 11).forEach((s) => {
    const p = s.player_id ? players.get(s.player_id) : null; const x = X + W * (s.x ?? 50) / 100, y = Y + H * (s.y ?? 50) / 100
    g.fillStyle = p ? '#f5f8fc' : 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x, y - 16, 36, 0, 7); g.fill()
    if (p) { g.fillStyle = '#04101f'; g.font = font(750, 28); g.fillText(String(p.overall), x, y - 6); g.fillStyle = '#f5f8fc'; g.font = font(600, 22); g.fillText(shortName(p.name).slice(0, 14), x, y + 46) }
    g.fillStyle = '#aebfd3'; g.font = font(450, 18); g.fillText(codes(s.position_id), x, y + 70)
  })
  g.textAlign = 'left'; g.fillStyle = '#f5f8fc'; g.font = font(700, 28); g.fillText('Suplentes', 56, 1208); g.font = font(450, 23); g.fillStyle = '#aebfd3'
  slots.slice(11).forEach((s, i) => { const p = s.player_id ? players.get(s.player_id) : null; g.fillText(p ? `${p.overall}  ${p.name}` : 'Puesto libre', 56 + (i % 2) * 490, 1252 + Math.floor(i / 2) * 42) })
  g.fillStyle = '#8197b0'; g.font = font(600, 22); g.fillText('NG League', 56, 1464)
  c.toBlob((blob) => { if (!blob) return toast('No se pudo crear la imagen.', 'error'); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${club.slug}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); toast('Imagen descargada.') }, 'image/png')
}

type Adjustment = { id: number; action: 'incorporate' | 'remove'; player: { id: number; name: string; overall: number } }
function PendingSquad({ clubId, canAct, onChange }: { clubId: number; canAct: boolean; onChange: () => void }) {
  const items = useQuery({ queryKey: ['adjustments', clubId], queryFn: async () => must(await supabase.from('squad_adjustments').select('id,action,player:players(id,name,overall)').eq('club_id', clubId).eq('status', 'pending')) as unknown as Adjustment[] })
  const apply = useMutation({ mutationFn: (id: number) => rpc('apply_squad_adjustment', { p_id: id }), onSuccess: () => { items.refetch(); onChange(); toast('Plantilla actualizada.') }, onError: (e: Error) => toast(e.message, 'error') })
  if (!items.data?.length) return null
  const row = (i: Adjustment) => <li key={i.id}><Rating value={i.player.overall} /><Link to={`/jugadores/${i.player.id}`}>{i.player.name}</Link>{canAct && <button className="btn btn--small push" disabled={apply.isPending} onClick={() => { if (i.action === 'incorporate' || confirm(`¿Quitar a ${i.player.name}? No se acredita dinero.`)) apply.mutate(i.id) }}>{i.action === 'incorporate' ? 'Incorporar' : 'Quitar'}</button>}</li>
  const out = items.data.filter((i) => i.action === 'remove'); const inc = items.data.filter((i) => i.action === 'incorporate')
  return <Section title="Por completar" className="section--tint">{out.length > 0 && <><h3 className="mini-head">Ya vendidos, deben salir</h3><ul className="plain-list">{out.map(row)}</ul></>}{inc.length > 0 && <><h3 className="mini-head">Ya pagados, reservados para el club</h3><ul className="plain-list">{inc.map(row)}</ul></>}<p className="note">Estas operaciones no mueven dinero: ya se registraron en la web anterior.</p></Section>
}

function SignPlayer({ clubId, onChange }: { clubId: number; onChange: () => void }) {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('')
  useEffect(() => { const t = setTimeout(() => setTerm(normalize(q)), 250); return () => clearTimeout(t) }, [q])
  const list = useQuery({ queryKey: ['free-players', term], enabled: term.length >= 2, queryFn: async () => must(await supabase.from('player_directory').select('id,name,overall,position_code,market_value').eq('is_available', true).ilike('search_name', `%${term}%`).order('overall', { ascending: false }).limit(12)) as PlayerRow[] })
  const sign = useMutation({ mutationFn: (id: number) => rpc<number>('sign_free_player', { p_club: clubId, p_player: id }), onSuccess: (bal) => { setQ(''); onChange(); toast(`Jugador incorporado. Saldo: ${fmtMoney(bal)}.`) }, onError: (e: Error) => toast(e.message, 'error') })
  return <Section title="Fichar jugador libre"><Field label="Buscar"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del jugador" /></Field>
    {list.data && <ul className="pick-list">{list.data.length ? list.data.map((p) => <li key={p.id}><Rating value={p.overall} /><span>{p.name} <small>{p.position_code}</small></span><button className="btn btn--small push" disabled={sign.isPending} onClick={() => { if (confirm(`¿Fichar a ${p.name} por ${fmtMoney(p.market_value)}?`)) sign.mutate(p.id) }}>{fmtMoney(p.market_value)}</button></li>) : <li className="muted">No hay jugadores libres con ese nombre.</li>}</ul>}
  </Section>
}

export function Squads() {
  const clubsQ = useClubs(); const sums = useSummaries(); const positions = usePositions(); const [params, setParams] = useSearchParams(); const qc = useQueryClient()
  const { isAdmin, clubId } = useAuth()
  const list = useMemo(() => (clubsQ.data ?? []).filter((c) => c.is_active), [clubsQ.data])
  const club = list.find((c) => c.slug === params.get('club')) ?? list.find((c) => c.id === clubId) ?? list.find((c) => c.id === 1) ?? list[0]
  const id = club?.id
  const canEdit = !!id && (isAdmin || clubId === id)
  const lineup = useQuery({ queryKey: ['lineup', id], enabled: !!id, queryFn: async () => (must(await supabase.from('lineups').select('id,formation,status,seasons!inner(is_current),lineup_slots(slot,player_id,position_id,x,y)').eq('club_id', id!).eq('seasons.is_current', true).maybeSingle()) as unknown as Lineup | null) })
  const squad = useQuery({ queryKey: ['club-squad', id], enabled: !!id, queryFn: async () => must(await supabase.from('player_directory').select('*').eq('club_id', id!).order('overall', { ascending: false })) as PlayerRow[] })
  const balance = useQuery({ queryKey: ['balance', id], enabled: canEdit, queryFn: async () => (must(await supabase.from('club_balances').select('balance').eq('club_id', id!).maybeSingle()) as { balance: number } | null)?.balance ?? 0 })
  const market = useQuery({ queryKey: ['market-open'], queryFn: async () => { const w = must(await supabase.from('market_windows').select('closes_at').eq('is_open', true).maybeSingle()) as { closes_at: string | null } | null; return !!w && (!w.closes_at || new Date(w.closes_at) > new Date()) } })
  const season = useSeasons().data?.find((x) => x.is_current); const rules = useRules(season?.id); const size = rules.data?.squad_size ?? 18
  const [slots, setSlots] = useState<SlotState[]>(emptySlots('4-3-3', 18)); const [formation, setFormation] = useState('4-3-3'); const [dirty, setDirtyState] = useState(false); const [pick, setPick] = useState<Selection>(null)
  const dirtyRef = useRef(false); const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v) }
  useEffect(() => { dirtyRef.current = false; setDirtyState(false); setPick(null) }, [id])
  useEffect(() => { if (!lineup.isSuccess || dirtyRef.current) return; setSlots(normalizeSlots(lineup.data, size)); setFormation(lineup.data?.formation ?? '4-3-3'); setPick(null) }, [lineup.data, lineup.isSuccess, size, id])
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn) }, [dirty])
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }))
  const refreshAll = () => { for (const k of ['lineup', 'club-squad', 'summaries', 'balance', 'free-players', 'adjustments']) qc.invalidateQueries({ queryKey: [k] }) }
  const payload = () => slots.map((s) => ({ ...s, x: s.slot < 11 ? s.x : null, y: s.slot < 11 ? s.y : null, position_id: s.slot < 11 ? s.position_id : null }))
  const save = useMutation({ mutationFn: () => rpc('save_lineup', { p_club: id, p_formation: formation, p_slots: payload() }), onSuccess: () => { setDirty(false); toast('Plantilla guardada.'); refreshAll() }, onError: (e: Error) => toast(e.message, 'error') })
  const setStatus = useMutation({ mutationFn: async (status: 'draft' | 'submitted') => { if (status === 'submitted' && dirty) await rpc('save_lineup', { p_club: id, p_formation: formation, p_slots: payload() }); await rpc('set_lineup_status', { p_club: id, p_status: status }); return status }, onSuccess: (s) => { setDirty(false); toast(s === 'submitted' ? 'Plantilla entregada.' : 'Entrega deshecha.'); refreshAll() }, onError: (e: Error) => toast(e.message, 'error') })
  const release = useMutation({ mutationFn: (p: number) => rpc<number>('release_player', { p_club: id, p_player: p }), onSuccess: (n, p) => { setSlots((cur) => cur.map((x) => (x.player_id === p ? { ...x, player_id: null } : x))); setPick(null); toast(`Jugador vendido al club por ${fmtMoney(n)}.`); refreshAll() }, onError: (e: Error) => toast(e.message, 'error') })
  const players = useMemo(() => new Map((squad.data ?? []).map((p) => [p.id, p])), [squad.data])
  if (clubsQ.isPending) return <Loading />
  if (!club) return <Empty title="Todavía no hay clubes activos." />
  const s = sums.data?.find((x) => x.club_id === id); const locked = lineup.data?.status === 'submitted' && !isAdmin; const editable = canEdit && !locked
  const code = (p: number | null) => positions.data?.find((x) => x.id === p)?.code ?? ''
  const slotted = new Set(slots.map((x) => x.player_id).filter(Boolean)); const unplaced = (squad.data ?? []).filter((p) => !slotted.has(p.id))
  const change = (fn: (draft: SlotState[]) => void) => { setSlots((cur) => { const next = cur.map((x) => ({ ...x })); fn(next); return next }); setDirty(true) }
  const place = (from: Selection, toSlot: number | 'unplaced') => {
    change((d) => {
      if (from && 'slot' in from) { if (toSlot === 'unplaced') d[from.slot].player_id = null; else if (toSlot !== from.slot) { const t = d[from.slot].player_id; d[from.slot].player_id = d[toSlot].player_id; d[toSlot].player_id = t } }
      else if (from && 'player' in from && toSlot !== 'unplaced') d[toSlot].player_id = from.player
    })
  }
  const tap = (target: { slot: number } | { player: number }) => {
    if (!pick) { if ('player' in target || slots[target.slot].player_id) setPick(target); return }
    if (JSON.stringify(pick) === JSON.stringify(target)) return setPick(null)
    if ('player' in target) return setPick(target)
    place(pick, target.slot); setPick(null)
  }
  const onDragEnd = ({ active, over, delta }: DragEndEvent) => {
    const a = String(active.id), o = over ? String(over.id) : ''; setPick(null); if (!o) return
    const from: Selection = a.startsWith('s') ? { slot: Number(a.slice(1)) } : { player: Number(a.slice(1)) }
    if (o.startsWith('t')) return place(from, Number(o.slice(1)))
    if (o === 'unplaced') return place(from, 'unplaced')
    if (o === 'pitch' && 'slot' in from && from.slot < 11) { const r = document.getElementById('squad-pitch')!.getBoundingClientRect(); change((d) => { const c = d[from.slot]; c.x = Math.round(Math.min(94, Math.max(6, (c.x ?? 50) + delta.x / r.width * 100)) * 10) / 10; c.y = Math.round(Math.min(96, Math.max(4, (c.y ?? 50) + delta.y / r.height * 100)) * 10) / 10 }) }
  }
  const changeFormation = (f: string) => {
    const pool = slots.slice(0, 11).map((x) => x.player_id).filter(Boolean) as number[]; const shape = FORMATIONS[f]; const out: (number | null)[] = Array(11).fill(null)
    const take = (test: (p: PlayerRow, pos: number) => boolean) => shape.forEach(([pos], i) => { if (out[i]) return; const k = pool.findIndex((id2) => { const p = players.get(id2); return p && test(p, pos) }); if (k >= 0) out[i] = pool.splice(k, 1)[0] })
    take((p, pos) => p.main_position === pos); take((p, pos) => !!p.secondary_positions?.includes(pos)); take(() => true)
    setFormation(f); change((d) => shape.forEach(([pos, x, y], i) => { d[i] = { slot: i, player_id: out[i], position_id: pos, x, y } }))
  }
  const at = (x: SlotState) => (x.player_id ? players.get(x.player_id) : undefined)
  const price = (p: PlayerRow) => (p.market_value ? fmtMoney(p.market_value) : 'gratis')
  const plainText = () => [`Formación ${formation} · Plantel ${fmtMoney(s?.squad_value)}`, ...slots.slice(0, 11).map((x) => { const p = at(x); return `${code(x.position_id)}: ${p ? `${p.name} (${p.overall}, ${price(p)})` : '—'}` }), 'Suplentes:', ...slots.slice(11).map((x) => { const p = at(x); return `- ${p ? `${p.name} (${p.position_code}, ${p.overall}, ${price(p)})` : '—'}` })].join('\n')
  const groupText = () => [`*${club.name}* · ${formation}`, `Plantel ${fmtMoney(s?.squad_value)} · Media ${fmtDec(s?.avg_overall)}`, '', '*Titulares*', ...slots.slice(0, 11).map((x) => { const p = at(x); return `${code(x.position_id)}  ${p ? `${p.name} (${p.overall})` : '—'}` }), '', '*Suplentes*', ...slots.slice(11).map((x) => { const p = at(x); return `- ${p ? `${p.name} (${p.overall})` : '—'}` })].join('\n')
  const copy = (group: boolean) => navigator.clipboard.writeText(group ? groupText() : plainText()).then(() => toast(group ? 'Listo para pegar en el grupo.' : 'Plantilla copiada.'), () => toast('No se pudo copiar.', 'error'))
  const saleAmount = (p: PlayerRow) => Math.round((p.market_value ?? 0) * (1 - (rules.data?.release_discount_pct ?? 0) / 100) * 10) / 10
  const picked = pick && 'slot' in pick ? slots[pick.slot] : null; const pickedPlayer = pick ? ('slot' in pick ? (picked?.player_id ? players.get(picked.player_id) : undefined) : players.get(pick.player)) : undefined
  return <>
    <PageHead title="Armado de plantillas" lead={canEdit ? 'Arrastrá jugadores o tocá dos puestos para intercambiarlos.' : 'Formación, titulares, suplentes y valor de cada plantel.'}><Field label="Club"><select value={club.slug} onChange={(e) => { if (!dirty || confirm('Tenés cambios sin guardar. ¿Cambiar de club y descartarlos?')) setParams({ club: e.target.value }) }}>{list.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select></Field></PageHead>
    <div className="squad-stats">{([['Jugadores', `${s?.players ?? 0}/${size}`], ['Media', fmtDec(s?.avg_overall)], ['Defensa', fmtDec(s?.avg_defense)], ['Mediocampo', fmtDec(s?.avg_midfield)], ['Ataque', fmtDec(s?.avg_attack)], ['Edad', fmtDec(s?.avg_age)], ['Valor', fmtMoney(s?.squad_value)]] as const).map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div>
    <Q q={lineup}>{() => <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}><div className="squad">
      <div className="squad__field">
        <PitchArea editable={editable} label={`Formación ${formation} de ${club.name}`}>{slots.slice(0, 11).map((x) => <PitchToken key={x.slot} s={x} p={x.player_id ? players.get(x.player_id) : undefined} code={code(x.position_id)} editable={editable} picked={!!pick && 'slot' in pick && pick.slot === x.slot} onTap={() => tap({ slot: x.slot })} />)}</PitchArea>
        <div className="tools" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => copy(false)}><Copy size={15} aria-hidden="true" />Copiar plantilla</button><button className="btn" onClick={() => copy(true)}><MessageSquareText size={15} aria-hidden="true" />Copiar para el grupo</button><button className="btn" onClick={() => downloadImage(club, formation, slots, players, code, fmtMoney(s?.squad_value))}><Download size={15} aria-hidden="true" />Descargar imagen</button>
        </div>
      </div>
      <div>
        <div className="squad__meta"><Crest club={club} size={40} /><div><b>{club.name}</b><span>{formation}, {lineup.data?.status === 'submitted' ? 'plantilla entregada' : 'en armado'}</span></div></div>
        {canEdit && <div className="panel">
          <div className="balance"><span>Saldo disponible</span><b>{fmtMoney(balance.data)}</b></div>
          <div className="form-grid" style={{ marginTop: 10 }}><Field label="Formación"><select value={formation} disabled={!editable} onChange={(e) => changeFormation(e.target.value)}>{[...new Set([formation, ...Object.keys(FORMATIONS)])].map((f) => <option key={f}>{f}</option>)}</select></Field></div>
          <div className="tools" style={{ marginTop: 12 }}>{editable && <button className="btn btn--primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save size={15} aria-hidden="true" />{save.isPending ? 'Guardando' : 'Guardar cambios'}</button>}{lineup.data?.status === 'submitted' ? <button className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate('draft')}>Deshacer entrega</button> : <button className="btn" disabled={setStatus.isPending} onClick={() => { if (confirm('¿Entregar la plantilla? Quedará bloqueada hasta que deshagas la entrega.')) setStatus.mutate('submitted') }}>Entregar plantilla</button>}</div>
        </div>}
        {editable && pickedPlayer && <div className="panel"><strong>{pickedPlayer.name}</strong><p>Tocá otro puesto para moverlo.</p>
          {picked && picked.slot < 11 && <Field label="Posición en este puesto"><select value={picked.position_id ?? ''} onChange={(e) => change((d) => { d[picked.slot].position_id = Number(e.target.value) })}>{positions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          <div className="tools" style={{ marginTop: 10 }}><Link className="btn btn--small" to={`/jugadores/${pickedPlayer.id}`}>Ver ficha</Link>{market.data && <button className="btn btn--small btn--danger" disabled={release.isPending} onClick={() => { if (confirm(`¿Vender a ${pickedPlayer.name} al club? Vas a recibir ${fmtMoney(saleAmount(pickedPlayer))}.`)) release.mutate(pickedPlayer.id) }}>Vender al club</button>}</div>
        </div>}
        <Section title="Suplentes"><div className="bench">{slots.slice(11).map((x, i) => <BenchRow key={x.slot} id={`s${x.slot}`} dropId={`t${x.slot}`} p={x.player_id ? players.get(x.player_id) : undefined} label={`Suplente ${i + 1}`} editable={editable} picked={!!pick && 'slot' in pick && pick.slot === x.slot} onTap={() => tap({ slot: x.slot })} />)}</div></Section>
        {canEdit && (editable || unplaced.length > 0) && <Section title="Sin ubicar"><UnplacedZone>{!unplaced.length && <span className="editor-note">Soltá acá a un jugador para sacarlo de la alineación.</span>}{unplaced.map((p) => <BenchRow key={p.id} id={`u${p.id}`} p={p} label="" editable={editable} picked={!!pick && 'player' in pick && pick.player === p.id} onTap={() => tap({ player: p.id })} />)}</UnplacedZone></Section>}
        <PendingSquad clubId={club.id} canAct={canEdit} onChange={refreshAll} />
        {canEdit && market.data && <SignPlayer clubId={club.id} onChange={refreshAll} />}
      </div>
    </div></DndContext>}</Q>
  </>
}
