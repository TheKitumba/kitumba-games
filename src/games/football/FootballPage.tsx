import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { audio } from './audio'
import buttonUrl from './assets/control-button.svg'
import passIcon from './assets/icons/pass.svg?raw'
import shootIcon from './assets/icons/shoot.svg?raw'
import sprintIcon from './assets/icons/sprint.svg?raw'
import switchIcon from './assets/icons/switch.svg?raw'
import tackleIcon from './assets/icons/tackle.svg?raw'
import throughIcon from './assets/icons/through.svg?raw'
import pauseIcon from './assets/icons/pause.svg?raw'
import soundIcon from './assets/icons/sound.svg?raw'
import stickBaseUrl from './assets/joystick-base.svg'
import stickKnobUrl from './assets/joystick-knob.svg'
import { FootballGame, type Action, type HudState } from './engine'
import { useMedia } from '../../hooks/media'

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
const ACTIONS: Action[] = ['pass', 'shoot', 'through', 'sprint']

const initialHud: HudState = {
  mode: 'menu',
  home: 0,
  away: 0,
  minute: 0,
  half: 1,
  level: 1,
  streak: 0,
  best: 0,
  result: null,
  newBest: false,
  attacking: true,
  stamina: 100,
  possession: 50,
}

const RESULT_TEXT = {
  win: { label: 'Vitória', title: 'VITÓRIA', color: 'text-lime-300' },
  draw: { label: 'Apito final', title: 'EMPATE', color: 'text-amber-200' },
  loss: { label: 'Apito final', title: 'DERROTA', color: 'text-rose-300' },
} as const

/** An icon from the asset pack; the SVGs stroke with currentColor, so CSS colours them */
function Icon({ svg, className = 'h-5 w-5' }: { svg: string; className?: string }) {
  return <span aria-hidden className={`inline-block [&>svg]:h-full [&>svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="hud-panel relative flex min-w-0 flex-col px-2 py-2 sm:px-4">
      <span className="font-mono text-[9px] tracking-[0.2em] sm:tracking-[0.3em] text-cyan-200/50 uppercase sm:text-[10px]">{label}</span>
      <span className={`font-display text-sm font-bold whitespace-nowrap tabular-nums min-[400px]:text-lg sm:text-2xl ${accent}`}>
        {value}
      </span>
    </div>
  )
}

function StaminaBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div
      role="meter"
      aria-label="Energia do jogador"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={`h-2 overflow-hidden rounded-full border border-cyan-100/40 bg-[#07121b] ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${value > 30 ? 'bg-[#4dff9a]' : 'bg-orange-400'}`}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

function NeonButton({
  children,
  onClick,
  variant = 'primary',
  label,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'primary' | 'ghost'
  label?: string
}) {
  return (
    <button
      aria-label={label}
      onClick={() => {
        audio.unlock()
        audio.click()
        onClick()
      }}
      className={
        variant === 'primary'
          ? 'neon-btn font-display px-8 py-3 text-sm font-bold tracking-[0.25em] uppercase'
          : 'font-display flex items-center gap-2 rounded-md border border-cyan-300/20 bg-white/5 px-3 py-2 text-xs tracking-[0.2em] text-cyan-100/80 uppercase transition hover:border-cyan-300/60 hover:bg-cyan-300/10 hover:text-white'
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
  const touch = useMedia('(pointer: coarse)')
  // A phone or tablet on its side: the pitch fills the screen and the controls sit on top of it
  const shortLandscape = useMedia('(orientation: landscape) and (max-height: 540px)')
  const touchLandscape = useMedia('(orientation: landscape) and (pointer: coarse)')
  const compact = shortLandscape || touchLandscape

  useEffect(() => {
    const game = new FootballGame(canvasRef.current!, overlayRef.current!, setHud)
    gameRef.current = game
    return () => {
      game.destroy()
      gameRef.current = null
    }
  }, [])

  const start = useCallback(() => gameRef.current?.start(), [])
  const pause = useCallback(() => gameRef.current?.togglePause(), [])
  const resume = useCallback(() => gameRef.current?.resume(), [])
  const act = useCallback((a: Action, down: boolean) => gameRef.current?.press(a, down), [])
  const move = useCallback((x: number, y: number) => gameRef.current?.setInput(x, y), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.setMuted(!m)
      return !m
    })
  }, [])

  // Keyboard. Held direction keys add up to a movement vector. Several keys can map to one action,
  // so an action goes down with the first of its keys and up with the last.
  useEffect(() => {
    const heldMoves = new Set<string>()
    const heldActions = new Map<Action, Set<string>>(ACTIONS.map((a) => [a, new Set()]))
    const idle = hud.mode === 'menu' || hud.mode === 'over' || hud.mode === 'halftime'
    const sync = () => {
      let x = 0
      let y = 0
      for (const code of heldMoves) {
        x += MOVE_KEYS[code][0]
        y += MOVE_KEYS[code][1]
      }
      move(x, y)
    }
    const next = () => (hud.mode === 'halftime' ? resume() : start())
    const onDown = (e: KeyboardEvent) => {
      if (e.code in MOVE_KEYS) {
        e.preventDefault()
        heldMoves.add(e.code)
        sync()
      } else if (e.code in ACTION_KEYS) {
        e.preventDefault()
        if (e.repeat) return
        if (idle) {
          // Let a focused button handle its own Space
          if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) next()
          return
        }
        if (hud.mode !== 'playing') return
        const keys = heldActions.get(ACTION_KEYS[e.code])!
        keys.add(e.code)
        if (keys.size === 1) act(ACTION_KEYS[e.code], true)
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault()
        if (hud.mode === 'playing' || hud.mode === 'paused') pause()
      } else if (e.code === 'Enter' && idle && !(e.target instanceof HTMLButtonElement)) {
        next()
      } else if (e.code === 'KeyM') {
        toggleMute()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (heldMoves.delete(e.code)) return sync()
      const a = ACTION_KEYS[e.code]
      if (!a) return
      const keys = heldActions.get(a)!
      if (keys.delete(e.code) && keys.size === 0) act(a, false)
    }
    const release = () => {
      heldMoves.clear()
      sync()
      for (const [a, keys] of heldActions) {
        if (keys.size) act(a, false)
        keys.clear()
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', release)
      release()
    }
  }, [hud.mode, act, move, pause, resume, start, toggleMute])

  // Auto-pause when the window loses focus (the engine also pauses on a hidden tab)
  useEffect(() => {
    const onBlur = () => {
      if (hud.mode === 'playing') pause()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [hud.mode, pause])

  const result = hud.result ? RESULT_TEXT[hud.result] : null
  const live = hud.mode === 'playing' || hud.mode === 'paused'
  const time = `${hud.minute}' · ${hud.half}ª`

  const controls = (
    <>
      <Joystick onMove={move} />
      <ActionPad attacking={hud.attacking} onAct={act} />
    </>
  )

  return (
    <main
      className={
        compact
          ? 'fixed inset-0 overflow-hidden bg-[#03040c]'
          : 'mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 pt-5 pb-6 sm:pt-8'
      }
    >
      <title>Kitumba Football — Kitumba Games</title>
      {!compact && (
        <header className="mb-4 flex w-full items-center justify-between gap-4 sm:mb-6">
          <div>
            <Link
              to="/"
              className="font-mono text-[10px] tracking-[0.4em] text-cyan-200/50 uppercase transition hover:text-white"
            >
              ← Kitumba Games
            </Link>
            <h1 className="glitch font-display text-2xl font-black tracking-[0.18em] sm:text-4xl" data-text="KITUMBA FOOTBALL">
              KITUMBA FOOTBALL
            </h1>
          </div>
          <div className="flex gap-2">
            <NeonButton variant="ghost" onClick={toggleMute} label={muted ? 'Ligar som' : 'Desligar som'}>
              <Icon svg={soundIcon} className={`h-4 w-4 ${muted ? 'opacity-40' : ''}`} />
              {muted ? 'Mudo' : 'Som'}
            </NeonButton>
            {live && (
              <NeonButton variant="ghost" onClick={pause} label={hud.mode === 'paused' ? 'Continuar' : 'Pausa'}>
                {hud.mode === 'paused' ? '▶' : <Icon svg={pauseIcon} className="h-4 w-4" />}
              </NeonButton>
            )}
          </div>
        </header>
      )}

      {!compact && (
        <section className="mb-4 grid w-full max-w-[600px] grid-cols-4 gap-2 sm:mb-6 sm:gap-3">
          <Stat
            label="Golos"
            value={`${hud.home} - ${hud.away}`}
            accent={hud.home >= hud.away ? 'text-cyan-300 text-glow-cyan' : 'text-fuchsia-300 text-glow-fuchsia'}
          />
          <Stat label="Tempo" value={time} accent={hud.minute >= 80 ? 'text-rose-300' : 'text-white/70'} />
          <Stat label="Divisão" value={hud.level} accent="text-amber-300" />
          <Stat label="Recorde" value={hud.best} accent="text-fuchsia-300 text-glow-fuchsia" />
        </section>
      )}

      {/* ---------- Pitch ---------- */}
      <div
        className={
          compact
            ? 'absolute inset-0'
            : touch
              ? // Leave room under the pitch for the touch controls, whatever the screen width
                'w-[min(100%,480px,calc((100dvh-470px)*0.75))] min-w-64'
              : 'w-[min(100%,480px,calc((100dvh-250px)*0.75))] min-w-64'
        }
      >
        <div className={compact ? 'relative h-full w-full' : 'relative aspect-[3/4] w-full'}>
          {!compact && <div className="absolute inset-0 rounded-xl bg-cyan-500/20 blur-2xl" />}
          <div className={`absolute inset-0 overflow-hidden ${compact ? '' : 'board-frame rounded-xl'}`}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Estádio com as duas equipas de onze jogadores"
              className="block h-full w-full touch-none"
            />
            <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>

          {compact && (
            <div className="pointer-events-none absolute top-[max(8px,env(safe-area-inset-top))] left-[max(8px,env(safe-area-inset-left))] z-10 flex items-center gap-2">
              <div className="hud-panel px-3 py-1.5">
                <div className="font-display text-base font-bold text-cyan-200 tabular-nums">
                  {hud.home} - {hud.away} <span className="ml-1 text-xs text-white/60">{time}</span>
                </div>
                <StaminaBar value={hud.stamina} className="mt-1 w-28" />
              </div>
              <div className="pointer-events-auto flex gap-1">
                <IconButton svg={soundIcon} label={muted ? 'Ligar som' : 'Desligar som'} onClick={toggleMute} dim={muted} />
                {live && <IconButton svg={pauseIcon} label="Pausa" onClick={pause} />}
              </div>
            </div>
          )}

          {compact && touch && live && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-[max(12px,env(safe-area-inset-left))] pb-[max(10px,env(safe-area-inset-bottom))]">
              {controls}
            </div>
          )}

          {/* ---------- Overlays ---------- */}
          {hud.mode !== 'playing' && (
            <div
              className={`overlay-in absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#03040c]/70 p-6 text-center backdrop-blur-sm ${compact ? '' : 'rounded-xl'}`}
            >
              {hud.mode === 'menu' && (
                <>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">Estádio cheio</div>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-glow-cyan sm:text-5xl">
                    11 CONTRA 11
                  </h2>
                  <NeonButton onClick={start}>Apito inicial</NeonButton>
                  {!touch && <Controls />}
                  {touch && !compact && (
                    <p className="mt-6 max-w-64 font-mono text-[10px] tracking-wider text-white/45">
                      Vira o telemóvel na horizontal para jogar em ecrã inteiro.
                    </p>
                  )}
                </>
              )}

              {hud.mode === 'paused' && (
                <>
                  <h2 className="font-display mb-6 text-3xl font-black tracking-widest text-amber-200 sm:text-5xl">PAUSA</h2>
                  <NeonButton onClick={pause}>Continuar</NeonButton>
                  {!touch && <p className="mt-4 font-mono text-[11px] tracking-widest text-white/40">P / ESC PARA RETOMAR</p>}
                </>
              )}

              {hud.mode === 'halftime' && (
                <>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">Intervalo</div>
                  <div className="font-display mb-2 text-4xl font-bold text-cyan-200 tabular-nums text-glow-cyan">
                    {hud.home} - {hud.away}
                  </div>
                  <div className="mb-6 font-mono text-[11px] tracking-widest text-white/50">
                    POSSE DE BOLA {hud.possession}% - {100 - hud.possession}%
                  </div>
                  <NeonButton onClick={resume}>2.ª parte</NeonButton>
                </>
              )}

              {hud.mode === 'over' && result && (
                <div className="overlay-in-delayed flex flex-col items-center">
                  <div className="mb-2 font-mono text-[10px] tracking-[0.5em] text-cyan-300/70 uppercase">{result.label}</div>
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

      {!compact && (
        <div className="mt-3 flex w-full max-w-[480px] items-center gap-3 px-1">
          <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-200/50 uppercase">Energia</span>
          <StaminaBar value={hud.stamina} className="flex-1" />
        </div>
      )}

      {/* ---------- Touch controls under the pitch (portrait) ---------- */}
      {!compact && touch && (
        <div className="mt-4 flex w-full max-w-[480px] touch-none items-end justify-between px-1 pb-[env(safe-area-inset-bottom)]">
          {controls}
        </div>
      )}
    </main>
  )
}

function IconButton({ svg, label, onClick, dim }: { svg: string; label: string; onClick: () => void; dim?: boolean }) {
  return (
    <button
      aria-label={label}
      onClick={() => {
        audio.unlock()
        audio.click()
        onClick()
      }}
      className={`grid h-9 w-9 place-items-center rounded-full border border-cyan-200/30 bg-[#07121f]/70 text-cyan-100 ${dim ? 'opacity-50' : ''}`}
    >
      <Icon svg={svg} className="h-4 w-4" />
    </button>
  )
}

/**
 * Right-hand buttons. Labels and icons follow the situation: with the ball they pass, shoot and
 * play through; without it they switch player, slide tackle and send a teammate to press.
 */
function ActionPad({ attacking, onAct }: { attacking: boolean; onAct: (a: Action, down: boolean) => void }) {
  return (
    <div className="relative h-44 w-52 shrink-0 touch-none select-none">
      <PadButton action="sprint" onAct={onAct} icon={sprintIcon} label="Sprint" className="bottom-[5.25rem] left-0 h-14 w-14 text-lime-200" />
      <PadButton
        action="pass"
        onAct={onAct}
        icon={attacking ? passIcon : switchIcon}
        label={attacking ? 'Passe' : 'Trocar'}
        className="right-[5.75rem] bottom-0 h-[4.5rem] w-[4.5rem] text-cyan-200"
      />
      <PadButton
        action="shoot"
        onAct={onAct}
        icon={attacking ? shootIcon : tackleIcon}
        label={attacking ? 'Remate' : 'Carrinho'}
        className="right-0 bottom-0 h-[5.5rem] w-[5.5rem] text-amber-200"
      />
      <PadButton
        action="through"
        onAct={onAct}
        icon={attacking ? throughIcon : switchIcon}
        label={attacking ? 'Em prof.' : 'Pressão'}
        className="right-2 bottom-24 h-16 w-16 text-fuchsia-200"
      />
    </div>
  )
}

/** A round action button that reports press and release separately (shots charge while held). */
function PadButton({
  action,
  onAct,
  icon,
  label,
  className,
}: {
  action: Action
  onAct: (a: Action, down: boolean) => void
  icon: string
  label: string
  className: string
}) {
  const [down, setDown] = useState(false)
  const up = () => {
    if (!down) return
    setDown(false)
    onAct(action, false)
  }
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        audio.unlock()
        setDown(true)
        onAct(action, true)
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      // Quoted: Vite inlines small SVGs as data: URLs, which break unquoted in CSS url()
      style={{ backgroundImage: `url("${buttonUrl}")` }}
      className={`font-display absolute flex touch-none flex-col items-center justify-center gap-0.5 rounded-full bg-contain bg-center bg-no-repeat text-[9px] font-bold tracking-wider uppercase transition-transform select-none ${
        down ? 'scale-90 brightness-150 drop-shadow-[0_0_12px_rgba(57,230,226,0.8)]' : ''
      } ${className}`}
    >
      <Icon svg={icon} className="h-5 w-5" />
      {label}
    </button>
  )
}

/**
 * Analogue stick. Inside the dead zone it reads zero; past it the response is rescaled so small
 * movements are fine control, and it reaches full speed a little before the rim so the thumb
 * doesn't have to stretch.
 */
function Joystick({
  onMove,
  deadZone = 0.15,
  fullAt = 0.85,
}: {
  onMove: (x: number, y: number) => void
  deadZone?: number
  fullAt?: number
}) {
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
    setKnob({ x, y })
    if (d < deadZone) return onMove(0, 0)
    const mag = Math.min(1, (Math.min(d, 1) - deadZone) / (fullAt - deadZone))
    onMove((x / Math.min(d, 1)) * mag, (y / Math.min(d, 1)) * mag)
  }

  const release = () => {
    setKnob({ x: 0, y: 0 })
    onMove(0, 0)
  }

  return (
    <div
      ref={padRef}
      role="application"
      aria-label="Joystick de movimento"
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
      onLostPointerCapture={release}
      style={{ backgroundImage: `url("${stickBaseUrl}")` }}
      className="relative h-32 w-32 shrink-0 touch-none rounded-full min-[400px]:h-36 min-[400px]:w-36 bg-contain bg-center bg-no-repeat select-none"
    >
      <div
        style={{
          backgroundImage: `url("${stickKnobUrl}")`,
          transform: `translate(calc(-50% + ${knob.x * 40}px), calc(-50% + ${knob.y * 40}px))`,
        }}
        className="pointer-events-none absolute top-1/2 left-1/2 h-14 w-14 rounded-full bg-contain bg-center bg-no-repeat"
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
      <span>passe · trocar (manter: conter)</span>
      <span className="text-cyan-200/80">K (manter)</span>
      <span>remate · carrinho</span>
      <span className="text-cyan-200/80">L</span>
      <span>em profundidade · pressão</span>
      <span className="text-cyan-200/80">P / ESC · M</span>
      <span>pausa · som</span>
    </div>
  )
}
