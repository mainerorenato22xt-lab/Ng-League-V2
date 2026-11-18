export const BASE = import.meta.env.BASE_URL

const money = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
export const fmtNumber = (n: number | null | undefined) => (n == null ? 'Sin dato' : money.format(Number(n)))
export const fmtMoney = (n: number | null | undefined) => (n == null ? 'Sin precio' : Number(n) === 0 ? '0 M' : `${money.format(Number(n))} M`)
export const fmtDec = (n: number | null | undefined) => (n == null ? 'Sin dato' : new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(n)))
export const fmtSigned = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Fecha a confirmar')
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const crestUrl = (c: { id: number; crest_path?: string | null }) => c.crest_path || `${BASE}crests/${c.id}.webp`
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
export const ATTRIBUTE_GROUPS: { title: string; items: [string, number][] }[] = [
  { title: 'Técnica', items: ['Ataque', 'Control de balón', 'Regate', 'Posesión', 'Pase raso', 'Pase alto', 'Definición', 'Cabeceo', 'Balón parado', 'Efecto'].map((n, i) => [n, i]) },
  { title: 'Físico', items: ['Velocidad', 'Aceleración', 'Potencia de tiro', 'Salto', 'Contacto físico', 'Equilibrio', 'Resistencia'].map((n, i) => [n, i + 10]) },
  { title: 'Defensa', items: ['Defensa', 'Recuperación', 'Agresividad'].map((n, i) => [n, i + 17]) },
  { title: 'Portero', items: ['Actitud', 'Atajadas', 'Despeje', 'Reflejos', 'Alcance'].map((n, i) => [n, i + 20]) },
]
export const PHASE_LABEL: Record<string, string> = { regular: 'Fase regular', quarterfinal: 'Cuartos de final', semifinal: 'Semifinal', final: 'Final', relegation: 'Descenso' }
