import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import type { Club, Match } from '../lib/data'
import { must, rpc, supabase } from '../lib/supabase'
import { Field, toast } from './ui'

type Ev = { kind: string; club_id: number; player_id: string; raw: string; label: string; minute: string }
const KINDS: [string, string][] = [['goal', 'Gol'], ['own_goal', 'Gol en contra'], ['assist', 'Asistencia'], ['yellow_card', 'Amarilla'], ['red_card', 'Roja']]

export function ResultForm({ match, home, away, onDone }: { match: Match; home: Club; away: Club; onDone?: () => void }) {
  const qc = useQueryClient()
  const [hg, setHg] = useState(match.home_goals?.toString() ?? ''); const [ag, setAg] = useState(match.away_goals?.toString() ?? '')
  const [hp, setHp] = useState(match.home_penalties?.toString() ?? ''); const [ap, setAp] = useState(match.away_penalties?.toString() ?? '')
  const [events, setEvents] = useState<Ev[]>([])
  const saved = useQuery({ queryKey: ['events-edit', match.id], queryFn: async () => must(await supabase.from('match_events').select('kind,club_id,player_id,raw_player_name,minute,player:players(name)').eq('match_id', match.id).order('id')) as unknown as { kind: string; club_id: number; player_id: number | null; raw_player_name: string | null; minute: number | null; player: { name: string } | null }[] })
  useEffect(() => { if (saved.data) setEvents(saved.data.map((e) => ({ kind: e.kind, club_id: e.club_id, player_id: e.player_id ? String(e.player_id) : '', raw: e.raw_player_name ?? '', label: e.player?.name ?? e.raw_player_name ?? '', minute: e.minute?.toString() ?? '' }))) }, [saved.data])
  const players = useQuery({ queryKey: ['match-players', home.id, away.id], queryFn: async () => must(await supabase.from('player_directory').select('id,name,club_id').in('club_id', [home.id, away.id]).order('name')) as { id: number; name: string; club_id: number }[] })
  const refresh = () => { qc.invalidateQueries(); onDone?.() }
  const knockout = match.phase !== 'regular'
  const tied = hg !== '' && Number(hg) === Number(ag)
  const missingPens = knockout && tied && (hp === '' || ap === '' || Number(hp) === Number(ap))
  const incomplete = events.some((e) => !e.player_id && !e.raw)
  const save = useMutation({
    mutationFn: () => rpc('admin_save_result', { p_match: match.id, p_home: Number(hg), p_away: Number(ag), p_home_penalties: knockout && tied ? Number(hp) : null, p_away_penalties: knockout && tied ? Number(ap) : null, p_events: events.map((e) => ({ kind: e.kind, club_id: e.club_id, player_id: e.player_id ? Number(e.player_id) : null, raw_player_name: e.raw || null, minute: e.minute })), p_notes: match.notes }),
    onSuccess: () => { toast('Resultado guardado.'); refresh() }, onError: (e: Error) => toast(e.message, 'error'),
  })
  const clear = useMutation({ mutationFn: () => rpc('admin_clear_result', { p_match: match.id }), onSuccess: () => { setHg(''); setAg(''); setHp(''); setAp(''); setEvents([]); toast('Resultado borrado.'); refresh() }, onError: (e: Error) => toast(e.message, 'error') })
  const edit = (i: number, patch: Partial<Ev>) => setEvents((list) => list.map((e, n) => (n === i ? { ...e, ...patch } : e)))
  const score = (label: string, value: string, set: (s: string) => void) => <Field label={label}><input type="number" min="0" inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} /></Field>
  return (
    <form className="result-form" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <div className="score-inputs"><strong>{home.name}</strong>{score('Local', hg, setHg)}{score('Visitante', ag, setAg)}<strong>{away.name}</strong></div>
      {knockout && tied && <div className="score-inputs"><span>Penales</span>{score('Local', hp, setHp)}{score('Visitante', ap, setAp)}<span /></div>}
      {events.map((e, i) => (
        <div className="event-row" key={i}>
          <Field label="Evento"><select value={e.kind} onChange={(x) => edit(i, { kind: x.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Jugador"><select value={e.player_id ? `${e.club_id}:${e.player_id}` : e.raw ? `${e.club_id}:raw` : ':'} onChange={(x) => { const [c, p] = x.target.value.split(':'); if (c && p && p !== 'raw') edit(i, { club_id: Number(c), player_id: p, raw: '', label: '' }) }}><option value=":" disabled>Elegir jugador</option>{e.label && !players.data?.some((p) => String(p.id) === e.player_id) && <option value={e.player_id ? `${e.club_id}:${e.player_id}` : `${e.club_id}:raw`}>{e.label}</option>}{[home, away].map((c) => <optgroup key={c.id} label={c.name}>{players.data?.filter((p) => p.club_id === c.id).map((p) => <option key={p.id} value={`${c.id}:${p.id}`}>{p.name}</option>)}</optgroup>)}</select></Field>
          <Field label="Minuto"><input type="number" min="0" max="200" value={e.minute} onChange={(x) => edit(i, { minute: x.target.value })} /></Field>
          <button type="button" className="icon-btn" aria-label="Quitar evento" onClick={() => setEvents((l) => l.filter((_, n) => n !== i))}><X size={17} /></button>
        </div>
      ))}
      <div className="tools">
        <button type="button" className="btn" onClick={() => setEvents((l) => [...l, { kind: 'goal', club_id: home.id, player_id: '', raw: '', label: '', minute: '' }])}><Plus size={15} aria-hidden="true" />Agregar evento</button>
        <button className="btn btn--primary" disabled={hg === '' || ag === '' || missingPens || incomplete || save.isPending}>{save.isPending ? 'Guardando' : 'Guardar resultado'}</button>
        {match.status === 'played' && <button type="button" className="btn btn--danger" disabled={clear.isPending} onClick={() => { if (confirm('¿Borrar este resultado y sus eventos?')) clear.mutate() }}>Borrar resultado</button>}
      </div>
      {missingPens && <p className="note">Un cruce empatado necesita un resultado de penales con ganador.</p>}
      {incomplete && <p className="note">Elegí el jugador de cada evento o quitá el evento.</p>}
    </form>
  )
}
