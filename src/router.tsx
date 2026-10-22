import { createBrowserRouter } from 'react-router'
import Layout from './components/Layout'
import { games } from './games'
import Home from './pages/Home'
import NotFound from './pages/NotFound'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      ...games.map(({ slug, Component }) => ({ path: slug, element: <Component /> })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
