import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { audio } from './audio'
import { FootballGame, type Action, type HudState } from './engine'

const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
}
const ACTION_KEYS: Record<string, Action> = {
  Space: 'pass',
  KeyJ: 'pass',
  KeyK: 'shoot',
  KeyX: 'shoot',
  KeyL: 'through',
  KeyC: 'through',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
}

const initialHud: HudState = {
  mode: 'menu',
  home: 0,
  away: 0,
  minute: 0,
  level: 1,
  streak: 0,
  best: 0,
  result: null,
  newBest: false,
  attacking: true,
  possession: 50,
}

const RESULT_TEXT = {
  win: { label: 'Vitória', title: 'VITÓRIA', color: 'text-lime-300' },
  draw: { label: 'Apito final', title: 'EMPATE', color: 'text-amber-200' },
  loss: { label: 'Apito final', title: 'DERROTA', color: 'text-rose-300' },
} as const

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

export default function FootballPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<FootballGame | null>(null)
  const [hud, setHud] = useState<HudState>(initialHud)
  const [muted, setMuted] = useState(audio.muted)

  useEffect(() => {
    const game = new FootballGame(canvasRef.current!, overlayRef.current!, setHud)
    gameRef.current = game
    return () => game.destroy()
  }, [])

  const start = useCallback(() => gameRef.current?.start(), [])
  const pause = useCallback(() => gameRef.current?.togglePause(), [])
  const act = useCallback((a: Action, down: boolean) => gameRef.current?.press(a, down), [])
  const move = useCallback((x: number, y: number) => gameRef.current?.setInput(x, y), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.setMuted(!m)
      return !m
    })
  }, [])

  // Keyboard: held direction keys add up to a movement vector
  useEffect(() => {
    const held = new Set<string>()
    const sync = () => {
      let x = 0
      let y = 0
      for (const code of held) {
        x += MOVE_KEYS[code][0]
        y += MOVE_KEYS[code][1]
      }
      move(x, y)
    }
    const onDown = (e: KeyboardEvent) => {
      const idle = hud.mode === 'menu' || hud.mode === 'over'
      if (e.code in MOVE_KEYS) {
        e.preventDefault()
        held.add(e.code)
        sync()
      } else if (e.code in ACTION_KEYS) {
        e.preventDefault()
        if (e.repeat) return
        if (idle) {
          if (e.code === 'Space') start()
        } else if (hud.mode === 'playing') act(ACTION_KEYS[e.code], true)
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault()
        if (!idle) pause()
      } else if (e.code === 'Enter' && idle) {
        start()
      } else if (e.code === 'KeyM') {
        toggleMute()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (held.delete(e.code)) sync()
      else if (e.code in ACTION_KEYS) act(ACTION_KEYS[e.code], false)
    }
    const onBlur = () => {
      held.clear()
      sync()
      for (const a of new Set(Object.values(ACTION_KEYS))) act(a, false)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      move(0, 0)
    }
  }, [hud.mode, act, move, pause, start, toggleMute])

  // Auto-pause when the tab loses focus
  useEffect(() => {
    const onBlur = () => {
      if (hud.mode === 'playing') pause()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [hud.mode, pause])

  const result = hud.result ? RESULT_TEXT[hud.result] : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 pt-5 pb-6 sm:pt-8">
      <title>Kitumba Football — Kitumba Games</title>
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
            data-text="KITUMBA FOOTBALL"
          >
            KITUMBA FOOTBALL
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
        <Stat
          label="Golos"
          value={`${hud.home} - ${hud.away}`}
          accent={hud.home >= hud.away ? 'text-cyan-300 text-glow-cyan' : 'text-fuchsia-300 text-glow-fuchsia'}
        />
        <Stat label="Minuto" value={`${hud.minute}'`} accent={hud.minute >= 80 ? 'text-rose-300' : 'text-white/70'} />
        <Stat label="Divisão" value={hud.level} accent="text-amber-300" />
        <Stat label="Recorde" value={hud.best} accent="text-fuchsia-300 text-glow-fuchsia" />
      </section>

      {/* ---------- Pitch ---------- */}
      <div className="w-[min(100%,480px,calc((100dvh-440px)*0.75))] min-w-60 md:w-[min(100%,480px,calc((100dvh-230px)*0.75))]">
        <div className="relative aspect-[3/4] w-full">
          <div className="absolute inset-0 rounded-xl bg-cyan-500/20 blur-2xl" />
          <div className="board-frame absolute inset-0 overflow-hidden rounded-xl">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Estádio com as duas equipas de onze jogadores"
              className="block h-full w-full touch-none"
            />
            <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>

          {/* ---------- Overlays ---------- */}
          {hud.mode !== 'playing' && (
            <div className="overlay-in absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-[#03040c]/70 p-6 text-center backdrop-blur-sm">
              {hud.mode === 'menu' && (
                <>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
                    Estádio cheio
                  </div>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-glow-cyan sm:text-5xl">
                    11 CONTRA 11
                  </h2>
                  <NeonButton onClick={start}>Apito inicial</NeonButton>
                  <Controls />
                </>
              )}

              {hud.mode === 'paused' && (
                <>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-amber-200 sm:text-5xl">
                    PAUSA
                  </h2>
                  <NeonButton onClick={pause}>Continuar</NeonButton>
                  <p className="mt-4 font-mono text-[11px] tracking-widest text-white/40">P / ESC PARA RETOMAR</p>
                </>
              )}

              {hud.mode === 'over' && result && (
                <div className="overlay-in-delayed flex flex-col items-center">
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
                    {result.label}
                  </div>
                  <h2
                    className={`glitch font-display mb-4 text-3xl font-black tracking-widest sm:text-5xl ${result.color}`}
                    data-text={result.title}
                  >
                    {result.title}
                  </h2>
                  <div className="mb-1 font-display text-4xl font-bold text-cyan-200 tabular-nums text-glow-cyan">
                    {hud.home} - {hud.away}
                  </div>
                  <div className="mb-3 font-mono text-[11px] tracking-widest text-white/50">
                    POSSE DE BOLA {hud.possession}% - {100 - hud.possession}%
                  </div>
                  <div className="mb-6 font-mono text-xs tracking-widest text-white/50">
                    {hud.newBest ? (
                      <span className="animate-pulse text-amber-300">★ NOVO RECORDE: {hud.best} SEGUIDAS ★</span>
                    ) : (
                      <>
                        {hud.streak} {hud.streak === 1 ? 'VITÓRIA SEGUIDA' : 'VITÓRIAS SEGUIDAS'}
                      </>
                    )}
                    <span className="mx-2">·</span>
                    {hud.result === 'win' ? `SOBES À DIVISÃO ${hud.level}` : `DIVISÃO ${hud.level}`}
                  </div>
                  <NeonButton onClick={start}>{hud.result === 'loss' ? 'Recomeçar' : 'Próximo jogo'}</NeonButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Mobile controls ---------- */}
      <div className="mt-6 flex w-full max-w-[480px] items-center justify-between px-1 md:hidden">
        <Joystick onMove={move} />
        <div className="relative h-40 w-52 shrink-0">
          <PadButton action="sprint" onAct={act} className="bottom-0 left-0 h-14 w-14 text-lime-200">
            SPRINT
          </PadButton>
          <PadButton action="pass" onAct={act} className="bottom-1 left-16 h-16 w-16 text-cyan-200">
            {hud.attacking ? 'PASSE' : 'TROCAR'}
          </PadButton>
          <PadButton action="shoot" onAct={act} className="right-0 bottom-10 h-20 w-20 text-amber-200">
            {hud.attacking ? 'REMATE' : 'CARRINHO'}
          </PadButton>
          <PadButton action="through" onAct={act} className="top-0 left-12 h-16 w-16 text-fuchsia-200">
            {hud.attacking ? 'EM PROF.' : 'PRESSÃO'}
          </PadButton>
        </div>
      </div>
    </main>
  )
}

/** A round action button that reports both press and release (shots charge while held). */
function PadButton({
  action,
  onAct,
  className,
  children,
}: {
  action: Action
  onAct: (a: Action, down: boolean) => void
  className: string
  children: ReactNode
}) {
  const up = () => onAct(action, false)
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        audio.unlock()
        onAct(action, true)
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      className={`dpad-btn font-display absolute flex items-center justify-center rounded-full text-[9px] font-bold tracking-wider select-none ${className}`}
    >
      {children}
    </button>
  )
}

/** Drag inside the pad to run in that direction; release to stop. */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })

  const update = (e: PointerEvent) => {
    const rect = padRef.current!.getBoundingClientRect()
    const r = rect.width / 2
    let x = (e.clientX - rect.left - r) / r
    let y = (e.clientY - rect.top - r) / r
    const d = Math.hypot(x, y)
    if (d > 1) {
      x /= d
      y /= d
    }
    // Small dead zone so a resting thumb doesn't drift
    const live = d > 0.18
    setKnob({ x, y })
    onMove(live ? x : 0, live ? y : 0)
  }

  const release = () => {
    setKnob({ x: 0, y: 0 })
    onMove(0, 0)
  }

  return (
    <div
      ref={padRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        audio.unlock()
        update(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      className="dpad-btn relative h-32 w-32 rounded-full"
    >
      <div
        className="absolute top-1/2 left-1/2 h-12 w-12 rounded-full border border-cyan-200/70 bg-cyan-300/30 shadow-[0_0_18px_rgba(34,211,238,0.7)]"
        style={{ transform: `translate(calc(-50% + ${knob.x * 40}px), calc(-50% + ${knob.y * 40}px))` }}
      />
    </div>
  )
}

function Controls() {
  return (
    <div className="mt-8 hidden grid-cols-2 gap-x-6 gap-y-1 text-left font-mono text-[11px] tracking-wider text-white/45 sm:grid">
      <span className="text-cyan-200/80">↑ ↓ ← → / WASD</span>
      <span>correr e conduzir</span>
      <span className="text-cyan-200/80">SHIFT</span>
      <span>sprint (gasta energia)</span>
      <span className="text-cyan-200/80">ESPAÇO / J</span>
      <span>passe · trocar jogador</span>
      <span className="text-cyan-200/80">K (manter)</span>
      <span>remate · carrinho</span>
      <span className="text-cyan-200/80">L</span>
      <span>passe em profundidade · pressão</span>
      <span className="text-cyan-200/80">P / ESC</span>
      <span>pausa</span>
      <span className="text-cyan-200/80">M</span>
      <span>som</span>
      <span className="text-fuchsia-300/80">baliza do fundo</span>
      <span>é onde marcas</span>
    </div>
  )
}
