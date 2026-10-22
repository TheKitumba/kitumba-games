import { Link } from 'react-router'
import { games } from '../games'

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pt-10 pb-10 sm:pt-16">
      <title>Kitumba Games — Jogos Neon no Browser</title>
      <header className="mb-10 text-center sm:mb-14">
        <div className="mb-3 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
          Arcade // Browser
        </div>
        <h1
          className="glitch font-display text-4xl font-black tracking-[0.18em] sm:text-6xl"
          data-text="KITUMBA GAMES"
        >
          KITUMBA GAMES
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-cyan-100/60">
          Jogos rápidos, grátis e sem instalação. Escolhe um e começa a jogar.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <Link
            key={game.slug}
            to={`/${game.slug}`}
            className="hud-panel group relative flex flex-col gap-3 p-5 transition hover:-translate-y-1 hover:bg-cyan-300/10"
          >
            <div className={`h-1 w-16 bg-gradient-to-r ${game.accent} shadow-[0_0_12px_rgba(34,211,238,0.6)]`} />
            <div>
              <h2 className="font-display text-xl font-bold tracking-widest text-white group-hover:text-glow-cyan">
                {game.title}
              </h2>
              <p className="font-mono text-[10px] tracking-[0.3em] text-cyan-200/40 uppercase">{game.tagline}</p>
            </div>
            <p className="text-sm leading-relaxed text-white/60">{game.description}</p>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
              {game.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-white/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-white/50 uppercase"
                >
                  {tag}
                </span>
              ))}
              <span className="font-display ml-auto text-xs tracking-[0.25em] text-cyan-300 uppercase">Jogar →</span>
            </div>
          </Link>
        ))}
      </section>

      <footer className="mt-auto pt-12 text-center font-mono text-[10px] tracking-[0.4em] text-white/30 uppercase">
        Mais jogos em breve
      </footer>
    </main>
  )
}
