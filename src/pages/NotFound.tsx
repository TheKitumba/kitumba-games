import { Link } from 'react-router'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <title>Página não encontrada — Kitumba Games</title>
      <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-rose-300/80 uppercase">Erro 404</div>
      <h1 className="glitch font-display mb-6 text-3xl font-black tracking-widest sm:text-5xl" data-text="SINAL PERDIDO">
        SINAL PERDIDO
      </h1>
      <Link to="/" className="neon-btn font-display px-8 py-3 text-sm font-bold tracking-[0.25em] uppercase">
        Voltar aos jogos
      </Link>
    </main>
  )
}
