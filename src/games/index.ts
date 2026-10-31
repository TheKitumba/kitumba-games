import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface GameEntry {
  /** URL segment: the game lives at `/<slug>` */
  slug: string
  title: string
  tagline: string
  description: string
  /** Tailwind classes for the card's accent colour */
  accent: string
  tags: string[]
  /** Loaded on demand so each game ships in its own chunk */
  Component: LazyExoticComponent<ComponentType>
}

// Every game in Kitumba Games. Adding an entry here adds its route and its card in the hub.
export const games: GameEntry[] = [
  {
    slug: 'snake',
    title: 'Kitumba Snake',
    tagline: 'Protocolo // 2099',
    description:
      'O clássico jogo da cobrinha com visual neon: combos até x5, bónus dourado, níveis cada vez mais rápidos e música synthwave.',
    accent: 'from-cyan-400 to-fuchsia-500',
    tags: ['Arcade', 'Teclado', 'Tátil'],
    Component: lazy(() => import('./snake/SnakePage')),
  },
  {
    slug: 'racer',
    title: 'Kitumba Racer',
    tagline: 'Autoestrada // Neon',
    description:
      'Corrida numa autoestrada neon: muda de faixa para fugir ao trânsito, usa o turbo, apanha diamantes e passa rente aos carros para ganhar pontos.',
    accent: 'from-amber-300 to-rose-500',
    tags: ['Corrida', 'Teclado', 'Tátil'],
    Component: lazy(() => import('./racer/RacerPage')),
  },
  {
    slug: 'football',
    title: 'Kitumba Football',
    tagline: 'Estádio // Neon',
    description:
      'Futebol arcade visto de cima contra o CPU: dribla, chuta, passa pelo guarda-redes e sobe de divisão a cada vitória.',
    accent: 'from-lime-300 to-cyan-500',
    tags: ['Desporto', 'Teclado', 'Tátil'],
    Component: lazy(() => import('./football/FootballPage')),
  },
  {
    slug: 'blaster',
    title: 'Kitumba Blaster',
    tagline: 'Arena // 3D',
    description:
      'Tiros numa arena 3D em Three.js: sobrevive a ondas de drones, investidas e atiradores, faz combos até x8 e usa o dash para escapar.',
    accent: 'from-violet-400 to-cyan-400',
    tags: ['Tiros', '3D', 'Teclado', 'Rato', 'Tátil'],
    Component: lazy(() => import('./blaster/BlasterPage')),
  },
]
