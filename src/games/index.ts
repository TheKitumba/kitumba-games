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
]
