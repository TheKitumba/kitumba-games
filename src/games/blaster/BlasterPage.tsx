import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { audio } from './audio'
import { BlasterGame, type HudState, type QualityLevel, type QualityPref } from './engine'

// key code → [x, z] contribution; z grows toward the bottom of the screen
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
}
const AIM_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}
const DASH_KEYS = ['Space', 'ShiftLeft', 'ShiftRight']

const QUALITY_PREFS: QualityPref[] = ['auto', 'high', 'low']
const QUALITY_LABEL: Record<QualityPref, string> = { auto: 'Auto', high: 'Alto', low: 'Baixo' }
const LEVEL_LABEL: Record<QualityLevel, string> = { 2: 'bloom HD', 1: 'bloom', 0: 'sem bloom' }

const initialHud: HudState = {
  mode: 'menu',
  score: 0,
  best: 0,
  wave: 0,
  hp: 3,
  maxHp: 5,
  combo: 1,
  power: null,
  shield: false,
  dashReady: true,
  banner: null,
  kills: 0,
  newBest: false,
  quality: 'auto',
  qualityLevel: 2,
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

export default function BlasterPage() {
  const boardRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<BlasterGame | null>(null)
  const [hud, setHud] = useState<HudState>(initialHud)
  const [muted, setMuted] = useState(audio.muted)

  useEffect(() => {
    const game = new BlasterGame(boardRef.current!, setHud)
    gameRef.current = game
    return () => game.destroy()
  }, [])

  const start = useCallback(() => gameRef.current?.start(), [])
  const pause = useCallback(() => gameRef.current?.togglePause(), [])
  const dash = useCallback(() => gameRef.current?.dash(), [])
  const setQuality = useCallback((q: QualityPref) => gameRef.current?.setQuality(q), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.setMuted(!m)
      return !m
    })
  }, [])

  // Keyboard: WASD moves, arrows aim and fire, so the game plays without a mouse too
  useEffect(() => {
    const held = new Set<string>()
    const sync = () => {
      const sum = (map: Record<string, [number, number]>) => {
        let x = 0
        let z = 0
        for (const code of held) {
          const v = map[code]
          if (v) {
            x += v[0]
            z += v[1]
          }
        }
        return [x, z] as const
      }
      gameRef.current?.setMove(...sum(MOVE_KEYS))
      gameRef.current?.setAim(...sum(AIM_KEYS))
    }
    const onDown = (e: KeyboardEvent) => {
      const idle = hud.mode === 'menu' || hud.mode === 'over'
      if (e.code in MOVE_KEYS || e.code in AIM_KEYS) {
        e.preventDefault()
        held.add(e.code)
        sync()
      } else if (DASH_KEYS.includes(e.code)) {
        e.preventDefault()
        if (idle && e.code === 'Space') start()
        else if (!e.repeat) dash()
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault()
        pause()
      } else if (e.code === 'Enter' && idle) {
        start()
      } else if (e.code === 'KeyM') {
        toggleMute()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (held.delete(e.code)) sync()
    }
    // Keys released while the window is unfocused never fire keyup
    const onBlur = () => {
      held.clear()
      sync()
      if (hud.mode === 'playing') pause()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [dash, hud.mode, pause, start, toggleMute])

  // Mouse: aim at the cursor, hold the button to fire
  useEffect(() => {
    const el = boardRef.current!
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') gameRef.current?.setPointer(e.clientX, e.clientY)
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      audio.unlock()
      gameRef.current?.setPointer(e.clientX, e.clientY)
      gameRef.current?.setTrigger(true)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') gameRef.current?.setTrigger(false)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const hearts = Array.from({ length: hud.maxHp }, (_, i) => i < hud.hp)

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 pt-5 pb-6 sm:pt-8">
      <title>Kitumba Blaster — Kitumba Games</title>
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
            data-text="KITUMBA BLASTER"
          >
            KITUMBA BLASTER
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

      <section className="mb-4 grid w-full max-w-[880px] grid-cols-4 gap-2 sm:mb-6 sm:gap-3">
        <Stat label="Pontos" value={hud.score.toLocaleString('pt-PT')} accent="text-cyan-300 text-glow-cyan" />
        <Stat label="Recorde" value={hud.best.toLocaleString('pt-PT')} accent="text-fuchsia-300 text-glow-fuchsia" />
        <Stat label="Onda" value={hud.wave || '—'} accent="text-amber-300" />
        <Stat
          label="Combo"
          value={`×${hud.combo}`}
          accent={hud.combo > 1 ? 'text-lime-300 animate-pulse' : 'text-white/70'}
        />
      </section>

      {/* ---------- Arena: the engine prepends its own <canvas> here ---------- */}
      <div className="w-[min(100%,calc((100dvh-300px)*1.33))] min-w-60 sm:w-[min(100%,880px,calc((100dvh-250px)*1.6))]">
        <div
          ref={boardRef}
          className="board-frame relative aspect-[4/3] w-full touch-none overflow-hidden rounded-xl sm:aspect-[16/10]"
        >
          {/* ---------- In-game HUD ---------- */}
          {(hud.mode === 'playing' || hud.mode === 'paused') && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex items-start justify-between p-3">
              <div className="flex gap-1 text-lg sm:text-xl" aria-label={`Vida ${hud.hp} de ${hud.maxHp}`}>
                {hearts.map((full, i) => (
                  <span key={i} className={full ? 'text-rose-400 drop-shadow-[0_0_6px_#fb7185]' : 'text-white/15'}>
                    ♥
                  </span>
                ))}
              </div>
              <div className="flex flex-col items-end gap-1 font-mono text-[10px] tracking-[0.25em] uppercase">
                {hud.shield && <span className="text-lime-300">◈ Escudo</span>}
                {hud.power === 'spread' && <span className="text-fuchsia-300">✶ Triplo</span>}
                {hud.power === 'rapid' && <span className="text-amber-300">⚡ Rápido</span>}
                <span className={hud.dashReady ? 'text-cyan-300' : 'text-white/25'}>» Dash</span>
              </div>
            </div>
          )}

          {hud.banner && hud.mode === 'playing' && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 z-[5] text-center">
              <div
                key={hud.banner}
                className="overlay-in font-display text-3xl font-black tracking-[0.2em] text-cyan-200 text-glow-cyan sm:text-5xl"
              >
                {hud.banner}
              </div>
            </div>
          )}

          {hud.mode === 'playing' && <TouchSticks gameRef={gameRef} />}

          {/* ---------- Overlays ---------- */}
          {hud.mode !== 'playing' && (
            <div className="overlay-in absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#03040c]/70 p-6 text-center backdrop-blur-sm">
              {hud.mode === 'menu' && (
                <>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">
                    Arena // 3D
                  </div>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-glow-cyan sm:text-5xl">
                    DEFENDE A GRELHA
                  </h2>
                  <NeonButton onClick={start}>Combater</NeonButton>
                  <QualityPicker value={hud.quality} level={hud.qualityLevel} onChange={setQuality} />
                  <Controls />
                </>
              )}

              {hud.mode === 'paused' && (
                <>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-amber-200 sm:text-5xl">
                    PAUSA
                  </h2>
                  <NeonButton onClick={pause}>Continuar</NeonButton>
                  <QualityPicker value={hud.quality} level={hud.qualityLevel} onChange={setQuality} />
                  <p className="mt-4 font-mono text-[11px] tracking-widest text-white/40">P / ESC PARA RETOMAR</p>
                </>
              )}

              {hud.mode === 'over' && (
                <div className="overlay-in-delayed flex flex-col items-center">
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-rose-300/80 uppercase">
                    Nave perdida
                  </div>
                  <h2
                    className="glitch font-display mb-4 text-3xl font-black tracking-widest text-rose-300 sm:text-5xl"
                    data-text="ABATIDO"
                  >
                    ABATIDO
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
                    <span className="mx-2">·</span>ONDA {hud.wave}
                    <span className="mx-2">·</span>
                    {hud.kills} ABATES
                  </div>
                  <NeonButton onClick={start}>Reiniciar</NeonButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Mobile dash ---------- */}
      <div className="mt-5 flex items-center gap-3 md:hidden">
        <span className="font-mono text-[10px] tracking-[0.2em] text-white/40 uppercase">
          Esquerda: mover · Direita: disparar
        </span>
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            audio.unlock()
            dash()
          }}
          className={`dpad-btn font-display flex h-14 w-20 items-center justify-center rounded-xl text-sm tracking-widest uppercase ${
            hud.dashReady ? 'text-cyan-200' : 'text-white/30'
          }`}
        >
          Dash
        </button>
      </div>
    </main>
  )
}

/**
 * Two floating virtual sticks: touch anywhere on the left half to move, on the right half to aim and fire.
 * Knobs are moved through refs so dragging never re-renders React.
 */
function TouchSticks({ gameRef }: { gameRef: RefObject<BlasterGame | null> }) {
  return (
    <div className="absolute inset-0 z-[4] flex">
      <Stick onChange={(x, z) => gameRef.current?.setMove(x, z)} />
      <Stick onChange={(x, z) => gameRef.current?.setAim(x, z)} />
    </div>
  )
}

const STICK_RADIUS = 46

function Stick({ onChange }: { onChange: (x: number, z: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const origin = useRef<{ id: number; x: number; y: number } | null>(null)

  const release = () => {
    origin.current = null
    baseRef.current!.style.opacity = '0'
    onChange(0, 0)
  }

  return (
    <div
      className="relative h-full flex-1"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' || origin.current) return
        audio.unlock()
        e.currentTarget.setPointerCapture(e.pointerId)
        const r = e.currentTarget.getBoundingClientRect()
        origin.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        const base = baseRef.current!
        base.style.left = `${e.clientX - r.left}px`
        base.style.top = `${e.clientY - r.top}px`
        base.style.opacity = '1'
        knobRef.current!.style.transform = 'translate(-50%, -50%)'
      }}
      onPointerMove={(e) => {
        const o = origin.current
        if (!o || o.id !== e.pointerId) return
        let dx = e.clientX - o.x
        let dy = e.clientY - o.y
        const len = Math.hypot(dx, dy)
        if (len > STICK_RADIUS) {
          dx = (dx / len) * STICK_RADIUS
          dy = (dy / len) * STICK_RADIUS
        }
        knobRef.current!.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
        onChange(dx / STICK_RADIUS, dy / STICK_RADIUS)
      }}
      onPointerUp={(e) => origin.current?.id === e.pointerId && release()}
      onPointerCancel={(e) => origin.current?.id === e.pointerId && release()}
    >
      <div
        ref={baseRef}
        className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/40 bg-cyan-300/5 opacity-0 transition-opacity"
      >
        <div
          ref={knobRef}
          className="absolute top-1/2 left-1/2 h-10 w-10 rounded-full bg-cyan-300/60 shadow-[0_0_16px_rgba(103,232,249,0.7)]"
        />
      </div>
    </div>
  )
}

function QualityPicker({
  value,
  level,
  onChange,
}: {
  value: QualityPref
  level: QualityLevel
  onChange: (q: QualityPref) => void
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <div role="radiogroup" aria-label="Qualidade gráfica" className="flex gap-1">
        <span className="mr-2 self-center font-mono text-[10px] tracking-[0.3em] text-white/45 uppercase">
          Gráficos
        </span>
        {QUALITY_PREFS.map((q) => (
          <button
            key={q}
            role="radio"
            aria-checked={q === value}
            onClick={() => {
              audio.unlock()
              audio.click()
              onChange(q)
            }}
            className={`rounded border px-3 py-1 font-mono text-[10px] tracking-widest uppercase transition ${
              q === value
                ? 'border-cyan-300/80 bg-cyan-300/15 text-white'
                : 'border-white/10 bg-white/5 text-white/50 hover:border-cyan-300/40 hover:text-white'
            }`}
          >
            {QUALITY_LABEL[q]}
          </button>
        ))}
      </div>
      <span className="font-mono text-[9px] tracking-widest text-white/35 uppercase">
        Agora: {LEVEL_LABEL[level]}
        {value === 'auto' && ' · baixa sozinho se o FPS cair'}
      </span>
    </div>
  )
}

function Controls() {
  return (
    <div className="mt-6 hidden grid-cols-2 gap-x-6 gap-y-1 text-left font-mono text-[11px] tracking-wider text-white/45 sm:grid">
      <span className="text-cyan-200/80">W A S D</span>
      <span>mover</span>
      <span className="text-cyan-200/80">RATO / SETAS</span>
      <span>apontar e disparar</span>
      <span className="text-cyan-200/80">ESPAÇO / SHIFT</span>
      <span>dash (invencível)</span>
      <span className="text-cyan-200/80">P / ESC · M</span>
      <span>pausa · som</span>
      <span className="text-fuchsia-300/80">✶ ⚡ ◈ ♥</span>
      <span>triplo, rápido, escudo, vida</span>
    </div>
  )
}
