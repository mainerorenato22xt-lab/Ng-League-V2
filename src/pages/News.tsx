import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, EyeOff, Heart, ImagePlus, PenLine, Shield, Trophy, X } from 'lucide-react'
import { byId, useClubs, type Club } from '../lib/data'
import { BASE, fmtDate } from '../lib/format'
import { useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { Crest, Empty, Field, PageHead, Q, toast } from '../components/ui'

export type Post = { id: number; club_id: number | null; author_name: string; category: string; title: string | null; body: string; image_path: string | null; status: string; published_at: string; is_auto: boolean; link_path: string | null; likes: number; liked: boolean }
export const CATEGORY: Record<string, string> = { official: 'Oficial', transfer: 'Fichajes', statement: 'Declaración', result: 'Resultado', preview: 'Previa', chronicle: 'Crónica', communique: 'Comunicado', club: 'Novedad del club' }
const WRITE_CATEGORIES = ['club', 'transfer', 'statement', 'preview', 'chronicle', 'communique']
export const newsImage = (path: string) => (path.startsWith('http') ? path : `${BASE}news/${path}`)
const PAGE = 20
const group = (rows: Post[]) => rows.reduce<(Post | Post[])[]>((out, p) => { const last = out[out.length - 1]; if (p.is_auto && Array.isArray(last)) last.push(p); else out.push(p.is_auto ? [p] : p); return out }, [])

async function toWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.84))
  if (!blob) throw new Error('No se pudo procesar la imagen')
  if (blob.size > 3 * 1024 * 1024) throw new Error('La imagen es demasiado pesada, probá con una más chica')
  return blob
}

function Composer({ post, onClose }: { post?: Post; onClose: () => void }) {
  const { isAdmin, clubId } = useAuth(); const clubs = useClubs().data ?? []; const qc = useQueryClient()
  const [as, setAs] = useState<string>(post ? String(post.club_id ?? '') : isAdmin ? '' : String(clubId ?? ''))
  const [category, setCategory] = useState(post?.category ?? (isAdmin ? 'official' : 'club'))
  const [title, setTitle] = useState(post?.title ?? ''); const [body, setBody] = useState(post?.body ?? '')
  const [file, setFile] = useState<File | null>(null); const [image, setImage] = useState(post?.image_path ?? null)
  const preview = file ? URL.createObjectURL(file) : image ? newsImage(image) : null
  useEffect(() => () => { if (file && preview) URL.revokeObjectURL(preview) }, [file, preview])
  const official = as === ''
  const save = useMutation({
    mutationFn: async () => {
      let path = image
      if (file) {
        const blob = await toWebp(file); const key = `${official ? 'liga' : as}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
        const up = await supabase.storage.from('news').upload(key, blob, { contentType: 'image/webp' }); if (up.error) throw new Error(up.error.message)
        path = supabase.storage.from('news').getPublicUrl(key).data.publicUrl
      }
      const row = { club_id: official ? null : Number(as), category: official ? 'official' : category === 'official' ? 'club' : category, title: title.trim() || null, body: body.trim(), image_path: path, author_name: 'NG League' }
      if (post) must(await supabase.from('news_posts').update(row).eq('id', post.id).select('id'))
      else must(await supabase.from('news_posts').insert(row).select('id'))
    },
    onSuccess: () => { toast(post ? 'Noticia actualizada.' : 'Noticia publicada.'); qc.invalidateQueries({ queryKey: ['news'] }); qc.invalidateQueries({ queryKey: ['home-news'] }); onClose() },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); if (body.trim()) save.mutate() }
  return (
    <form className="composer" onSubmit={submit}>
      <div className="form-grid">
        {isAdmin ? <Field label="Publicar como"><select value={as} onChange={(e) => setAs(e.target.value)}><option value="">NG League (oficial)</option>{clubs.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          : <Field label="Publicar como"><input value={clubs.find((c) => c.id === clubId)?.name ?? ''} readOnly /></Field>}
        {!official && <Field label="Tipo"><select value={category} onChange={(e) => setCategory(e.target.value)}>{WRITE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}</select></Field>}
      </div>
      <Field label="Título, opcional"><input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Texto"><textarea value={body} maxLength={20000} rows={7} required onChange={(e) => setBody(e.target.value)} /></Field>
      {preview && <div className="composer__image"><img src={preview} alt="" /><button type="button" className="icon-btn" aria-label="Quitar foto" onClick={() => { setFile(null); setImage(null) }}><X size={17} /></button></div>}
      <div className="tools">
        <label className="btn"><ImagePlus size={15} aria-hidden="true" />{preview ? 'Cambiar foto' : 'Agregar foto'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = '' }} /></label>
        <span className="push" />
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={!body.trim() || save.isPending}>{save.isPending ? 'Publicando' : post ? 'Guardar cambios' : 'Publicar'}</button>
      </div>
    </form>
  )
}

const AUTO_ICON: Record<string, typeof Trophy> = { transfer: ArrowLeftRight, result: Shield, official: Trophy }

function PostCard({ p, clubs }: { p: Post; clubs: Map<number, Club> }) {
  const { session, isAdmin, clubId } = useAuth(); const qc = useQueryClient()
  const [editing, setEditing] = useState(false); const [open, setOpen] = useState(false)
  const club = p.club_id ? clubs.get(p.club_id) : null
  const refresh = () => { qc.invalidateQueries({ queryKey: ['news'] }); qc.invalidateQueries({ queryKey: ['home-news'] }) }
  const fail = (e: Error) => toast(e.message, 'error')
  const like = useMutation({ mutationFn: async () => {
    const uid = session!.user.id
    if (p.liked) must(await supabase.from('post_likes').delete().eq('post_id', p.id).eq('user_id', uid).select())
    else must(await supabase.from('post_likes').insert({ post_id: p.id, user_id: uid }).select())
  }, onSuccess: refresh, onError: fail })
  const remove = useMutation({ mutationFn: async () => { must(await supabase.from('news_posts').delete().eq('id', p.id).select('id')) }, onSuccess: () => { toast('Noticia borrada.'); refresh() }, onError: fail })
  const visibility = useMutation({ mutationFn: async () => { must(await supabase.from('news_posts').update({ status: p.status === 'hidden' ? 'published' : 'hidden' }).eq('id', p.id).select('id')) }, onSuccess: () => { toast(p.status === 'hidden' ? 'Noticia visible otra vez.' : 'Noticia oculta.'); refresh() }, onError: fail })
  const canEdit = !p.is_auto && (isAdmin || (!!clubId && clubId === p.club_id))
  const likeButton = session
    ? <button className={`like ${p.liked ? 'is-on' : ''}`} aria-pressed={p.liked} disabled={like.isPending} onClick={() => like.mutate()}><Heart size={16} aria-hidden="true" fill={p.liked ? 'currentColor' : 'none'} />{p.likes || ''}<span className="sr-only">Me gusta</span></button>
    : <Link className="like" to="/ingresar" title="Ingresá para dar me gusta"><Heart size={16} aria-hidden="true" />{p.likes || ''}<span className="sr-only">Me gusta</span></Link>
  const adminTools = isAdmin && <button className="btn btn--small" disabled={visibility.isPending} onClick={() => visibility.mutate()}>{p.status === 'hidden' ? 'Mostrar' : 'Ocultar'}</button>

  if (p.is_auto) {
    const Icon = AUTO_ICON[p.category] ?? Shield
    const inner = <><span className="auto-post__icon">{club ? <Crest club={club} size={24} /> : <Icon size={17} aria-hidden="true" />}</span><span>{p.category === 'transfer' ? <><b>{p.body}</b><small>{fmtDate(p.published_at)}</small></> : <><b>{p.title}</b><small>{p.body.replace(/\.$/, '')}, {fmtDate(p.published_at)}</small></>}</span></>
    return <article id={`n${p.id}`} className={`auto-post ${p.status === 'hidden' ? 'is-hidden' : ''}`}>{p.link_path ? <Link to={p.link_path}>{inner}</Link> : <div>{inner}</div>}<div className="auto-post__tools">{likeButton}{adminTools}</div></article>
  }
  if (editing) return <Composer post={p} onClose={() => setEditing(false)} />
  const long = p.body.length > 520
  return (
    <article id={`n${p.id}`} className={`post ${p.status === 'hidden' ? 'is-hidden' : ''}`}>
      <header>
        {club ? <Crest club={club} size={34} /> : <img src={`${BASE}brand/logo.webp`} alt="" width="23" height="34" />}
        <div><b>{club ? <Link to={`/clubes/${club.slug}`}>{club.name}</Link> : 'NG League'}</b><small>{p.author_name}, {fmtDate(p.published_at)}</small></div>
        <span className="post__tag">{p.status === 'hidden' ? 'Oculta' : CATEGORY[p.category]}</span>
      </header>
      {p.title && <h3>{p.title}</h3>}
      <p className={`prose ${long && !open ? 'is-clamped' : ''}`}>{p.body}</p>
      {long && <button className="text-link" onClick={() => setOpen(!open)}>{open ? 'Ver menos' : 'Ver más'}</button>}
      {p.image_path && <img className="post__image" src={newsImage(p.image_path)} alt="" loading="lazy" />}
      <footer>{likeButton}<span className="push" />{canEdit && <button className="btn btn--small" onClick={() => setEditing(true)}>Editar</button>}{adminTools}{canEdit && <button className="btn btn--small btn--danger" disabled={remove.isPending} onClick={() => { if (confirm('¿Borrar esta noticia?')) remove.mutate() }}>Borrar</button>}</footer>
    </article>
  )
}

export function News() {
  const clubs = useClubs(); const map = byId(clubs.data); const { session, isAdmin, clubId } = useAuth(); const [params, setParams] = useSearchParams()
  const kind = params.get('ver') ?? 'todas'; const club = params.get('club') ?? ''
  const [writing, setWriting] = useState(false)
  const feed = useInfiniteQuery({
    queryKey: ['news', kind, club, session?.user.id ?? 'anon'], initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('news_feed').select('*').order('published_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1)
      if (!isAdmin) q = q.eq('status', 'published')
      if (kind === 'clubes') q = q.eq('is_auto', false); if (kind === 'movimientos') q = q.eq('is_auto', true)
      if (club) q = q.eq('club_id', Number(club))
      return must(await q) as Post[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !feed.data || !location.hash) return
    const el = document.getElementById(location.hash.slice(1)); if (el) { scrolled.current = true; el.scrollIntoView({ block: 'center' }); el.classList.add('is-target') }
  }, [feed.data])
  const set = (k: string, v: string) => { const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); setParams(next, { replace: true }) }
  const canWrite = isAdmin || !!clubId
  return <>
    <PageHead title="Noticias" lead="Novedades oficiales, de cada club y todo lo que pasa en la liga.">{canWrite && !writing && <button className="btn btn--primary" onClick={() => setWriting(true)}><PenLine size={15} aria-hidden="true" />Escribir noticia</button>}</PageHead>
    {session && !canWrite && <p className="note">Para publicar, tu cuenta tiene que estar vinculada a un club.</p>}
    <div className="news-page">
      {writing && <Composer onClose={() => setWriting(false)} />}
      <div className="news-filters">
        <div className="segmented" role="group" aria-label="Qué noticias ver">{[['todas', 'Todas'], ['clubes', 'Escritas'], ['movimientos', 'Movimientos y resultados']].map(([k, l]) => <button key={k} aria-pressed={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => set('ver', k === 'todas' ? '' : k)}>{l}</button>)}</div>
        <Field label="Club"><select value={club} onChange={(e) => set('club', e.target.value)}><option value="">Todos</option>{clubs.data?.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Q q={feed}>{(data) => { const rows = data.pages.flat(); return rows.length ? <>
        <div className="news-feed">{group(rows).map((g) => Array.isArray(g) ? <div className="auto-group" key={`g${g[0].id}`}>{g.map((p) => <PostCard key={p.id} p={p} clubs={map} />)}</div> : <PostCard key={g.id} p={g} clubs={map} />)}</div>
        {feed.hasNextPage && <button className="btn load-more" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Cargando' : 'Ver más noticias'}</button>}
      </> : <Empty title="No hay noticias con este filtro.">{canWrite ? 'Podés publicar la primera con Escribir noticia.' : undefined}</Empty> }}</Q>
      {isAdmin && <p className="note"><EyeOff size={13} aria-hidden="true" /> Las noticias ocultas solo las ve el administrador.</p>}
    </div>
  </>
}
