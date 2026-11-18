import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { byId, useClubs, useRules, useSeasons, type Club } from '../lib/data'
import { fmtDate, fmtMoney, fmtNumber } from '../lib/format'
import { useAuth } from '../lib/auth'
import { must, rpc, supabase } from '../lib/supabase'
import { ClubLink, Empty, Field, PageHead, Q, Rating, Section, toast } from '../components/ui'

const KIND: Record<string, string> = { purchase: 'Compra', free_signing: 'Jugador libre', club_release: 'Jugador liberado', loan_start: 'Préstamo', loan_return: 'Fin de préstamo', loan_purchase: 'Compra tras préstamo', swap: 'Intercambio', release_clause: 'Cláusula de rescisión', admin: 'Ajuste' }
const STATUS: Record<string, string> = { sent: 'Oferta enviada', negotiating: 'En negociación', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada', completed: 'Completada' }
type Listing = { player_id: number; club_id: number; asking_price: number | null; name: string; overall: number; age: number | null; position_code: string; market_value: number | null }
type Deal = { id: number; player_id: number; seller_club: number; buyer_club: number; status: string; player: { id: number; name: string; overall: number }; negotiation_offers: { id: number; amount: number }[] }
const lastAmount = (d: Deal) => [...d.negotiation_offers].sort((a, b) => b.id - a.id)[0]?.amount ?? 0
const isOpenDeal = (d: Deal) => d.status === 'sent' || d.status === 'negotiating'

function useMarketAction<T>(fn: (arg: T) => Promise<unknown>, ok: string, done?: () => void) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => { toast(ok); done?.(); qc.invalidateQueries() }, onError: (e: Error) => toast(e.message, 'error') })
}

function Listings({ open, clubId, balance, clubs }: { open: boolean; clubId: number | null; balance?: number; clubs: Map<number, Club> }) {
  const list = useQuery({ queryKey: ['transfer-market'], queryFn: async () => must(await supabase.from('transfer_market').select('player_id,club_id,asking_price,name,overall,age,position_code,market_value').order('created_at', { ascending: false })) as Listing[] })
  const [target, setTarget] = useState<number | null>(null); const [amount, setAmount] = useState('')
  const offer = useMarketAction((p: number) => rpc('make_offer', { p_buyer: clubId, p_player: p, p_amount: Number(amount) }), 'Oferta enviada.', () => setTarget(null))
  const start = (l: Listing) => { setTarget(l.player_id); setAmount(String(l.asking_price ?? l.market_value ?? '')) }
  return <Section title="Jugadores transferibles"><Q q={list}>{(rows) => rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Jugador</th><th scope="col">Club</th><th scope="col" className="hide-sm">Pos</th><th className="num hide-sm" scope="col">Valor</th><th className="num" scope="col">Pide</th><th scope="col"><span className="sr-only">Acción</span></th></tr></thead><tbody>{rows.flatMap((l) => {
    const can = open && !!clubId && clubId !== l.club_id
    const row = <tr key={l.player_id}><td><span className="player-cell"><Rating value={l.overall} /><Link to={`/jugadores/${l.player_id}`}>{l.name}</Link></span></td><td><ClubLink club={clubs.get(l.club_id)} size={22} /></td><td className="hide-sm">{l.position_code}</td><td className="num hide-sm">{fmtMoney(l.market_value)}</td><td className="num">{l.asking_price == null ? <span className="muted">A convenir</span> : fmtMoney(l.asking_price)}</td><td className="num">{can && <button className="btn btn--small" onClick={() => (target === l.player_id ? setTarget(null) : start(l))}>{target === l.player_id ? 'Cerrar' : 'Ofertar'}</button>}</td></tr>
    if (target !== l.player_id) return [row]
    return [row, <tr key={`o${l.player_id}`}><td colSpan={6}><form className="offer-form" onSubmit={(e) => { e.preventDefault(); offer.mutate(l.player_id) }}><Field label="Tu oferta (M)"><input type="number" min="0.1" step="0.1" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><span className="muted">Tu saldo: {fmtMoney(balance)}</span><button className="btn btn--primary" disabled={offer.isPending || !(Number(amount) > 0)}>Enviar oferta</button><p className="note">Para que te lo vendan necesitás un lugar libre en tu plantilla.</p></form></td></tr>]
  })}</tbody></table></div> : <Empty title="Todavía no hay jugadores transferibles.">Los DT los publican desde Armado de plantillas.</Empty>}</Q></Section>
}

function Offers({ clubId, open, clubs }: { clubId: number; open: boolean; clubs: Map<number, Club> }) {
  const deals = useQuery({ queryKey: ['offers', clubId], queryFn: async () => must(await supabase.from('negotiations').select('id,player_id,seller_club,buyer_club,status,player:players(id,name,overall),negotiation_offers(id,amount)').or(`seller_club.eq.${clubId},buyer_club.eq.${clubId}`).order('created_at', { ascending: false }).limit(40)) as unknown as Deal[] })
  const respond = useMarketAction(({ id, accept }: { id: number; accept: boolean }) => rpc('respond_offer', { p_negotiation: id, p_accept: accept }), 'Oferta respondida.')
  const cancel = useMarketAction((id: number) => rpc('cancel_offer', { p_negotiation: id }), 'Oferta cancelada.')
  const received = deals.data?.filter((d) => d.seller_club === clubId && isOpenDeal(d)) ?? []; const sent = deals.data?.filter((d) => d.buyer_club === clubId) ?? []
  const name = (d: Deal) => <span className="player-cell"><Rating value={d.player.overall} /><Link to={`/jugadores/${d.player.id}`}>{d.player.name}</Link></span>
  return <div className="two-col offers"><Section title="Ofertas recibidas">{received.length ? <ul className="deal-list">{received.map((d) => <li key={d.id}>{name(d)}<span><ClubLink club={clubs.get(d.buyer_club)} size={20} /> ofrece <b>{fmtMoney(lastAmount(d))}</b></span><div className="tools"><button className="btn btn--small btn--primary" disabled={!open || respond.isPending} onClick={() => { if (confirm(`¿Vender a ${d.player.name} a ${clubs.get(d.buyer_club)?.name} por ${fmtMoney(lastAmount(d))}?`)) respond.mutate({ id: d.id, accept: true }) }}>Aceptar</button><button className="btn btn--small" disabled={respond.isPending} onClick={() => respond.mutate({ id: d.id, accept: false })}>Rechazar</button></div></li>)}</ul> : <Empty title="No tenés ofertas para responder." />}</Section>
    <Section title="Ofertas enviadas">{sent.length ? <ul className="deal-list">{sent.map((d) => <li key={d.id}>{name(d)}<span><ClubLink club={clubs.get(d.seller_club)} size={20} /> por <b>{fmtMoney(lastAmount(d))}</b></span>{isOpenDeal(d) ? <button className="btn btn--small" disabled={cancel.isPending} onClick={() => cancel.mutate(d.id)}>Cancelar oferta</button> : <span className="muted">{STATUS[d.status]}</span>}</li>)}</ul> : <Empty title="Todavía no enviaste ofertas." />}</Section></div>
}

export function Market() {
  const clubs = byId(useClubs().data); const season = useSeasons().data?.find((x) => x.is_current); const rules = useRules(season?.id); const { clubId, isAdmin } = useAuth()
  const win = useQuery({ queryKey: ['market-window'], queryFn: async () => must(await supabase.from('market_windows').select('*').eq('is_open', true).maybeSingle()) as { closes_at: string | null } | null })
  const open = !!win.data && (!win.data.closes_at || new Date(win.data.closes_at) > new Date())
  const balance = useQuery({ queryKey: ['balance', clubId], enabled: !!clubId, queryFn: async () => (must(await supabase.from('club_balances').select('balance').eq('club_id', clubId!).maybeSingle()) as { balance: number } | null)?.balance ?? 0 })
  const list = useQuery({ queryKey: ['transfers'], queryFn: async () => must(await supabase.from('transfers').select('id,kind,amount,from_club,to_club,occurred_at,player:players(id,name)').order('occurred_at', { ascending: false }).limit(50)) as unknown as { id: number; kind: string; amount: number; from_club: number | null; to_club: number | null; occurred_at: string; player: { id: number; name: string } }[] })
  return <>
    <PageHead title="Mercado de pases" lead={open ? (win.data?.closes_at ? `Abierto hasta el ${fmtDate(win.data.closes_at)}.` : 'Abierto.') : 'El mercado está cerrado.'} />
    {!open && isAdmin && <p className="note">Podés abrirlo desde <Link to="/administracion?seccion=mercado">el panel de administración</Link>.</p>}
    {rules.data && <div className="format"><div><b>+{fmtNumber(rules.data.clause_premium_pct)} %</b><span>cláusula sobre el valor del jugador</span></div><div><b>−{fmtNumber(rules.data.release_discount_pct)} %</b><span>al dejar libre a un jugador</span></div><div><b>{rules.data.squad_size}</b><span>jugadores por plantilla</span></div></div>}
    <Listings open={open} clubId={clubId} balance={balance.data} clubs={clubs} />
    {clubId && <Offers clubId={clubId} open={open} clubs={clubs} />}
    <Section title="Transferencias"><Q q={list}>{(rows) => rows.length ? <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Jugador</th><th scope="col">Operación</th><th scope="col" className="hide-sm">Desde</th><th scope="col" className="hide-sm">Hacia</th><th className="num" scope="col">Importe</th></tr></thead><tbody>{rows.map((t) => <tr key={t.id}><td><Link to={`/jugadores/${t.player.id}`}>{t.player.name}</Link></td><td>{KIND[t.kind]}</td><td className="hide-sm">{t.from_club ? <ClubLink club={clubs.get(t.from_club)} size={20} /> : 'Libre'}</td><td className="hide-sm">{t.to_club ? <ClubLink club={clubs.get(t.to_club)} size={20} /> : 'Libre'}</td><td className="num">{fmtMoney(t.amount)}</td></tr>)}</tbody></table></div> : <Empty title="Todavía no hay transferencias registradas." />}</Q></Section>
  </>
}
