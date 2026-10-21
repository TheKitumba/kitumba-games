import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { audio } from './game/audio'
import { SnakeGame, type HudState } from './game/engine'

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
}

const DPAD = [
  { dir: [0, -1], label: '▲', pos: 'col-start-2' },
  { dir: [-1, 0], label: '◀', pos: 'col-start-1 row-start-2' },
  { dir: [1, 0], label: '▶', pos: 'col-start-3 row-start-2' },
  { dir: [0, 1], label: '▼', pos: 'col-start-2 row-start-3' },
] as const

const initialHud: HudState = {
  mode: 'menu',
  score: 0,
  best: 0,
  level: 1,
  length: 4,
  combo: 0,
  wrap: false,
  newBest: false,
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="hud-panel relative flex min-w-0 flex-col px-3 py-2 sm:px-4">
      <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-200/50 uppercase sm:text-[10px]">
        {label}
      </span>
      <span className={`font-display text-lg font-bold tabular-nums sm:text-2xl ${accent}`}>{value}</span>
    </div>
  )
}

function NeonButton({
  children,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'primary' | 'ghost'
}) {
  return (
    <button
      onClick={() => {
        audio.unlock()
        audio.click()
        onClick()
      }}
      className={
        variant === 'primary'
          ? 'neon-btn font-display px-8 py-3 text-sm font-bold tracking-[0.25em] uppercase'
          : 'font-display rounded-md border border-cyan-300/20 bg-white/5 px-4 py-2 text-xs tracking-[0.2em] text-cyan-100/80 uppercase transition hover:border-cyan-300/60 hover:bg-cyan-300/10 hover:text-white'
      }
    >
      {children}
    </button>
  )
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<SnakeGame | null>(null)
  const [hud, setHud] = useState<HudState>(initialHud)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const game = new SnakeGame(canvasRef.current!, setHud)
    gameRef.current = game
    return () => game.destroy()
  }, [])

  const start = useCallback(() => gameRef.current?.start(), [])
  const pause = useCallback(() => gameRef.current?.togglePause(), [])
  const turn = useCallback((x: number, y: number) => gameRef.current?.setDirection(x, y), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.setMuted(!m)
      return !m
    })
  }, [])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEY_DIRS[e.code]
      if (d) {
        e.preventDefault()
        turn(d[0], d[1])
        return
      }
      if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault()
        if (hud.mode === 'menu' || hud.mode === 'over') {
          if (e.code === 'Space') start()
        } else pause()
      } else if (e.code === 'Enter' && (hud.mode === 'menu' || hud.mode === 'over')) {
        start()
      } else if (e.code === 'KeyM') {
        toggleMute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hud.mode, pause, start, toggleMute, turn])

  // Auto-pause when the tab loses focus
  useEffect(() => {
    const onBlur = () => {
      if (hud.mode === 'playing') pause()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [hud.mode, pause])

  // Swipe on the board
  useEffect(() => {
    const el = boardRef.current!
    let sx = 0
    let sy = 0
    const onStart = (e: TouchEvent) => {
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - sx
      const dy = e.touches[0].clientY - sy
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
      e.preventDefault()
      if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0)
      else turn(0, Math.sign(dy))
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [turn])

  // 3D parallax tilt following the pointer
  useEffect(() => {
    const el = boardRef.current!
    let raf = 0
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      ty = (e.clientY / window.innerHeight - 0.5) * 2
    }
    const tick = () => {
      cx += (tx - cx) * 0.06
      cy += (ty - cy) * 0.06
      el.style.transform = `rotateX(${10 - cy * 6}deg) rotateY(${cx * 8}deg)`
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  const multiplier = Math.min(1 + hud.combo, 5)

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03040c] text-white select-none">
      {/* ---------- Background scene ---------- */}
      <div className="stars pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[38%] h-[2px] bg-gradient-to-r from-transparent via-fuchsia-400/70 to-transparent blur-[1px]" />
      <div className="sun pointer-events-none absolute top-[38%] left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="floor-wrap pointer-events-none absolute inset-x-0 top-[38%] bottom-0">
        <div className="floor" />
      </div>
      <div className="scanlines pointer-events-none absolute inset-0 z-50" />

      {/* ---------- Content ---------- */}
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 pt-5 pb-6 sm:pt-8">
        <header className="mb-4 flex w-full items-center justify-between gap-4 sm:mb-6">
          <div>
            <h1
              className="glitch font-display text-2xl font-black tracking-[0.18em] sm:text-4xl"
              data-text="NEON SNAKE"
            >
              NEON SNAKE
            </h1>
            <p className="font-mono text-[10px] tracking-[0.4em] text-cyan-200/40 uppercase">
              Protocolo // 2099
            </p>
          </div>
          <div className="flex gap-2">
            <NeonButton variant="ghost" onClick={toggleMute}>
              {muted ? '🔇 Som' : '🔊 Som'}
            </NeonButton>
            {(hud.mode === 'playing' || hud.mode === 'paused') && (
              <NeonButton variant="ghost" onClick={pause}>
                {hud.mode === 'paused' ? '▶' : '❚❚'}
              </NeonButton>
            )}
          </div>
        </header>

        <section className="mb-4 grid w-full max-w-[600px] grid-cols-4 gap-2 sm:mb-6 sm:gap-3">
          <Stat label="Pontos" value={hud.score.toLocaleString('pt-PT')} accent="text-cyan-300 text-glow-cyan" />
          <Stat label="Recorde" value={hud.best.toLocaleString('pt-PT')} accent="text-fuchsia-300 text-glow-fuchsia" />
          <Stat label="Nível" value={hud.level} accent="text-amber-300" />
          <Stat
            label="Combo"
            value={`x${multiplier}`}
            accent={multiplier > 1 ? 'text-lime-300 animate-pulse' : 'text-white/40'}
          />
        </section>

        {/* ---------- 3D Board ---------- */}
        <div className="w-[min(100%,600px,calc(100dvh-400px))] min-w-65 perspective-[1400px] md:w-[min(100%,600px,calc(100dvh-230px))]">
          <div ref={boardRef} className="board-3d relative aspect-square w-full [transform-style:preserve-3d]">
            {/* depth layers behind the board */}
            <div className="absolute inset-0 rounded-xl bg-fuchsia-500/20 blur-2xl [transform:translateZ(-80px)]" />
            <div className="absolute inset-0 rounded-xl border border-cyan-400/20 [transform:translateZ(-30px)]" />
            <div className="absolute inset-0 rounded-xl border border-fuchsia-400/20 [transform:translateZ(-15px)]" />

            <div className="board-frame absolute inset-0 overflow-hidden rounded-xl">
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="Tabuleiro do jogo da cobrinha"
                className="block h-full w-full touch-none"
              />
            </div>

            {/* Corner brackets float in front for parallax */}
            {['top-0 left-0 border-t-2 border-l-2', 'top-0 right-0 border-t-2 border-r-2',
              'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map((cls) => (
              <span
                key={cls}
                className={`pointer-events-none absolute h-8 w-8 border-cyan-300 drop-shadow-[0_0_6px_#22d3ee] ${cls} [transform:translateZ(40px)]`}
                style={{ margin: -10 }}
              />
            ))}

            {/* ---------- Overlays ---------- */}
            {hud.mode !== 'playing' && (
              <div className="overlay-in absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-[#03040c]/70 p-6 text-center backdrop-blur-sm [transform:translateZ(60px)]">
                {hud.mode === 'menu' && (
                  <>
                    <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
                      Sistema pronto
                    </div>
                    <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-glow-cyan sm:text-5xl">
                      INICIAR
                    </h2>
                    <div className="mb-6 flex gap-2">
                      {[false, true].map((w) => (
                        <button
                          key={String(w)}
                          onClick={() => {
                            audio.unlock()
                            audio.click()
                            gameRef.current?.setWrap(w)
                          }}
                          className={`font-display rounded-md border px-3 py-2 text-[11px] tracking-[0.2em] uppercase transition ${
                            hud.wrap === w
                              ? 'border-cyan-300 bg-cyan-300/15 text-white shadow-[0_0_16px_rgba(34,211,238,0.5)]'
                              : 'border-white/10 text-white/50 hover:border-white/30'
                          }`}
                        >
                          {w ? '◎ Portal' : '▣ Paredes'}
                        </button>
                      ))}
                    </div>
                    <NeonButton onClick={start}>Jogar</NeonButton>
                    <Controls />
                  </>
                )}

                {hud.mode === 'paused' && (
                  <>
                    <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-amber-200 sm:text-5xl">
                      PAUSA
                    </h2>
                    <NeonButton onClick={pause}>Continuar</NeonButton>
                    <p className="mt-4 font-mono text-[11px] tracking-widest text-white/40">
                      ESPAÇO / P PARA RETOMAR
                    </p>
                  </>
                )}

                {hud.mode === 'over' && (
                  <div className="overlay-in-delayed flex flex-col items-center">
                    <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-rose-300/80 uppercase">
                      Ligação perdida
                    </div>
                    <h2
                      className="glitch font-display mb-4 text-3xl font-black tracking-widest text-rose-300 sm:text-5xl"
                      data-text="GAME OVER"
                    >
                      GAME OVER
                    </h2>
                    <div className="mb-1 font-display text-4xl font-bold text-cyan-200 tabular-nums text-glow-cyan">
                      {hud.score.toLocaleString('pt-PT')}
                    </div>
                    <div className="mb-6 font-mono text-xs tracking-widest text-white/50">
                      {hud.newBest ? (
                        <span className="animate-pulse text-amber-300">★ NOVO RECORDE ★</span>
                      ) : (
                        <>RECORDE {hud.best.toLocaleString('pt-PT')}</>
                      )}
                      <span className="mx-2">·</span>NÍVEL {hud.level}
                      <span className="mx-2">·</span>TAMANHO {hud.length}
                    </div>
                    <NeonButton onClick={start}>Reiniciar</NeonButton>
                    <button
                      onClick={() => {
                        audio.click()
                        gameRef.current?.setWrap(!hud.wrap)
                      }}
                      className="mt-4 font-mono text-[11px] tracking-widest text-white/40 uppercase hover:text-white"
                    >
                      Modo: {hud.wrap ? 'Portal' : 'Paredes'} (trocar)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---------- Mobile D-pad ---------- */}
        <div className="mt-8 grid grid-cols-3 gap-2 md:hidden">
          {DPAD.map(({ dir, label, pos }) => (
            <button
              key={label}
              onPointerDown={(e) => {
                e.preventDefault()
                audio.unlock()
                turn(dir[0], dir[1])
              }}
              className={`${pos} dpad-btn font-display flex h-16 w-16 items-center justify-center rounded-xl text-xl text-cyan-200`}
            >
              {label}
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}

function Controls() {
  return (
    <div className="mt-8 hidden grid-cols-2 gap-x-6 gap-y-1 text-left font-mono text-[11px] tracking-wider text-white/45 sm:grid">
      <span className="text-cyan-200/80">← ↑ → ↓ / WASD</span>
      <span>mover</span>
      <span className="text-cyan-200/80">ESPAÇO / P</span>
      <span>pausa</span>
      <span className="text-cyan-200/80">M</span>
      <span>som</span>
      <span className="text-fuchsia-300/80">◆ dourado</span>
      <span>bónus +3, expira</span>
      <span className="text-lime-300/80">combo</span>
      <span>come rápido: até x5</span>
    </div>
  )
}
