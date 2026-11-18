import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Loading } from './components/ui'
import { Home } from './pages/Home'

const p = <K extends string>(load: () => Promise<Record<K, () => React.ReactElement>>, key: K) => lazy(async () => ({ default: (await load())[key] }))
const competition = () => import('./pages/Competition')
const clubs = () => import('./pages/Clubs')
const players = () => import('./pages/Players')
const history = () => import('./pages/History')
const portal = () => import('./pages/Portal')
const Division = p(competition, 'Division'); const Fixture = p(competition, 'Fixture'); const MatchPage = p(competition, 'MatchPage'); const Standings = p(competition, 'Standings')
const ClubsPage = p(clubs, 'ClubsPage'); const ClubPage = p(clubs, 'ClubPage'); const Coaches = p(clubs, 'Coaches'); const CoachPage = p(clubs, 'CoachPage')
const PlayersPage = p(players, 'PlayersPage'); const PlayerPage = p(players, 'PlayerPage'); const Squads = p(() => import('./pages/Squads'), 'Squads')
const Champions = p(history, 'Champions'); const Seasons = p(history, 'Seasons'); const SeasonPage = p(history, 'SeasonPage'); const Records = p(history, 'Records')
const Market = p(() => import('./pages/TransferMarket'), 'Market'); const News = p(portal, 'News'); const Rules = p(portal, 'Rules'); const Admin = p(() => import('./pages/Admin'), 'Admin'); const Login = p(portal, 'Login'); const NotFound = p(portal, 'NotFound')

export function App() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="primera-division" element={<Division />} />
          <Route path="fixture" element={<Fixture />} />
          <Route path="partidos/:id" element={<MatchPage />} />
          <Route path="tabla" element={<Standings />} />
          <Route path="clubes" element={<ClubsPage />} />
          <Route path="clubes/:slug" element={<ClubPage />} />
          <Route path="jugadores" element={<PlayersPage />} />
          <Route path="jugadores/:id" element={<PlayerPage />} />
          <Route path="plantillas" element={<Squads />} />
          <Route path="mercado" element={<Market />} />
          <Route path="campeones" element={<Champions />} />
          <Route path="temporadas" element={<Seasons />} />
          <Route path="temporadas/:number" element={<SeasonPage />} />
          <Route path="directores-tecnicos" element={<Coaches />} />
          <Route path="directores-tecnicos/:id" element={<CoachPage />} />
          <Route path="records" element={<Records />} />
          <Route path="noticias" element={<News />} />
          <Route path="reglamento" element={<Rules />} />
          <Route path="administracion" element={<Admin />} />
          <Route path="ingresar" element={<Login />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}
