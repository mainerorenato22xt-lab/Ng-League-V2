import { useQuery } from '@tanstack/react-query'
import { must, supabase } from './supabase'

export type Club = { id: number; name: string; slug: string; short_name: string | null; crest_path: string | null; primary_color: string | null; secondary_color: string | null; founded_year: number | null; stadium: string | null; nickname: string | null; history: string | null; is_active: boolean }
export type Season = { id: number; number: number; name: string | null; status: 'draft' | 'regular' | 'playoffs' | 'closed'; is_current: boolean; data_quality: string; closed_at: string | null; notes: string | null }
export type Match = { id: number; season_id: number; phase: string; round: number | null; bracket_code: string | null; home_club: number | null; away_club: number | null; home_source: string | null; away_source: string | null; scheduled_at: string | null; status: string; home_goals: number | null; away_goals: number | null; home_penalties: number | null; away_penalties: number | null; winner_club: number | null; notes: string | null; data_quality: string }
export type Row = { position: number; club_id: number; club_name: string; played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_diff: number; points: number }
export type Honour = { club_id: number; club_name: string; titles: number; runner_ups: number; symbolic_relegations: number }
export type Archive = { season_id: number; champion_club: number | null; runner_up_club: number | null; relegated_clubs: number[]; final_score: string | null; format_notes: string | null }
export type Summary = { club_id: number; club_name: string; players: number; squad_value: number; avg_overall: number | null; avg_defense: number | null; avg_midfield: number | null; avg_attack: number | null; avg_age: number | null }
export type PlayerRow = { id: number; name: string; country_id: number | null; country_name: string | null; age: number | null; height_cm: number | null; weight_kg: number | null; foot: 'left' | 'right' | null; main_position: number; position_code: string; position_line: string; secondary_positions: number[]; overall: number; photo_path: string | null; market_value: number | null; release_clause: number | null; is_eligible: boolean; club_id: number | null; club_name: string | null; club_slug: string | null; is_available: boolean; reserved_club_id: number | null; reserved_club_name: string | null }
export type Rules = { season_id: number; squad_size: number; starters: number; bench: number; budget: number; enforce_balance: boolean; star_rating: number; required_stars: number; clause_premium_pct: number; release_discount_pct: number; points_win: number; points_draw: number; points_loss: number; rounds: number; tiebreakers: string[]; league_prizes: number[]; playoff_prizes: number[] }
export type Coach = { id: number; name: string; avatar_url: string | null; coach_tenures: { club_id: number; from_season: number | null; to_season: number | null; is_current: boolean }[] }

const long = { staleTime: 5 * 60_000 }
export const useClubs = () => useQuery({ queryKey: ['clubs'], ...long, queryFn: async () => must(await supabase.from('clubs').select('*').order('name')) as Club[] })
export const useSeasons = () => useQuery({ queryKey: ['seasons'], ...long, queryFn: async () => must(await supabase.from('seasons').select('*').order('number', { ascending: false })) as Season[] })
export const useHonours = () => useQuery({ queryKey: ['honours'], ...long, queryFn: async () => must(await supabase.from('club_honours').select('*').order('titles', { ascending: false }).order('club_name')) as Honour[] })
export const useArchives = () => useQuery({ queryKey: ['archives'], ...long, queryFn: async () => must(await supabase.from('season_archives').select('*')) as Archive[] })
export const useSummaries = () => useQuery({ queryKey: ['summaries'], ...long, queryFn: async () => must(await supabase.from('club_squad_summary').select('*')) as Summary[] })
export const useCoaches = () => useQuery({ queryKey: ['coaches'], ...long, queryFn: async () => must(await supabase.from('coaches').select('id,name,avatar_url,coach_tenures(club_id,from_season,to_season,is_current)').order('name')) as unknown as Coach[] })
export const useRules = (seasonId?: number) => useQuery({ queryKey: ['rules', seasonId], enabled: !!seasonId, ...long, queryFn: async () => must(await supabase.from('season_rules').select('*').eq('season_id', seasonId!).maybeSingle()) as Rules | null })
export const usePriceScale = (seasonId?: number) => useQuery({ queryKey: ['prices', seasonId], enabled: !!seasonId, ...long, queryFn: async () => must(await supabase.from('price_scales').select('overall,value').eq('season_id', seasonId!).order('overall', { ascending: false })) as { overall: number; value: number }[] })
export const useSeasonClubs = (seasonId?: number) => useQuery({ queryKey: ['season-clubs', seasonId], enabled: !!seasonId, ...long, queryFn: async () => (must(await supabase.from('season_clubs').select('club_id').eq('season_id', seasonId!).eq('is_active', true)) as { club_id: number }[]).map((r) => r.club_id) })
export const useMatches = (seasonId?: number) => useQuery({ queryKey: ['matches', seasonId], enabled: !!seasonId, queryFn: async () => must(await supabase.from('matches').select('*').eq('season_id', seasonId!).order('round', { nullsFirst: false }).order('id')) as Match[] })
export const useScorers = (seasonId?: number) => useQuery({ queryKey: ['scorers', seasonId], enabled: !!seasonId, ...long, queryFn: async () => must(await supabase.from('season_scorer_snapshots').select('club_id,raw_player_name,goals,player_id').eq('season_id', seasonId!).order('goals', { ascending: false })) as { club_id: number; raw_player_name: string; goals: number; player_id: number | null }[] })
export const useAwards = (seasonId?: number) => useQuery({ queryKey: ['awards', seasonId], enabled: !!seasonId, ...long, queryFn: async () => must(await supabase.from('awards').select('category,label,club_id,votes,value').eq('season_id', seasonId!)) as { category: string; label: string; club_id: number | null; votes: number | null; value: number | null }[] })

export function useStandings(season?: Season) {
  return useQuery({
    queryKey: ['standings', season?.id],
    enabled: !!season,
    queryFn: async (): Promise<Row[]> => {
      if (season!.status === 'closed') {
        const rows = must(await supabase.from('season_table_snapshots').select('*').eq('season_id', season!.id).order('position')) as Omit<Row, 'goal_diff'>[]
        return rows.map((r) => ({ ...r, goal_diff: r.goals_for - r.goals_against }))
      }
      const rows = must(await supabase.rpc('season_standings', { p_season: season!.id })) as (Omit<Row, 'position'> & { table_position: number })[]
      return rows.map((r) => ({ ...r, position: r.table_position }))
    },
  })
}

export const byId = <T extends { id: number }>(rows: T[] | undefined) => new Map((rows ?? []).map((r) => [r.id, r]))
