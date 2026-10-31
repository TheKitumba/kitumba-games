import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { audio } from './audio'
import { RacerGame, VEHICLE_KINDS, VEHICLES, type HudState, type VehicleKind } from './engine'

const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const BOOST_KEYS = ['ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight']
const VEHICLE_KEYS = ['Digit1', 'Digit2', 'Digit3']

const VEHICLE_INFO: Record<VehicleKind, { icon: string; trait: string }> = {
  car: { icon: '🚗', trait: 'Equilibrado' },
  moto: { icon: '🏍️', trait: 'Estreita e ágil' },
  truck: { icon: '🚚', trait: 'Lento e enorme' },
}

const initialHud: HudState = {
  mode: 'menu',
  vehicle: 'car',
  score: 0,
  best: 0,
  level: 1,
  kmh: 90,
  boosting: false,
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

export default function RacerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<RacerGame | null>(null)
  const [hud, setHud] = useState<HudState>(initialHud)
  const [muted, setMuted] = useState(audio.muted)

  useEffect(() => {
    const game = new RacerGame(canvasRef.current!, setHud)
    gameRef.current = game
    return () => game.destroy()
  }, [])

  const start = useCallback(() => gameRef.current?.start(), [])
  const pause = useCallback(() => gameRef.current?.togglePause(), [])
  const steer = useCallback((dir: -1 | 1) => gameRef.current?.steer(dir), [])
  const boost = useCallback((on: boolean) => gameRef.current?.setBoost(on), [])
  const chooseVehicle = useCallback((kind: VehicleKind) => gameRef.current?.setVehicle(kind), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.setMuted(!m)
      return !m
    })
  }, [])

  // Keyboard
  useEffect(() => {
    const choosing = hud.mode === 'menu' || hud.mode === 'over'
    const onDown = (e: KeyboardEvent) => {
      if (LEFT_KEYS.includes(e.code) || RIGHT_KEYS.includes(e.code)) {
        e.preventDefault()
        if (e.repeat) return
        const dir = LEFT_KEYS.includes(e.code) ? -1 : 1
        if (choosing) {
          // Between runs the arrows cycle through the vehicles
          const i = VEHICLE_KINDS.indexOf(hud.vehicle)
          chooseVehicle(VEHICLE_KINDS[(i + dir + VEHICLE_KINDS.length) % VEHICLE_KINDS.length])
          audio.unlock()
          audio.click()
        } else steer(dir)
      } else if (choosing && VEHICLE_KEYS.includes(e.code)) {
        chooseVehicle(VEHICLE_KINDS[VEHICLE_KEYS.indexOf(e.code)])
        audio.unlock()
        audio.click()
      } else if (BOOST_KEYS.includes(e.code)) {
        e.preventDefault()
        boost(true)
      } else if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
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
    const onUp = (e: KeyboardEvent) => {
      if (BOOST_KEYS.includes(e.code)) boost(false)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [boost, chooseVehicle, hud.mode, hud.vehicle, pause, start, steer, toggleMute])

  // Auto-pause when the tab loses focus
  useEffect(() => {
    const onBlur = () => {
      if (hud.mode === 'playing') pause()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [hud.mode, pause])

  // Swipe left/right on the road to change lane
  useEffect(() => {
    const el = boardRef.current!
    let sx = 0
    const onStart = (e: TouchEvent) => {
      sx = e.touches[0].clientX
    }
    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - sx
      if (Math.abs(dx) < 24) return
      e.preventDefault()
      steer(dx > 0 ? 1 : -1)
      sx = e.touches[0].clientX
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [steer])

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 pt-5 pb-6 sm:pt-8">
      <title>Kitumba Racer — Kitumba Games</title>
      <header className="mb-4 flex w-full items-center justify-between gap-4 sm:mb-6">
        <div>
          <Link
            to="/"
            className="font-mono text-[10px] tracking-[0.4em] text-cyan-200/50 uppercase transition hover:text-white"
          >
            ← Kitumba Games
          </Link>
          <h1
            className="glitch font-display text-2xl font-black tracking-[0.18em] sm:text-4xl"
            data-text="KITUMBA RACER"
          >
            KITUMBA RACER
          </h1>
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
          label="km/h"
          value={hud.kmh}
          accent={hud.boosting ? 'text-lime-300 animate-pulse' : 'text-white/70'}
        />
      </section>

      {/* ---------- Road ---------- */}
      <div className="w-[min(100%,440px,calc((100dvh-400px)*0.75))] min-w-60 perspective-[1200px] md:w-[min(100%,440px,calc((100dvh-230px)*0.75))]">
        <div
          ref={boardRef}
          className="relative aspect-[3/4] w-full [transform-style:preserve-3d] [transform:rotateX(14deg)]"
        >
          <div className="absolute inset-0 rounded-xl bg-fuchsia-500/20 blur-2xl [transform:translateZ(-80px)]" />
          <div className="board-frame absolute inset-0 overflow-hidden rounded-xl">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Estrada do jogo de carros"
              className="block h-full w-full touch-none"
            />
          </div>

          {/* ---------- Overlays ---------- */}
          {hud.mode !== 'playing' && (
            <div className="overlay-in absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-[#03040c]/70 p-6 text-center backdrop-blur-sm [transform:translateZ(60px)]">
              {hud.mode === 'menu' && (
                <>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
                    Motor pronto
                  </div>
                  <h2 className="font-display mb-5 text-3xl font-black tracking-widest text-glow-cyan sm:text-5xl">
                    ACELERAR
                  </h2>
                  <VehiclePicker value={hud.vehicle} onChange={chooseVehicle} />
                  <NeonButton onClick={start}>Arrancar</NeonButton>
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
                    Colisão
                  </div>
                  <h2
                    className="glitch font-display mb-4 text-3xl font-black tracking-widest text-rose-300 sm:text-5xl"
                    data-text="DESTRUÍDO"
                  >
                    DESTRUÍDO
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
                  </div>
                  <VehiclePicker value={hud.vehicle} onChange={chooseVehicle} compact />
                  <NeonButton onClick={start}>Reiniciar</NeonButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Mobile controls ---------- */}
      <div className="mt-8 grid grid-cols-3 gap-3 md:hidden">
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            audio.unlock()
            steer(-1)
          }}
          className="dpad-btn font-display flex h-16 w-16 items-center justify-center rounded-xl text-xl text-cyan-200"
        >
          ◀
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            audio.unlock()
            boost(true)
          }}
          onPointerUp={() => boost(false)}
          onPointerLeave={() => boost(false)}
          onPointerCancel={() => boost(false)}
          className="dpad-btn font-display flex h-16 w-16 items-center justify-center rounded-xl text-xl text-amber-200"
        >
          ⚡
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            audio.unlock()
            steer(1)
          }}
          className="dpad-btn font-display flex h-16 w-16 items-center justify-center rounded-xl text-xl text-cyan-200"
        >
          ▶
        </button>
      </div>
    </main>
  )
}

function VehiclePicker({
  value,
  onChange,
  compact = false,
}: {
  value: VehicleKind
  onChange: (kind: VehicleKind) => void
  compact?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Escolher veículo" className="mb-6 grid w-full max-w-xs grid-cols-3 gap-2">
      {VEHICLE_KINDS.map((kind) => {
        const spec = VEHICLES[kind]
        const active = kind === value
        return (
          <button
            key={kind}
            role="radio"
            aria-checked={active}
            onClick={() => {
              audio.unlock()
              audio.click()
              onChange(kind)
            }}
            className={`flex flex-col items-center rounded-lg border px-1 transition ${compact ? 'py-1.5' : 'py-2.5'} ${
              active
                ? 'border-cyan-300/80 bg-cyan-300/15 text-white shadow-[0_0_18px_rgba(103,232,249,0.35)]'
                : 'border-white/10 bg-white/5 text-white/60 hover:border-cyan-300/40 hover:text-white'
            }`}
          >
            <span className={compact ? 'text-xl' : 'text-2xl sm:text-3xl'} aria-hidden>
              {VEHICLE_INFO[kind].icon}
            </span>
            <span className="font-display mt-1 text-[10px] font-bold tracking-[0.2em] uppercase sm:text-xs">
              {spec.name}
            </span>
            {!compact && (
              <>
                <span className="mt-1 font-mono text-[9px] leading-tight tracking-wide text-white/45">
                  {VEHICLE_INFO[kind].trait}
                </span>
                <span className="mt-0.5 font-mono text-[9px] tracking-wide text-amber-300/80">
                  pontos ×{spec.points.toLocaleString('pt-PT')}
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

function Controls() {
  return (
    <div className="mt-8 hidden grid-cols-2 gap-x-6 gap-y-1 text-left font-mono text-[11px] tracking-wider text-white/45 sm:grid">
      <span className="text-cyan-200/80">1 2 3</span>
      <span>escolher veículo</span>
      <span className="text-cyan-200/80">← → / A D</span>
      <span>mudar de faixa</span>
      <span className="text-cyan-200/80">↑ / W / SHIFT</span>
      <span>turbo (pontos x2)</span>
      <span className="text-cyan-200/80">ESPAÇO / P</span>
      <span>pausa</span>
      <span className="text-cyan-200/80">M</span>
      <span>som</span>
      <span className="text-amber-300/80">◆ dourado</span>
      <span>+50 × nível</span>
      <span className="text-lime-300/80">raspão</span>
      <span>passar rente: +25 × nível</span>
    </div>
  )
}
