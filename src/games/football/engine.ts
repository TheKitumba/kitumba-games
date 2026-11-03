import {
  ACESFilmicToneMapping,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import ballUrl from './assets/football-ball-albedo.png'
import shadowUrl from './assets/ball-shadow.svg'
import markerUrl from './assets/player-marker.svg'
import { audio } from './audio'
import { GAMEPLAY_CONFIG as C, byLevel } from './config'
import { Humanoid, type Kit, type Look } from './humanoid'
import { buildStadium } from './stadium'

// The simulation works on a flat pitch in metres: x across (0..PITCH_W), y along (0..PITCH_H), z up.
// Home attacks toward y = 0, which is the far end of the screen. The 3D scene centres the pitch:
// three.js x = x - PITCH_W / 2, z = y - PITCH_H / 2, y = height.
const PITCH_W = C.pitch.width
const PITCH_H = C.pitch.length
const GOAL_W = C.pitch.goalWidth
const GOAL_DEPTH = C.pitch.goalDepth
const CROSSBAR = C.pitch.crossbar
const BOX_W = C.pitch.boxWidth
const BOX_D = C.pitch.boxDepth
const PLAYER_R = C.player.radius
const BALL_R = C.ball.radius
const RUN = C.player.run
const SPRINT = C.player.sprint
const CONTROL_R = C.control.radius

const BEST_KEY = 'kitumba-football:best'

export type GameMode = 'menu' | 'playing' | 'paused' | 'halftime' | 'over'
export type MatchResult = 'win' | 'draw' | 'loss'
export type Action = 'pass' | 'shoot' | 'through' | 'sprint'
type Team = 'home' | 'away'
type Role = 'gk' | 'def' | 'mid' | 'fwd'
type RestartKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'keeper'
/** What the ball is doing; most rules key off this */
type BallState = 'owned' | 'held' | 'dead' | 'pass' | 'shot' | 'air' | 'loose'

export interface HudState {
  mode: GameMode
  home: number
  away: number
  minute: number
  half: 1 | 2
  level: number
  streak: number
  best: number
  result: MatchResult | null
  newBest: boolean
  /** Your team has the ball: the action buttons attack instead of defend */
  attacking: boolean
  /** Stamina of the player you control, 0..100 in steps of 5 */
  stamina: number
  /** Home share of possession in percent, reported at half time and full time */
  possession: number
}

interface Footballer {
  team: Team
  role: Role
  num: number
  /** Formation slot in the attacking frame: ax across, ay from own goal (0) to the opponent's (1) */
  baseX: number
  baseY: number
  /** Fullbacks and wide midfielders: they overlap and hug the touchline when attacking */
  wide: boolean
  x: number
  y: number
  vx: number
  vy: number
  /** Facing, a unit vector */
  fx: number
  fy: number
  phase: number
  /** Personal top-speed multiplier */
  pace: number
  /** Stronger foot: 1 right, -1 left */
  foot: number
  /** 0..1, fixed per player, so teammates don't move in lockstep */
  quirk: number
  stamina: number
  /** Can't touch the ball while > 0 (just kicked it, or just lost it) */
  cooldown: number
  tackleCd: number
  /** On the ground or getting up */
  stun: number
  slide: number
  slideX: number
  slideY: number
  dive: number
  diveDir: number
  /** Kick animation, counting down */
  kickT: number
  think: number
  model: Humanoid
}

interface Ball {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

interface SetPiece {
  kind: RestartKind
  team: Team
  taker: Footballer
  x: number
  y: number
  ready: boolean
  wait: number
}

type Intent =
  | { kind: 'shoot'; power: number }
  | { kind: 'pass'; to: Footballer; lofted: boolean }
  | { kind: 'through'; to: Footballer; x: number; y: number }
  | { kind: 'dribble' }

interface Banner {
  text: string
  sub: string
  life: number
  max: number
  color: string
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  size: number
  spin: number
}

// 4-4-2: role, across, up the pitch, shirt number
const FORMATION: [Role, number, number, number][] = [
  ['gk', 0.5, 0.02, 1],
  ['def', 0.14, 0.22, 3],
  ['def', 0.38, 0.17, 4],
  ['def', 0.62, 0.17, 5],
  ['def', 0.86, 0.22, 2],
  ['mid', 0.13, 0.44, 11],
  ['mid', 0.38, 0.4, 8],
  ['mid', 0.62, 0.4, 6],
  ['mid', 0.87, 0.44, 7],
  ['fwd', 0.4, 0.62, 10],
  ['fwd', 0.6, 0.64, 9],
]

// Home is cyan with pale stripes, after the kit reference in the asset pack
const HOME_KIT: Kit = { shirt: 0x06b6d4, stripes: 0xcffafe, sleeve: 0x06b6d4, shorts: 0xf1f5f9, socks: 0x06b6d4, number: '#0e3a4a' }
const HOME_GK: Kit = { shirt: 0xf59e0b, sleeve: 0xf59e0b, shorts: 0x1f2937, socks: 0xf59e0b, number: '#111827' }
// The rival changes its kit every division
const AWAY_KITS: Kit[] = [
  { shirt: 0xc026d3, sleeve: 0x701a75, shorts: 0x1e1b4b, socks: 0xc026d3, number: '#ffffff' },
  { shirt: 0xdc2626, sleeve: 0xffffff, shorts: 0xffffff, socks: 0xdc2626, number: '#ffffff' },
  { shirt: 0xeab308, stripes: 0x111827, sleeve: 0x111827, shorts: 0x111827, socks: 0xeab308, number: '#ffffff' },
  { shirt: 0xf8fafc, sleeve: 0x7c3aed, shorts: 0x7c3aed, socks: 0xf8fafc, number: '#7c3aed' },
  { shirt: 0x16a34a, sleeve: 0xf8fafc, shorts: 0xf8fafc, socks: 0x16a34a, number: '#ffffff' },
]
const AWAY_GK: Kit = { shirt: 0x84cc16, sleeve: 0x84cc16, shorts: 0x1f2937, socks: 0x84cc16, number: '#111827' }

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21, 0xffdbac, 0x3b2219, 0xa86b3c]
const HAIRS = [0x0f0f0f, 0x1f140c, 0x3b2314, 0x6b4423, 0xc9a35e, 0x2a1a0f]
const HOME_CSS = '#22d3ee'
const AWAY_CSS = '#e879f9'

const RESTART_TEXT: Record<RestartKind, string> = {
  kickoff: 'PONTAPÉ DE SAÍDA',
  throw: 'LANÇAMENTO',
  corner: 'CANTO',
  goalkick: 'PONTAPÉ DE BALIZA',
  keeper: '',
}

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

const writeBest = (v: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(v))
  } catch {
    // storage unavailable — best streak just won't persist
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay)

const norm = (x: number, y: number) => {
  const d = Math.hypot(x, y)
  return d > 1e-6 ? { x: x / d, y: y / d, d } : { x: 0, y: 0, d: 0 }
}

/** Distance from point p to the segment a→b */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1)
  return dist(px, py, ax + dx * t, ay + dy * t)
}

/** Deterministic random numbers, so the squads look the same every visit */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** A short buzz on phones that support it; never required for anything */
const haptic = (ms: number) => {
  if (!audio.muted && coarsePointer() && 'vibrate' in navigator) navigator.vibrate(ms)
}

export class FootballGame {
  private canvas: HTMLCanvasElement
  private overlay: HTMLCanvasElement
  private octx: CanvasRenderingContext2D
  private onChange: (hud: HudState) => void
  private resizeObserver: ResizeObserver
  private raf = 0
  private lastFrame = 0
  private acc = 0
  private lastHud = ''
  private w = 0
  private h = 0

  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(C.camera.fov, 0.75, 0.5, 400)
  private sun: DirectionalLight
  private ballMesh: Mesh
  private ballShadow: Mesh<PlaneGeometry, MeshBasicMaterial>
  private marker: Mesh
  private arrow: Mesh
  private receiverRing: Mesh
  private nets: Mesh[]
  private netBulge = [0, 0]
  private focus = { x: PITCH_W / 2, y: PITCH_H / 2 }
  private zoom = 1
  private v3 = new Vector3()
  private q = new Quaternion()
  private frameMs = 16
  private slowTime = 0
  /** 2 full, 1 lower resolution, 0 lower resolution and no shadows */
  private quality = 2

  private mode: GameMode = 'menu'
  private players: Footballer[] = []
  private homeTeam: Footballer[] = []
  private awayTeam: Footballer[] = []
  private awayKit = -1
  private controlled!: Footballer
  private owner: Footballer | null = null
  private ownerTime = 0
  private passTarget: Footballer | null = null
  private flight: 'pass' | 'shot' | 'free' = 'free'
  /** Seconds since the ball was last struck; keepers need a moment to react */
  private sinceKick = 0
  private lastTouch: Team = 'home'
  private lastKicker: Footballer | null = null
  /** The current shot already got past the keeper's hands, so it isn't checked again */
  private keeperBeaten = false
  /** Extra distance the ball runs ahead after a heavy or directed first touch, decaying */
  private touchBoost = 0
  private setPiece: SetPiece | null = null
  private ball: Ball = { x: PITCH_W / 2, y: PITCH_H / 2, z: 0, vx: 0, vy: 0, vz: 0 }

  private input = { x: 0, y: 0 }
  private held: Record<Action, boolean> = { pass: false, shoot: false, through: false, sprint: false }
  private passDownAt = 0
  private charging = false
  private charge = 0
  /** A pass or shot pressed a moment too early (ball still arriving, kickoff whistle not blown yet) */
  private buffered: { kind: 'pass' | 'through' | 'shot'; power: number; aim: number | null; ttl: number } | null = null
  private switchTimer = 0
  private chasing = new Set<Footballer>()
  private coverer: Footballer | null = null

  private home = 0
  private away = 0
  private clock = 0
  private half: 1 | 2 = 1
  private freeze = 0
  private goalTimer = 0
  private scorer: Team = 'home'
  private possHome = 0
  private possAway = 0
  private level = 1
  private streak = 0
  private best = readBest()
  private newBest = false
  private result: MatchResult | null = null

  private time = 0
  private shake = 0
  private flash = 0
  private flashColor = HOME_CSS
  private banners: Banner[] = []
  private particles: Particle[] = []

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, onChange: (hud: HudState) => void) {
    this.canvas = canvas
    this.overlay = overlay
    this.octx = overlay.getContext('2d')!
    this.onChange = onChange

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    this.scene.background = new Color(0x060814)
    this.scene.fog = new Fog(0x060814, 80, 170)
    this.scene.add(new HemisphereLight(0xd6e6ff, 0x1d3b22, 1.25))
    this.sun = new DirectionalLight(0xfff6e8, 2.6)
    this.sun.castShadow = true
    const mobile = coarsePointer()
    if (mobile) this.quality = 1
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    const sc = this.sun.shadow.camera
    sc.left = -26
    sc.right = 26
    sc.top = 26
    sc.bottom = -26
    sc.near = 1
    sc.far = 120
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target)

    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    const p = C.pitch
    const stadium = buildStadium(
      {
        w: PITCH_W,
        h: PITCH_H,
        goalW: GOAL_W,
        goalDepth: GOAL_DEPTH,
        crossbar: CROSSBAR,
        boxW: BOX_W,
        boxD: BOX_D,
        sixW: p.sixWidth,
        sixD: p.sixDepth,
        penSpot: p.penaltySpot,
        circleR: p.circleRadius,
      },
      aniso,
    )
    this.scene.add(stadium.group)
    this.nets = stadium.nets

    const loader = new TextureLoader()
    const ballTex = loader.load(ballUrl)
    ballTex.colorSpace = SRGBColorSpace
    this.ballMesh = new Mesh(new SphereGeometry(BALL_R, 24, 16), new MeshStandardMaterial({ map: ballTex, roughness: 0.45 }))
    this.ballMesh.castShadow = true
    this.ballMesh.scale.setScalar(C.ball.drawScale)
    this.scene.add(this.ballMesh)

    // Contact shadow: stays on the grass under the ball and fades as it rises
    this.ballShadow = new Mesh(
      new PlaneGeometry(BALL_R * 3.2, BALL_R * 1.6).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: loader.load(shadowUrl), transparent: true, depthWrite: false }),
    )
    this.ballShadow.renderOrder = 1
    this.scene.add(this.ballShadow)

    const markerTex = loader.load(markerUrl)
    markerTex.colorSpace = SRGBColorSpace
    this.marker = new Mesh(
      new PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: markerTex, transparent: true, depthWrite: false, toneMapped: false }),
    )
    this.marker.renderOrder = 1
    this.arrow = new Mesh(
      new ConeGeometry(0.17, 0.34, 4).rotateX(Math.PI),
      new MeshBasicMaterial({ color: HOME_CSS, toneMapped: false }),
    )
    this.receiverRing = new Mesh(
      new RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    )
    this.receiverRing.renderOrder = 1
    this.scene.add(this.marker, this.arrow, this.receiverRing)

    this.buildTeams()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.kickoff('home')
    this.freeze = 0
    this.banners = []
    document.addEventListener('visibilitychange', this.onVisibility)
    // Dev builds only: lets browser tests read the match state. Stripped from production.
    if (import.meta.env.DEV) (window as unknown as { __football?: FootballGame }).__football = this
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    audio.stopCrowd()
    for (const f of this.players) f.model.dispose()
    this.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      obj.geometry.dispose()
      const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        ;(m as MeshStandardMaterial).map?.dispose()
        m.dispose()
      }
    })
    // No forceContextLoss(): a remount (React StrictMode does one) reuses this canvas and its context,
    // and the browser frees the context with the canvas element itself
    this.renderer.dispose()
  }

  // ---------------- Public controls ----------------

  /** Starts a match at the current division (it goes up after each win). */
  start() {
    audio.unlock()
    this.buildTeams()
    this.home = 0
    this.away = 0
    this.clock = 0
    this.half = 1
    this.possHome = 0
    this.possAway = 0
    this.result = null
    this.newBest = false
    this.banners = []
    this.particles = []
    this.goalTimer = 0
    for (const f of this.players) f.stamina = 1
    this.releaseAll()
    this.kickoff('home')
    this.mode = 'playing'
    this.lastFrame = 0
    audio.whistle()
    audio.startCrowd()
    this.emit()
  }

  togglePause() {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      this.releaseAll()
      audio.stopCrowd()
    } else if (this.mode === 'paused') {
      this.mode = 'playing'
      this.lastFrame = 0
      audio.startCrowd()
    } else return
    audio.pause()
    this.emit()
  }

  /** Kicks off the second half from the half-time screen. */
  resume() {
    if (this.mode !== 'halftime') return
    this.mode = 'playing'
    this.lastFrame = 0
    this.releaseAll()
    for (const f of this.players) f.stamina = Math.min(1, f.stamina + 0.4)
    this.kickoff('away')
    audio.whistle()
    audio.startCrowd()
    this.emit()
  }

  /** Movement vector from keyboard or joystick; each axis in [-1, 1], screen-up is negative y. */
  setInput(x: number, y: number) {
    // Clamped to the unit circle, so a diagonal is never faster than a straight line
    const n = norm(x, y)
    const len = Math.min(1, n.d)
    this.input = { x: n.x * len, y: n.y * len }
  }

  /** Button press or release. What a button does depends on who has the ball, like on a pad. */
  press(action: Action, down: boolean) {
    const was = this.held[action]
    this.held[action] = down
    if (this.mode !== 'playing' || this.goalTimer > 0) {
      if (!down) this.charging = false
      return
    }
    if (down && was) return
    const c = this.controlled
    const mine = this.owner === c
    const sp = this.setPiece
    // Coming to you, loose at your feet, or the whistle not blown yet: remember it for a moment
    const soon = this.freeze > 0 || this.passTarget === c || this.looseNear(c, 3)

    if (action === 'pass' && down) {
      this.passDownAt = this.time
      if (mine && this.freeze <= 0) this.humanPass(c, false)
      else if (soon && (mine || this.possessionTeam() !== 'away')) this.bufferAction('pass', 0)
      else if (this.possessionTeam() !== 'home') this.switchPlayer()
    } else if (action === 'through' && down) {
      if (mine && this.freeze <= 0) this.humanPass(c, true)
      else if (soon && this.possessionTeam() === 'home') this.bufferAction('through', 0)
    } else if (action === 'shoot') {
      if (down) {
        if (mine && sp?.kind === 'corner') this.humanCross(c)
        else if (mine && sp) {
          if (this.freeze > 0) this.bufferAction('pass', 0)
          else this.humanPass(c, false)
        } else if (mine || soon) {
          this.charging = true
          this.charge = 0
        } else if (this.possessionTeam() !== 'home') this.slideTackle(c, this.input.x, this.input.y)
      } else if (this.charging) {
        this.charging = false
        const power = Math.pow(this.charge, C.shot.curve)
        if (this.owner === c && this.freeze <= 0) this.shoot(c, power, this.aimFromInput(), this.liftFromInput())
        else this.bufferAction('shot', power)
      }
    }
  }

  // ---------------- Internals ----------------

  private onVisibility = () => {
    if (document.hidden && this.mode === 'playing') this.togglePause()
    this.lastFrame = 0
  }

  private releaseAll() {
    this.held = { pass: false, shoot: false, through: false, sprint: false }
    this.input = { x: 0, y: 0 }
    this.charging = false
    this.buffered = null
  }

  private bufferAction(kind: 'pass' | 'through' | 'shot', power: number) {
    this.buffered = { kind, power, aim: this.aimFromInput(), ttl: C.control.inputBuffer }
  }

  /** Plays a buffered press as soon as it can be played */
  private runBuffer(s: number) {
    const b = this.buffered
    if (!b) return
    const c = this.controlled
    if ((this.owner === c && this.freeze <= 0) || this.looseNear(c, 0)) {
      this.buffered = null
      if (b.kind === 'shot' && !this.setPiece) this.shoot(c, b.power, b.aim, 0)
      else this.humanPass(c, b.kind === 'through')
      return
    }
    // The buffer only runs down while the ball is live and not on its way to you
    if (this.freeze <= 0 && this.passTarget !== c) b.ttl -= s
    if (b.ttl <= 0) this.buffered = null
  }

  private emit() {
    const total = this.possHome + this.possAway
    const report = this.mode === 'over' || this.mode === 'halftime'
    const hud: HudState = {
      mode: this.mode,
      home: this.home,
      away: this.away,
      minute: Math.min(90, Math.floor((this.clock / C.match.time) * 90)),
      half: this.half,
      level: this.level,
      streak: this.streak,
      best: this.best,
      result: this.result,
      newBest: this.newBest,
      attacking: this.possessionTeam() === 'home',
      stamina: Math.round(this.controlled.stamina * 20) * 5,
      possession: report && total > 0 ? Math.round((this.possHome / total) * 100) : 50,
    }
    const key = JSON.stringify(hud)
    if (key === this.lastHud) return
    this.lastHud = key
    this.onChange(hud)
  }

  private resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return
    const cap = this.quality >= 2 ? C.quality.maxDpr : this.quality === 1 ? C.quality.mobileDpr : 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap))
    this.renderer.setSize(w, h, false)
    const odpr = Math.min(window.devicePixelRatio || 1, 2)
    this.overlay.width = Math.round(w * odpr)
    this.overlay.height = Math.round(h * odpr)
    this.octx.setTransform(odpr, 0, 0, odpr, 0, 0)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.w = w
    this.h = h
  }

  /** Steps quality down when frames stay slow: sharpness first, then shadows. Controls never degrade. */
  private watchPerformance(ms: number) {
    this.frameMs += (ms - this.frameMs) * 0.05
    if (this.mode !== 'playing' || this.quality === 0) return
    this.slowTime = this.frameMs > C.quality.slowFrame ? this.slowTime + ms / 1000 : 0
    if (this.slowTime < 2) return
    this.slowTime = 0
    this.quality--
    if (this.quality === 0) this.sun.castShadow = false
    this.resize()
  }

  private buildTeams() {
    const kitIndex = (this.level - 1) % AWAY_KITS.length
    if (this.players.length && kitIndex === this.awayKit) return
    for (const f of this.players) {
      this.scene.remove(f.model.root)
      f.model.dispose()
    }
    this.awayKit = kitIndex
    const make = (team: Team, seed: number) => {
      const rnd = seeded(seed)
      return FORMATION.map(([role, ax, ay, num]): Footballer => {
        const keeper = role === 'gk'
        const kit = team === 'home' ? (keeper ? HOME_GK : HOME_KIT) : keeper ? AWAY_GK : AWAY_KITS[kitIndex]
        const look: Look = {
          skin: SKINS[Math.floor(rnd() * SKINS.length)],
          hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
          hairStyle: Math.floor(rnd() * 4),
          scale: 0.94 + rnd() * 0.12 + (keeper ? 0.04 : 0),
        }
        const model = new Humanoid(kit, look, num, keeper)
        this.scene.add(model.root)
        return {
          team,
          role,
          num,
          baseX: ax,
          baseY: ay,
          wide: Math.abs(ax - 0.5) > 0.3,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          fx: 0,
          fy: team === 'home' ? -1 : 1,
          phase: rnd() * 6,
          pace: 0.96 + rnd() * 0.08 + (role === 'fwd' ? 0.03 : 0),
          foot: rnd() < 0.75 ? 1 : -1,
          quirk: rnd(),
          stamina: 1,
          cooldown: 0,
          tackleCd: 0,
          stun: 0,
          slide: 0,
          slideX: 0,
          slideY: 0,
          dive: 0,
          diveDir: 0,
          kickT: 0,
          think: 0,
          model,
        }
      })
    }
    this.homeTeam = make('home', 7)
    this.awayTeam = make('away', 100 + kitIndex * 13)
    this.players = [...this.homeTeam, ...this.awayTeam]
    this.controlled = this.homeTeam[10]
  }

  // ---------------- Pitch helpers ----------------

  private get cx() {
    return PITCH_W / 2
  }

  private teamOf(t: Team) {
    return t === 'home' ? this.homeTeam : this.awayTeam
  }

  private rivals(t: Team) {
    return t === 'home' ? this.awayTeam : this.homeTeam
  }

  private keeperOf(t: Team) {
    return this.teamOf(t)[0]
  }

  /** y of the goal line a team attacks */
  private targetLine(t: Team) {
    return t === 'home' ? 0 : PITCH_H
  }

  /** Unit y direction a team attacks in */
  private attackDir(t: Team) {
    return t === 'home' ? -1 : 1
  }

  private toAttack(t: Team, x: number, y: number) {
    return t === 'home' ? { ax: x / PITCH_W, ay: 1 - y / PITCH_H } : { ax: 1 - x / PITCH_W, ay: y / PITCH_H }
  }

  private toWorld(t: Team, ax: number, ay: number) {
    return t === 'home' ? { x: ax * PITCH_W, y: (1 - ay) * PITCH_H } : { x: (1 - ax) * PITCH_W, y: ay * PITCH_H }
  }

  /** Inside the penalty box that team t defends */
  private inOwnBox(t: Team, x: number, y: number) {
    const line = t === 'home' ? PITCH_H : 0
    return Math.abs(x - this.cx) < BOX_W / 2 && Math.abs(y - line) < BOX_D
  }

  private possessionTeam(): Team | null {
    return this.owner?.team ?? this.passTarget?.team ?? this.setPiece?.team ?? null
  }

  private ballState(): BallState {
    const sp = this.setPiece
    if (sp) return sp.kind === 'keeper' ? 'held' : 'dead'
    if (this.owner) return 'owned'
    if (this.flight === 'shot') return 'shot'
    if (this.flight === 'pass') return 'pass'
    return this.ball.z > 0.3 ? 'air' : 'loose'
  }

  private looseNear(f: Footballer, extra: number) {
    const b = this.ball
    return !this.owner && !this.setPiece && b.z < 1 && dist(f.x, f.y, b.x, b.y) < CONTROL_R + 0.5 + extra
  }

  private nearestRivalDist(f: Footballer) {
    let d = Infinity
    for (const o of this.rivals(f.team)) d = Math.min(d, dist(o.x, o.y, f.x, f.y))
    return d
  }

  // ---------------- Kickoff and restarts ----------------

  /** Everyone back to their half, the ball on the centre spot, `team` to kick off. */
  private kickoff(team: Team) {
    const cy = PITCH_H / 2
    this.owner = null
    this.passTarget = null
    this.flight = 'free'
    this.touchBoost = 0
    this.ball = { x: this.cx, y: cy, z: 0, vx: 0, vy: 0, vz: 0 }
    const r = C.pitch.circleRadius + 1.5
    for (const f of this.players) {
      const p = this.toWorld(f.team, f.baseX, Math.min(f.baseY * 0.92, 0.46))
      f.x = p.x
      f.y = p.y
      // The defending side stays outside the centre circle, in its own half
      if (f.team !== team) {
        const dx = f.x - this.cx
        if (Math.abs(dx) < r) f.y = cy - this.attackDir(f.team) * Math.max(Math.abs(f.y - cy), Math.sqrt(r * r - dx * dx))
      }
      f.vx = f.vy = 0
      f.fx = 0
      f.fy = this.attackDir(f.team)
      f.stun = f.slide = f.dive = f.kickT = f.cooldown = 0
      f.diveDir = 0
      f.model.resetBlend()
    }
    const side = this.teamOf(team)
    const taker = side[10]
    const mate = side[9]
    taker.x = this.cx
    taker.y = cy - this.attackDir(team) * (PLAYER_R + BALL_R + 0.1)
    mate.x = this.cx - this.attackDir(team) * 3
    mate.y = cy - this.attackDir(team) * 0.6
    this.setPiece = { kind: 'kickoff', team, taker, x: this.cx, y: cy, ready: true, wait: 0.5 }
    this.giveBall(taker)
    this.controlled = team === 'home' ? taker : this.homeTeam[10]
    this.freeze = C.match.kickoffFreeze
    this.banner(RESTART_TEXT.kickoff, team === 'home' ? 'Passa para começar' : '', 1.4, '#e0f2fe')
  }

  private restart(kind: RestartKind, team: Team, x: number, y: number) {
    this.owner = null
    this.passTarget = null
    this.flight = 'free'
    this.ball = { x, y, z: 0, vx: 0, vy: 0, vz: 0 }
    let taker = this.keeperOf(team)
    if (kind !== 'goalkick') {
      let bd = Infinity
      for (const f of this.teamOf(team)) {
        const d = dist(f.x, f.y, x, y)
        if (f.role !== 'gk' && f.stun <= 0 && d < bd) {
          bd = d
          taker = f
        }
      }
    }
    this.setPiece = { kind, team, taker, x, y, ready: false, wait: 0.7 + Math.random() * 0.5 }
    if (team === 'home' && taker.role !== 'gk') this.setControlled(taker)
    else this.autoSwitch(true)
    this.charging = false
    audio.whistle()
    this.banner(RESTART_TEXT[kind], '', 1.1, team === 'home' ? HOME_CSS : AWAY_CSS)
  }

  private outOfPlay() {
    const b = this.ball
    const other: Team = this.lastTouch === 'home' ? 'away' : 'home'
    if (b.x < -BALL_R || b.x > PITCH_W + BALL_R) {
      return this.restart('throw', other, b.x < 0 ? 0 : PITCH_W, clamp(b.y, 1, PITCH_H - 1))
    }
    const top = b.y < 0
    // Away defends the top goal, home the bottom one
    const defender: Team = top ? 'away' : 'home'
    const attacker: Team = top ? 'home' : 'away'
    const line = top ? 0 : PITCH_H
    const inward = top ? 1 : -1
    if (this.lastTouch === defender) {
      this.restart('corner', attacker, b.x < this.cx ? 0.4 : PITCH_W - 0.4, line + inward * 0.4)
    } else {
      this.restart('goalkick', defender, this.cx + (b.x < this.cx ? -4 : 4), line + inward * 4.5)
    }
  }

  private updateSetPiece(s: number) {
    const sp = this.setPiece
    if (!sp) return
    const t = sp.taker
    const b = this.ball
    b.vx = b.vy = b.vz = 0
    // Aim: up the pitch at a kickoff or from the keeper, at the penalty spot from a corner, infield otherwise
    let aim: { x: number; y: number }
    if (sp.kind === 'kickoff' || sp.kind === 'keeper' || sp.kind === 'goalkick') aim = { x: 0, y: this.attackDir(sp.team) }
    else if (sp.kind === 'corner') aim = norm(this.cx - sp.x, this.targetLine(sp.team) - this.attackDir(sp.team) * 9 - sp.y)
    else aim = norm(this.cx - sp.x, this.attackDir(sp.team) * 6)

    if (sp.kind === 'keeper') {
      // The keeper holds the ball in his hands
      b.x = t.x + t.fx * 0.35
      b.y = t.y + t.fy * 0.35
      b.z = 1.1
      this.drive(t, 0, 0, s)
    } else {
      b.x = sp.x
      b.y = sp.y
      b.z = 0
      if (!sp.ready) {
        const spot = { x: sp.x - aim.x * (PLAYER_R + BALL_R + 0.1), y: sp.y - aim.y * (PLAYER_R + BALL_R + 0.1) }
        this.steer(t, spot.x, spot.y, SPRINT, s)
        if (dist(t.x, t.y, spot.x, spot.y) < 0.3) {
          sp.ready = true
          t.fx = aim.x
          t.fy = aim.y
          this.giveBall(t)
        }
        return
      }
      t.vx = t.vy = 0
    }
    if (t === this.controlled) {
      // Your set piece: the stick aims, a button plays it
      if (Math.hypot(this.input.x, this.input.y) > 0.3) this.face(t, this.input.x, this.input.y, s * 6)
    } else {
      this.face(t, aim.x, aim.y, s * 6)
      sp.wait -= s
      if (sp.wait <= 0) this.aiRestart(t, sp)
    }
  }

  /** CPU (or your keeper) takes a set piece */
  private aiRestart(t: Footballer, sp: SetPiece) {
    if (sp.kind === 'corner') {
      const attacked: Team = t.team === 'home' ? 'away' : 'home'
      const mates = this.teamOf(t.team).filter((f) => f !== t && this.inOwnBox(attacked, f.x, f.y))
      const r = mates.length ? mates[Math.floor(Math.random() * mates.length)] : null
      const line = this.targetLine(t.team)
      const tx = r ? r.x : this.cx + (Math.random() - 0.5) * 8
      const ty = r ? r.y : line - this.attackDir(t.team) * (6 + Math.random() * 4)
      return this.passBall(t, tx, ty, r, 'lofted')
    }
    const opt = this.bestPass(t, sp.kind === 'goalkick' || sp.kind === 'keeper')
    if (opt) return this.passBall(t, opt.to.x, opt.to.y, opt.to, opt.lofted ? 'lofted' : 'ground')
    this.passBall(t, t.x + (Math.random() - 0.5) * 16, t.y + this.attackDir(t.team) * 25, null, 'lofted')
  }

  // ---------------- Ball control ----------------

  private setControlled(f: Footballer) {
    if (f === this.controlled) return
    this.controlled = f
    this.charging = false
    this.switchTimer = C.switching.interval
  }

  private giveBall(f: Footballer) {
    const prev = this.possessionTeam()
    const b = this.ball
    const incoming = Math.hypot(b.vx - f.vx, b.vy - f.vy)
    this.owner = f
    this.ownerTime = 0
    this.passTarget = null
    this.flight = 'free'
    this.lastTouch = f.team
    this.keeperBeaten = false
    b.vz = 0
    // A hard ball gets away from you a little: a heavier touch, but always the same for the same pass
    this.touchBoost = clamp((incoming - C.control.cleanSpeed) * 0.05, 0, 0.6)
    if (f.team === 'home' && f.role !== 'gk') {
      this.setControlled(f)
      const n = norm(this.input.x, this.input.y)
      if (n.d > 0.3 && !this.setPiece) {
        // Directed first touch: turn straight onto the stick and push the ball into that space
        f.fx = n.x
        f.fy = n.y
        this.touchBoost += 0.35
      }
    } else if (f.team === 'away' && prev !== 'away') this.autoSwitch(false)
  }

  /** Hands control to the teammate best placed to defend, with hysteresis so it doesn't flicker. */
  private autoSwitch(always: boolean) {
    const n = this.bestDefender(this.controlled)
    if (!n) return
    if (always || this.defenderScore(this.controlled) > this.defenderScore(n) + C.switching.hysteresis) this.setControlled(n)
  }

  /** Lower is better: distance to the dribbler or the ball's path, plus a penalty for being the wrong side of it */
  private defenderScore(f: Footballer) {
    const target = this.owner ?? this.intercept(f)
    const goalSide = f.y > target.y
    return dist(f.x, f.y, target.x, target.y) + (goalSide ? 0 : 3)
  }

  private bestDefender(skip: Footballer | null) {
    let best: Footballer | null = null
    let bs = Infinity
    for (const f of this.homeTeam) {
      if (f === skip || f.role === 'gk' || f.stun > 0) continue
      const s = this.defenderScore(f)
      if (s < bs) {
        bs = s
        best = f
      }
    }
    return best
  }

  /** Defending: take over the teammate best placed to win the ball. */
  private switchPlayer() {
    const best = this.bestDefender(this.controlled)
    if (best) {
      this.setControlled(best)
      audio.click()
    }
  }

  private kickBall(f: Footballer, vx: number, vy: number, vz: number, flight: 'pass' | 'shot') {
    const b = this.ball
    this.owner = null
    this.setPiece = null
    this.passTarget = null
    this.flight = flight
    this.sinceKick = 0
    this.touchBoost = 0
    if (b.z > 0.9 && f.role === 'gk') b.z = 0.9
    b.vx = vx
    b.vy = vy
    b.vz = vz
    // Start the ball just ahead of the kicker so his own body doesn't block it
    const n = norm(vx, vy)
    b.x = f.x + n.x * (PLAYER_R + BALL_R + 0.05)
    b.y = f.y + n.y * (PLAYER_R + BALL_R + 0.05)
    f.cooldown = C.pass.cooldown
    f.kickT = 0.35
    f.fx = n.x || f.fx
    f.fy = n.y || f.fy
    this.lastTouch = f.team
    this.lastKicker = f
    this.keeperBeaten = false
    this.charging = false
    this.buffered = null
  }

  /** Passes toward (tx, ty); a lofted pass flies over defenders, a through ball rolls into space */
  private passBall(f: Footballer, tx: number, ty: number, receiver: Footballer | null, kind: 'ground' | 'lofted' | 'through') {
    const b = this.ball
    let x = tx
    let y = ty
    // Lead a moving receiver
    if (receiver && kind !== 'through') {
      const lead = dist(b.x, b.y, tx, ty) / (kind === 'lofted' ? 16 : 18)
      x += receiver.vx * lead * 0.8
      y += receiver.vy * lead * 0.8
    }
    x = clamp(x, 1, PITCH_W - 1)
    y = clamp(y, 0.5, PITCH_H - 0.5)
    const n = norm(x - b.x, y - b.y)
    let dir = Math.atan2(n.y, n.x)
    // CPU passes get more accurate with the division
    if (f.team === 'away') dir += (Math.random() - 0.5) * byLevel(C.ai.passError, this.level)
    const ux = Math.cos(dir)
    const uy = Math.sin(dir)
    if (kind === 'lofted') {
      const T = clamp(0.55 + n.d / 32, 0.75, 1.7)
      const vh = (n.d * 0.85) / T
      this.kickBall(f, ux * vh, uy * vh, (C.ball.gravity * T) / 2, 'pass')
      audio.kick(0.6)
    } else {
      // Rolling with exponential friction loses rollFriction m/s per metre: arrive with a few m/s left
      const arrive = kind === 'through' ? C.pass.throughArrive : C.pass.arrive
      const v = clamp(C.ball.rollFriction * n.d + arrive, C.pass.minSpeed, C.pass.maxSpeed)
      this.kickBall(f, ux * v, uy * v, 0, 'pass')
      audio.kick(0.35)
    }
    this.passTarget = receiver
    if (receiver && receiver.team === 'home') this.setControlled(receiver)
  }

  /**
   * Shoots at goal. `aim` is [-1, 1] across the goal mouth, or null to let the player pick a side;
   * `lift` -1 drives it low, 1 chips it. Spray grows with power past the sweet spot, distance,
   * pressure, running speed, an awkward body angle and the weaker foot.
   */
  private shoot(f: Footballer, power: number, aim: number | null, lift: number) {
    const S = C.shot
    const b = this.ball
    const line = this.targetLine(f.team)
    const k = this.keeperOf(f.team === 'home' ? 'away' : 'home')
    const side = aim ?? (k.x < this.cx ? 1 : -1) * (0.45 + Math.random() * 0.55)
    const tx = this.cx + side * (GOAL_W / 2 - 0.45)
    const d = dist(b.x, b.y, tx, line)
    const dirN = norm(tx - b.x, line - b.y)
    const pressure = this.nearestRivalDist(f)
    const body = (1 - (f.fx * dirN.x + f.fy * dirN.y)) / 2
    // Across the body to the weaker side is harder: e.g. a right-footer shooting far to his left
    const across = (tx - b.x) * -this.attackDir(f.team)
    const weak = Math.sign(across) === -f.foot && Math.abs(across) > 3 ? 1 : 0
    const over = Math.max(0, power - S.sweetMax) / (1 - S.sweetMax)
    let spread =
      S.error +
      power * S.errorPerPower +
      d * S.errorPerMetre +
      over * S.errorOverpower +
      (Math.max(0, 2.5 - pressure) / 2.5) * S.errorPressure +
      (Math.hypot(f.vx, f.vy) / SPRINT) * S.errorRunning +
      body * S.errorBody +
      weak * S.errorWeakFoot
    if (power >= S.sweetMin && power <= S.sweetMax) spread *= 0.75
    if (f.team === 'away') spread *= byLevel(C.ai.shotError, this.level)
    const dir = Math.atan2(dirN.y, dirN.x) + spread * (Math.random() * 2 - 1)
    let speed = lerp(S.minSpeed, S.maxSpeed, power)
    let vz = 0.5 + power * power * 7.5 + d * 0.04
    if (lift < 0) vz *= 0.6
    if (lift > 0) {
      vz *= 1.6
      speed *= 0.75
    }
    this.kickBall(f, Math.cos(dir) * speed, Math.sin(dir) * speed, vz, 'shot')
    audio.kick(0.6 + power * 0.4)
    if (f.team === 'home') haptic(15)
    this.burstAt(b.x, b.y, 0.4, f.team === 'home' ? HOME_CSS : AWAY_CSS, 10)
  }

  /** Stick across = aim across the goal mouth (home shoots up the screen) */
  private aimFromInput() {
    return Math.abs(this.input.x) > 0.25 ? clamp(this.input.x * 1.3, -1, 1) : null
  }

  /** Stick toward goal drives the shot low, pulled back chips it */
  private liftFromInput() {
    const toward = -this.input.y
    return toward > 0.6 && Math.abs(this.input.x) < 0.5 ? -1 : toward < -0.6 ? 1 : 0
  }

  private humanDir(f: Footballer) {
    const n = norm(this.input.x, this.input.y)
    return n.d > 0.3 ? n : { x: f.fx, y: f.fy, d: 0 }
  }

  private humanPass(f: Footballer, through: boolean) {
    const dir = this.humanDir(f)
    if (dir.d === 0 && !through) {
      // No direction: the safest useful option, not whoever happens to be behind you
      const opt = this.bestPass(f, false)
      if (opt) return this.passBall(f, opt.to.x, opt.to.y, opt.to, opt.lofted ? 'lofted' : 'ground')
    }
    const r = this.pickReceiver(f, dir.x, dir.y, through)
    if (!r) {
      // Nobody that way: play it into space
      const len = through ? 16 : 11
      this.passBall(f, f.x + dir.x * len, f.y + dir.y * len, null, 'ground')
      return
    }
    const d = dist(f.x, f.y, r.x, r.y)
    if (through) {
      // Into the space ahead of the runner, toward goal, scaled by how fast he's going
      const ahead = norm(dir.x * 0.4, this.attackDir('home') + dir.y * 0.4)
      const lead = C.pass.throughLead * (0.6 + 0.4 * Math.min(1, Math.hypot(r.vx, r.vy) / RUN))
      let tx = r.x + ahead.x * lead + r.vx * 0.4
      let ty = r.y + ahead.y * lead + r.vy * 0.4
      const span = norm(tx - f.x, ty - f.y)
      const max = d + C.pass.throughMax
      if (span.d > max) {
        tx = f.x + span.x * max
        ty = f.y + span.y * max
      }
      this.passBall(f, tx, ty, r, d > C.pass.loftDistance ? 'lofted' : 'through')
    } else {
      this.passBall(f, r.x, r.y, r, d > C.pass.loftDistance ? 'lofted' : 'ground')
    }
  }

  private humanCross(f: Footballer) {
    const dir = this.humanDir(f)
    let r: Footballer | null = null
    let bs = -Infinity
    for (const m of this.homeTeam) {
      if (m === f || !this.inOwnBox('away', m.x, m.y)) continue
      const n = norm(m.x - f.x, m.y - f.y)
      const s = n.x * dir.x + n.y * dir.y
      if (s > bs) {
        bs = s
        r = m
      }
    }
    if (r) this.passBall(f, r.x, r.y, r, 'lofted')
    else this.passBall(f, this.cx, 9, null, 'lofted')
  }

  /** The teammate in the direction you're pointing who is easiest to find. */
  private pickReceiver(f: Footballer, dx: number, dy: number, through: boolean) {
    let best: Footballer | null = null
    let bs = -Infinity
    const fwd = this.attackDir(f.team)
    for (const t of this.teamOf(f.team)) {
      if (t === f) continue
      const n = norm(t.x - f.x, t.y - f.y)
      if (n.d < 2 || n.d > 45) continue
      const align = n.x * dx + n.y * dy
      if (align < C.pass.cone) continue
      let lane = 6
      for (const o of this.rivals(f.team)) lane = Math.min(lane, segDist(o.x, o.y, f.x, f.y, t.x, t.y))
      const free = Math.min(6, this.nearestRivalDist(t))
      const progress = ((t.y - f.y) * fwd) / 10
      let s = align * 4 - n.d * 0.05 + free * 0.15 + lane * 0.2 - (t.role === 'gk' ? 3 : 0)
      if (through) s += progress
      if (s > bs) {
        bs = s
        best = t
      }
    }
    return best
  }

  /** The most useful open teammate for a pass, or null if nobody is worth it */
  private bestPass(f: Footballer, allowLong: boolean) {
    let best: { to: Footballer; score: number; lofted: boolean } | null = null
    const me = this.toAttack(f.team, f.x, f.y)
    for (const t of this.teamOf(f.team)) {
      if (t === f || t.role === 'gk') continue
      const d = dist(f.x, f.y, t.x, t.y)
      if (d < 5 || d > (allowLong ? 45 : 32)) continue
      let lane = Infinity
      for (const o of this.rivals(f.team)) lane = Math.min(lane, segDist(o.x, o.y, f.x, f.y, t.x, t.y))
      const free = this.nearestRivalDist(t)
      const lofted = lane < 1.6 && (d > 16 || allowLong) && free > 3
      if (lane < 1.6 && !lofted) continue
      const progress = (this.toAttack(f.team, t.x, t.y).ay - me.ay) * PITCH_H
      const score = progress * 0.12 + Math.min(lane, 4) * 0.4 + Math.min(free, 7) * 0.4 - d * 0.03 - (lofted ? 0.6 : 0)
      if (!best || score > best.score) best = { to: t, score, lofted }
    }
    return best
  }

  /** A through ball for a forward with space in behind, if there is one */
  private bestThrough(f: Footballer) {
    const fwd = this.attackDir(f.team)
    for (const t of this.teamOf(f.team)) {
      if (t === f || t.role !== 'fwd') continue
      const x = clamp(t.x + t.vx * 0.4, 3, PITCH_W - 3)
      const y = t.y + fwd * 7
      if ((this.targetLine(f.team) - y) * fwd < 4) continue
      let lane = Infinity
      let near = Infinity
      for (const o of this.rivals(f.team)) {
        lane = Math.min(lane, segDist(o.x, o.y, f.x, f.y, x, y))
        if (o.role !== 'gk') near = Math.min(near, dist(o.x, o.y, x, y))
      }
      if (lane > 1.8 && near > 4) return { to: t, x, y }
    }
    return null
  }

  private slideTackle(f: Footballer, dx: number, dy: number) {
    if (f.slide > 0 || f.stun > 0) return
    const n = norm(dx, dy)
    const dir = n.d > 0.3 ? n : { x: f.fx, y: f.fy }
    f.slide = C.tackle.slideTime
    f.slideX = dir.x
    f.slideY = dir.y
    f.fx = dir.x
    f.fy = dir.y
    f.vx = dir.x * C.tackle.slideSpeed
    f.vy = dir.y * C.tackle.slideSpeed
    audio.whiff()
  }

  // ---------------- Simulation ----------------

  private step(s: number) {
    this.time += s
    for (const f of this.players) f.kickT = Math.max(0, f.kickT - s)
    this.netBulge[0] = Math.max(0, this.netBulge[0] - s * 1.8)
    this.netBulge[1] = Math.max(0, this.netBulge[1] - s * 1.8)

    if (this.freeze > 0) {
      this.freeze -= s
      if (this.freeze <= 0) audio.whistle()
      return
    }

    if (this.goalTimer > 0) {
      this.goalTimer -= s
      this.celebrate(s)
      this.moveBall(s)
      if (this.goalTimer <= 0) {
        if (this.clock >= C.match.time) return this.fullTime()
        if (this.half === 1 && this.clock >= C.match.time / 2) return this.halfTime()
        this.kickoff(this.scorer === 'home' ? 'away' : 'home')
      }
      return
    }

    this.clock += s
    if (this.clock >= C.match.time) return this.fullTime()
    if (this.half === 1 && this.clock >= C.match.time / 2) return this.halfTime()

    const poss = this.possessionTeam()
    if (poss === 'home') this.possHome += s
    else if (poss === 'away') this.possAway += s
    this.ownerTime += s
    this.sinceKick += s
    this.touchBoost = Math.max(0, this.touchBoost - s * 1.2)
    if (this.charging) this.charge = Math.min(1, this.charge + s / C.shot.charge)

    // Defending with someone miles from the ball: hand you someone closer
    this.switchTimer -= s
    if (this.switchTimer <= 0 && poss !== 'home') {
      this.switchTimer = C.switching.interval
      this.autoSwitch(false)
    }

    for (const f of this.players) {
      f.cooldown = Math.max(0, f.cooldown - s)
      f.tackleCd = Math.max(0, f.tackleCd - s)
      if (f.stun > 0) {
        f.stun -= s
        if (f.stun <= 0) f.diveDir = 0
      }
    }

    this.pickChasers(poss)
    for (const f of this.players) this.think(f, poss, s)
    this.separate()
    this.updateSetPiece(s)
    if (this.mode !== 'playing') return
    this.moveBall(s)
    if (this.goalTimer > 0 || this.setPiece?.ready === false) return
    this.saves()
    this.collect()
    this.tackles()
    this.runBuffer(s)
  }

  /**
   * Who goes for the ball. The CPU presses with its nearest player and, from a higher division,
   * sends the next one to cover behind him. Your AI teammates help when you hold press, when a
   * loose ball is theirs, or when an attacker runs right at them.
   */
  private pickChasers(poss: Team | null) {
    this.chasing.clear()
    this.coverer = null
    if (this.setPiece) return
    const b = this.ball
    for (const team of ['home', 'away'] as const) {
      if (poss === team) continue
      let first: Footballer | null = null
      let second: Footballer | null = null
      let d1 = Infinity
      let d2 = Infinity
      for (const f of this.teamOf(team)) {
        if (f.role === 'gk' || f === this.controlled || f.stun > 0 || f === this.owner) continue
        const d = dist(f.x, f.y, b.x, b.y)
        if (d < d1) {
          second = first
          d2 = d1
          first = f
          d1 = d
        } else if (d < d2) {
          second = f
          d2 = d
        }
      }
      if (!first) continue
      if (team === 'away') {
        this.chasing.add(first)
        if (this.level >= C.ai.coverFrom && this.owner && second) this.coverer = second
      } else {
        const me = dist(this.controlled.x, this.controlled.y, b.x, b.y)
        if (this.held.through || (poss === null && d1 < me - 1) || d1 < 3) this.chasing.add(first)
      }
    }
  }

  private think(f: Footballer, poss: Team | null, s: number) {
    if (f.slide > 0) return this.sliding(f, s)
    if (f.dive > 0) return this.diving(f, s)
    if (f.stun > 0) return this.drive(f, 0, 0, s)
    if (this.setPiece?.taker === f) return
    if (f.role === 'gk') return this.keeper(f, s)
    if (f === this.controlled) return this.human(f, s)
    if (f === this.owner) return this.cpuOwner(f, s)
    if (f === this.passTarget) return this.receive(f, s)
    if (this.chasing.has(f)) return this.chase(f, s)
    if (f === this.coverer) return this.cover(f, s)
    this.support(f, poss, s)
  }

  /**
   * Moves toward a target velocity. Speeding up, braking and turning sharply each have their own
   * rate, so starts feel quick, stops feel planted and cuts don't skate.
   */
  private drive(f: Footballer, vx: number, vy: number, s: number) {
    const P = C.player
    const cur = Math.hypot(f.vx, f.vy)
    const want = Math.hypot(vx, vy)
    let rate: number = P.accel
    if (want < cur - 0.3) rate = P.brake
    if (cur > 1 && want > 1 && (f.vx * vx + f.vy * vy) / (cur * want) < 0.35) rate = P.turn
    if (this.owner === f) rate *= 0.85
    const k = Math.min(1, s * rate)
    f.vx += (vx - f.vx) * k
    f.vy += (vy - f.vy) * k
    f.x = clamp(f.x + f.vx * s, -2.5, PITCH_W + 2.5)
    f.y = clamp(f.y + f.vy * s, -1.5, PITCH_H + 1.5)
    const sp = Math.hypot(f.vx, f.vy)
    if (sp > 0.5) this.face(f, f.vx, f.vy, s * (this.owner === f ? P.faceRateBall : P.faceRate))
    f.phase += sp * s * P.stride
    // Opponents keep their distance at set pieces
    const sp2 = this.setPiece
    if (sp2 && f.team !== sp2.team) {
      const r = sp2.kind === 'throw' ? 3 : 8
      const n = norm(f.x - this.ball.x, f.y - this.ball.y)
      if (n.d < r && n.d > 0) {
        f.x = this.ball.x + n.x * r
        f.y = this.ball.y + n.y * r
      }
    }
  }

  /** Turns the facing toward (dx, dy) by at most `rate` radians */
  private face(f: Footballer, dx: number, dy: number, rate: number) {
    const a = Math.atan2(f.fy, f.fx)
    let diff = Math.atan2(dy, dx) - a
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    const na = a + clamp(diff, -rate, rate)
    f.fx = Math.cos(na)
    f.fy = Math.sin(na)
  }

  private steer(f: Footballer, tx: number, ty: number, speed: number, s: number) {
    const n = norm(tx - f.x, ty - f.y)
    // Ease off on arrival so nobody jitters around their spot
    const v = speed * Math.min(1, n.d / 1.5)
    this.drive(f, n.x * v, n.y * v, s)
  }

  private faceBall(f: Footballer, s: number) {
    if (Math.hypot(f.vx, f.vy) < 1.5) this.face(f, this.ball.x - f.x, this.ball.y - f.y, s * 5)
  }

  /** Top speed with stamina: sprinting drains it, everything else lets it recover */
  private topSpeed(f: Footballer, sprint: boolean, s: number) {
    const S = C.stamina
    if (sprint && f.stamina > 0.05 && Math.hypot(f.vx, f.vy) > 2) {
      f.stamina = Math.max(0, f.stamina - s * S.drain)
      return lerp(RUN, SPRINT, Math.min(1, f.stamina / S.tired)) * f.pace
    }
    f.stamina = Math.min(1, f.stamina + s * S.recover)
    return RUN * f.pace
  }

  private cpuPace() {
    return byLevel(C.ai.pace, this.level)
  }

  /** Holding pass while defending: shadow the dribbler goal-side instead of diving in */
  private containing() {
    return (
      this.held.pass && this.time - this.passDownAt > C.switching.containHold && !!this.owner && this.owner.team === 'away'
    )
  }

  private human(f: Footballer, s: number) {
    // A pass on its way to you: run onto it until you take over with the stick
    if (this.passTarget === f && Math.hypot(this.input.x, this.input.y) < 0.2) return this.receive(f, s)
    if (this.containing()) {
      const o = this.owner!
      const goal = norm(this.cx - o.x, PITCH_H - o.y)
      const tx = o.x + goal.x * C.switching.containGap
      const ty = o.y + goal.y * C.switching.containGap
      this.steer(f, tx, ty, this.topSpeed(f, this.held.sprint, s), s)
      this.face(f, o.x - f.x, o.y - f.y, s * 10)
      return
    }
    const top = this.topSpeed(f, this.held.sprint, s) * (this.owner === f ? C.player.dribble : 1)
    this.drive(f, this.input.x * top, this.input.y * top, s)
    if (Math.hypot(this.input.x, this.input.y) < 0.1) this.faceBall(f, s)
  }

  /** The CPU on the ball: what to do, read from the situation without changing anything */
  private decideOwner(f: Footballer): Intent {
    const line = this.targetLine(f.team)
    const dg = dist(f.x, f.y, this.cx, line)
    const pressure = this.nearestRivalDist(f)
    const angleOk = Math.abs(f.x - this.cx) < dg * 0.75 + 2
    // Per-player temperament: some shoot from further out than others
    const greed = 0.75 + f.quirk * 0.5
    if (angleOk && (dg < 11 || (dg < 22 * greed && Math.random() < 0.16 + this.level * 0.02))) {
      return { kind: 'shoot', power: clamp(0.35 + Math.random() * 0.35 + dg * 0.008, 0, C.shot.sweetMax + 0.05) }
    }
    const through = this.bestThrough(f)
    if (through && Math.random() < 0.35) return { kind: 'through', to: through.to, x: through.x, y: through.y }
    const opt = this.bestPass(f, false)
    if (opt && (pressure < 2.4 || (opt.score > 2.4 && Math.random() < 0.35) || Math.random() < 0.06)) {
      return { kind: 'pass', to: opt.to, lofted: opt.lofted }
    }
    return { kind: 'dribble' }
  }

  private cpuOwner(f: Footballer, s: number) {
    f.think -= s
    if (f.think <= 0 && this.ownerTime > 0.25) {
      f.think = C.ai.think + Math.random() * C.ai.thinkJitter
      const intent = this.decideOwner(f)
      if (intent.kind === 'shoot') return this.shoot(f, intent.power, null, 0)
      if (intent.kind === 'pass') return this.passBall(f, intent.to.x, intent.to.y, intent.to, intent.lofted ? 'lofted' : 'ground')
      if (intent.kind === 'through') return this.passBall(f, intent.x, intent.y, intent.to, 'through')
    }
    // Dribble toward goal, bending away from defenders in the way and off the touchlines
    const line = this.targetLine(f.team)
    const g = norm(this.cx - f.x, line - f.y)
    let dx = g.x
    let dy = g.y
    for (const o of this.rivals(f.team)) {
      const n = norm(o.x - f.x, o.y - f.y)
      if (n.d > 6 || n.d === 0) continue
      const ahead = n.x * g.x + n.y * g.y
      if (ahead < 0.2) continue
      const side = n.x * -g.y + n.y * g.x > 0 ? -1 : 1
      const w = ((6 - n.d) / 6) * 1.6 * ahead
      dx += -g.y * side * w
      dy += g.x * side * w
    }
    if (f.x < 5) dx += (5 - f.x) * 0.3
    if (f.x > PITCH_W - 5) dx -= (f.x - (PITCH_W - 5)) * 0.3
    const n = norm(dx, dy)
    const free = this.nearestRivalDist(f) > 5 && f.stamina > 0.3
    const top = this.topSpeed(f, free, s) * C.player.dribble * this.cpuPace()
    this.drive(f, n.x * top, n.y * top, s)
  }

  /** Best place to meet the ball: the first point on its path this player can get to in time */
  private intercept(f: Footballer) {
    const b = this.ball
    const speed = RUN * f.pace
    const k = b.z > 0.3 ? C.ball.airDrag : C.ball.rollFriction
    let px = b.x
    let py = b.y
    for (let t = 0.05; t <= 2.5; t += 0.05) {
      const m = (1 - Math.exp(-k * t)) / k
      px = b.x + b.vx * m
      py = b.y + b.vy * m
      if (dist(px, py, f.x, f.y) - CONTROL_R <= speed * t) break
    }
    return { x: clamp(px, -1, PITCH_W + 1), y: clamp(py, -1, PITCH_H + 1) }
  }

  private receive(f: Footballer, s: number) {
    const p = this.intercept(f)
    const d = dist(p.x, p.y, f.x, f.y)
    this.steer(f, p.x, p.y, this.topSpeed(f, d > 6, s), s)
    this.faceBall(f, s)
  }

  private chase(f: Footballer, s: number) {
    const o = this.owner
    let tx: number
    let ty: number
    if (o) {
      // Close down on the goal side of the dribbler
      const back = this.attackDir(o.team)
      tx = o.x + o.vx * 0.25
      ty = o.y + o.vy * 0.25 + back * 0.5
      const d = dist(f.x, f.y, o.x, o.y)
      if (f.team === 'away' && d > 1.4 && d < 2.6 && Math.random() < 0.0012 * Math.min(4, this.level)) {
        return this.slideTackle(f, o.x - f.x, o.y - f.y)
      }
    } else {
      const p = this.intercept(f)
      tx = p.x
      ty = p.y
    }
    const d = dist(f.x, f.y, tx, ty)
    const pace = f.team === 'away' ? this.cpuPace() : 1
    this.steer(f, tx, ty, this.topSpeed(f, d > 4, s) * pace, s)
  }

  /** Second defender: sits between the ball and goal behind the presser, closing the middle */
  private cover(f: Footballer, s: number) {
    const b = this.ball
    const own = f.team === 'home' ? PITCH_H : 0
    const n = norm(this.cx - b.x, own - b.y)
    const tx = b.x + n.x * 5
    const ty = b.y + n.y * 5
    this.steer(f, tx, ty, this.topSpeed(f, dist(f.x, f.y, tx, ty) > 6, s) * this.cpuPace(), s)
    this.faceBall(f, s)
  }

  /** Off the ball: hold a shape that slides with the ball, mark nearby attackers when defending */
  private support(f: Footballer, poss: Team | null, s: number) {
    const b = this.toAttack(f.team, this.ball.x, this.ball.y)
    const att = poss === f.team
    const def = poss !== null && !att
    let ay = f.baseY + (b.ay - 0.45) * 0.62 + (att ? 0.1 : def ? -0.04 : 0)
    if (f.role === 'fwd' && att) ay += 0.05
    // Fullbacks overlap on the ball's side
    if (att && f.role === 'def' && f.wide && Math.sign(f.baseX - 0.5) === Math.sign(b.ax - 0.5)) ay += 0.12
    if (def && f.role !== 'fwd') ay = Math.min(ay, b.ay - (f.role === 'def' ? 0.06 : 0.01))
    const range = { def: [0.06, 0.66], mid: [0.16, 0.84], fwd: [0.3, 0.93], gk: [0, 0.2] }[f.role]
    ay = clamp(ay, range[0], range[1])
    let ax = f.baseX + (b.ax - 0.5) * 0.45
    // Width when attacking (wide players hug the line), a compact block when defending
    ax = 0.5 + (ax - 0.5) * (att ? (f.wide ? 1.22 : 1.08) : def ? 0.8 : 1)
    // Runs off the ball, each player on his own rhythm
    if (att) ax += Math.sin(this.time * (0.45 + f.quirk * 0.3) + f.quirk * 6) * 0.05
    if (att) {
      // Stay level with the last defender: there's no offside flag, but it keeps the shape honest
      let last = 0
      for (const o of this.rivals(f.team)) if (o.role !== 'gk') last = Math.max(last, this.toAttack(f.team, o.x, o.y).ay)
      ay = Math.min(ay, Math.max(last, b.ay) + 0.01)
    }
    ax = clamp(ax, 0.04, 0.96)
    let { x: tx, y: ty } = this.toWorld(f.team, ax, ay)

    if (def && f.role !== 'fwd') {
      // Pick up the nearest attacker in this zone, staying goal-side of him
      let mark: Footballer | null = null
      let md = 9
      for (const o of this.rivals(f.team)) {
        if (o === this.owner || o.role === 'gk') continue
        const d = dist(o.x, o.y, tx, ty)
        if (d < md) {
          md = d
          mark = o
        }
      }
      if (mark) {
        const back = -this.attackDir(f.team)
        tx = lerp(tx, mark.x, 0.55)
        ty = lerp(ty, mark.y + back * 1.6, 0.55)
      }
    }
    // Don't crowd the ball: the dribbler's teammates keep at least 6 m away to offer a pass
    const o = this.owner
    if (att && o && o !== f) {
      const n = norm(tx - o.x, ty - o.y)
      if (n.d < 6) {
        tx = o.x + (n.d > 0 ? n.x : f.baseX < 0.5 ? -1 : 1) * 6
        ty = o.y + n.y * 6
      }
    }
    const d = dist(f.x, f.y, tx, ty)
    const speed = d > 6 ? RUN * 0.95 : Math.max(1.2, d * 1.1)
    this.steer(f, tx, ty, Math.min(speed, this.topSpeed(f, d > 14, s)), s)
    this.faceBall(f, s)
  }

  /** [home, CPU at division 1, CPU step, CPU limit] → the value for this keeper */
  private keeperStat(stat: readonly [number, number, number, number], k: Footballer) {
    return k.team === 'home' ? stat[0] : byLevel([stat[1], stat[2], stat[3]], this.level)
  }

  private keeper(k: Footballer, s: number) {
    if (this.owner === k) {
      // Picked the ball up outside the box: just move it on
      const opt = this.bestPass(k, true)
      if (opt) return this.passBall(k, opt.to.x, opt.to.y, opt.to, opt.lofted ? 'lofted' : 'ground')
      return this.passBall(k, this.cx, PITCH_H / 2, null, 'lofted')
    }
    const home = k.team === 'home'
    const line = home ? PITCH_H : 0
    const b = this.ball
    const speed = RUN * (home ? 1 : this.cpuPace())

    // A shot coming in, once he's read it: get across, or dive if there's no time
    const reaction = this.keeperStat(C.keeper.reaction, k)
    const incoming =
      this.ballState() === 'shot' && (home ? b.vy > 6 : b.vy < -6) && !this.keeperBeaten && this.lastTouch !== k.team
    if (incoming && this.sinceKick > reaction) {
      const t = (k.y - b.y) / b.vy
      if (t > 0 && t < 1.6) {
        const px = b.x + b.vx * t
        if (Math.abs(px - this.cx) < GOAL_W / 2 + 1.5) {
          const gap = px - k.x
          if (Math.abs(gap) > 0.7 && t < 0.55) {
            k.dive = C.keeper.diveTime
            k.diveDir = Math.sign(gap)
            k.vx = Math.sign(gap) * Math.min(C.keeper.diveSpeed, (Math.abs(gap) / Math.max(t, 0.15)) * 1.1)
            k.vy = 0
            return
          }
          this.steer(k, px, k.y, SPRINT, s)
          this.face(k, b.x - k.x, b.y - k.y, s * 6)
          return
        }
      }
    }

    // Come out for a loose ball in the box
    if (!this.owner && !this.setPiece && this.inOwnBox(k.team, b.x, b.y)) {
      let mine = true
      const dk = dist(k.x, k.y, b.x, b.y)
      for (const f of this.players) if (f !== k && dist(f.x, f.y, b.x, b.y) < dk) mine = false
      if (mine || Math.hypot(b.vx, b.vy) < 7) {
        const p = this.intercept(k)
        if (this.inOwnBox(k.team, p.x, p.y)) return this.steer(k, p.x, p.y, SPRINT, s)
      }
    }

    // Narrow the angle: on the line from the middle of the goal to the ball
    const v = norm(b.x - this.cx, b.y - line)
    const out = clamp(v.d * 0.1, 0.8, this.possessionTeam() === k.team ? 5 : 2.6)
    const tx = clamp(this.cx + v.x * out, this.cx - GOAL_W / 2 - 0.4, this.cx + GOAL_W / 2 + 0.4)
    const ty = line + v.y * out
    this.steer(k, tx, ty, speed, s)
    this.faceBall(k, s)
  }

  private diving(k: Footballer, s: number) {
    k.dive -= s
    k.vx *= Math.exp(-2.5 * s)
    k.x = clamp(k.x + k.vx * s, -1, PITCH_W + 1)
    if (k.dive <= 0) {
      k.vx = 0
      k.stun = 0.7
    }
  }

  private sliding(f: Footballer, s: number) {
    f.slide -= s
    const decay = Math.exp(-2.6 * s)
    f.vx *= decay
    f.vy *= decay
    f.x = clamp(f.x + f.vx * s, -2.5, PITCH_W + 2.5)
    f.y = clamp(f.y + f.vy * s, -1.5, PITCH_H + 1.5)
    const b = this.ball
    const footX = f.x + f.slideX * 0.6
    const footY = f.y + f.slideY * 0.6
    if (b.z < 0.5 && f.cooldown <= 0 && !this.setPiece && dist(footX, footY, b.x, b.y) < 0.8 && this.owner?.team !== f.team) {
      const victim = this.owner
      if (victim) victim.stun = C.tackle.victimDown
      this.owner = null
      this.passTarget = null
      this.flight = 'free'
      b.vx = f.slideX * 7 + (Math.random() - 0.5) * 3
      b.vy = f.slideY * 7 + (Math.random() - 0.5) * 3
      b.vz = 0.8
      this.lastTouch = f.team
      this.keeperBeaten = false
      f.cooldown = 0.25
      audio.kick(0.45)
      if (victim) {
        this.banner('CARRINHO!', '', 0.8, f.team === 'home' ? HOME_CSS : AWAY_CSS)
        haptic(25)
      }
    }
    if (f.slide <= 0) f.stun = C.tackle.getUp
  }

  private celebrate(s: number) {
    const hero = this.lastKicker?.team === this.scorer ? this.lastKicker : this.teamOf(this.scorer)[10]
    for (const f of this.players) {
      if (f.slide > 0) this.sliding(f, s)
      else if (f.dive > 0) this.diving(f, s)
      else if (f === hero) {
        // Off to the corner flag
        const cornerX = f.x < this.cx ? 0.5 : PITCH_W - 0.5
        this.steer(f, cornerX, this.targetLine(f.team) - this.attackDir(f.team) * 1.5, RUN, s)
      } else if (f.team === this.scorer && f.role !== 'gk') {
        this.steer(f, hero.x, hero.y + 1.5, RUN * 0.9, s)
      } else this.drive(f, 0, 0, s)
    }
    this.separate()
  }

  /** Keeps players from overlapping: a soft push-apart, never a shove */
  private separate() {
    const fs = this.players
    const min = PLAYER_R * 2
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i]
        const b = fs[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue
        const n = norm(dx, dy)
        const overlap = min - n.d
        if (overlap <= 0 || n.d === 0) continue
        // The player on the ball gives less ground: he shields it with his body
        const wa = a === this.owner ? 0.2 : b === this.owner ? 0.8 : 0.5
        a.x -= n.x * overlap * wa
        a.y -= n.y * overlap * wa
        b.x += n.x * overlap * (1 - wa)
        b.y += n.y * overlap * (1 - wa)
      }
    }
  }

  private moveBall(s: number) {
    const b = this.ball
    const o = this.owner
    if (this.setPiece) return
    if (o) {
      // Dribbling: the ball runs a touch ahead of the feet, nudged forward every stride.
      // Sprinting knocks it further ahead, which is faster but easier to nick.
      const CT = C.control
      const sp = Math.hypot(o.vx, o.vy)
      const nudge = CT.touchNudge * (0.5 + 0.5 * Math.sin(o.phase)) * Math.min(1, sp / RUN)
      const sprinting = Math.max(0, sp - RUN) / (SPRINT - RUN)
      const ahead = PLAYER_R + BALL_R + CT.touchBase + sprinting * CT.touchSprint + nudge + this.touchBoost
      const k = Math.min(1, s * 16)
      b.x += (o.x + o.fx * ahead - b.x) * k
      b.y += (o.y + o.fy * ahead - b.y) * k
      b.z = 0
      b.vx = o.vx
      b.vy = o.vy
      b.vz = 0
      if (b.x < -BALL_R || b.x > PITCH_W + BALL_R || b.y < -BALL_R || b.y > PITCH_H + BALL_R) {
        this.owner = null
        this.lastTouch = o.team
        this.outOfPlay()
      }
      return
    }

    const prevY = b.y
    b.vz -= C.ball.gravity * s
    b.z += b.vz * s
    if (b.z <= 0) {
      b.z = 0
      if (b.vz < -C.ball.minBounce) {
        if (b.vz < -4) audio.bounce()
        b.vz = -b.vz * C.ball.restitution
      } else b.vz = 0
    }
    const decay = Math.exp(-(b.z > 0.02 ? C.ball.airDrag : C.ball.rollFriction) * s)
    b.vx *= decay
    b.vy *= decay
    b.x += b.vx * s
    b.y += b.vy * s
    // A pass or shot that has died is just a loose ball
    if (this.flight !== 'free' && Math.hypot(b.vx, b.vy) < 3 && b.z < 0.1) {
      this.flight = 'free'
      this.passTarget = null
    }

    if (this.goalTimer > 0) return this.inNet()

    for (const line of [0, PITCH_H]) {
      const crossed = line === 0 ? prevY >= 0 && b.y < 0 : prevY <= PITCH_H && b.y > PITCH_H
      if (!crossed) continue
      const dx = Math.abs(b.x - this.cx)
      if (dx < GOAL_W / 2 - BALL_R && b.z < CROSSBAR - BALL_R) return this.goal(line === 0 ? 'home' : 'away')
      const inward = line === 0 ? 1 : -1
      if (Math.abs(dx - GOAL_W / 2) < BALL_R + 0.08 && b.z < CROSSBAR) {
        // Post: back into play, kicked off sideways
        b.y = line + inward * BALL_R
        b.vy = -b.vy * 0.55
        b.vx += Math.sign(b.x - this.cx) * (dx < GOAL_W / 2 ? -2 : 2)
        this.woodwork()
        return
      }
      if (dx < GOAL_W / 2 && Math.abs(b.z - CROSSBAR) < BALL_R + 0.08) {
        b.y = line + inward * BALL_R
        b.vy = -b.vy * 0.5
        b.vz = b.z > CROSSBAR ? Math.abs(b.vz) + 1 : -Math.abs(b.vz)
        this.woodwork()
        return
      }
    }
    if (b.x < -BALL_R || b.x > PITCH_W + BALL_R || b.y < -BALL_R || b.y > PITCH_H + BALL_R) this.outOfPlay()
  }

  private woodwork() {
    this.keeperBeaten = false
    this.flight = 'free'
    audio.post()
    this.shake = Math.max(this.shake, 0.25)
    this.banner('POSTE!', '', 0.9, '#f8fafc')
  }

  /** After a goal the ball stays inside the net, which bulges where it lands */
  private inNet() {
    const b = this.ball
    const top = b.y < PITCH_H / 2
    const back = top ? -GOAL_DEPTH + BALL_R : PITCH_H + GOAL_DEPTH - BALL_R
    if (top ? b.y < back : b.y > back) {
      b.y = back
      if (Math.abs(b.vy) > 2) this.netBulge[top ? 0 : 1] = Math.min(1, Math.abs(b.vy) / 20)
      b.vy *= -0.15
      b.vx *= 0.5
    }
    const half = GOAL_W / 2 - BALL_R
    if (Math.abs(b.x - this.cx) > half && (top ? b.y < 0 : b.y > PITCH_H)) {
      b.x = this.cx + Math.sign(b.x - this.cx) * half
      b.vx *= -0.2
    }
    if (b.z > CROSSBAR - BALL_R) {
      b.z = CROSSBAR - BALL_R
      b.vz = -Math.abs(b.vz) * 0.3
    }
  }

  /** Shots that reach a keeper's hands: caught, or parried wide of the goal */
  private saves() {
    const b = this.ball
    if (this.owner || this.keeperBeaten || this.setPiece) return
    const sp = Math.hypot(b.vx, b.vy)
    if (sp < 6) return
    for (const k of [this.keeperOf('home'), this.keeperOf('away')]) {
      if (this.lastTouch === k.team || (k.stun > 0 && k.dive <= 0)) continue
      if (!(k.team === 'home' ? b.vy > 0 : b.vy < 0)) continue
      const diving = k.dive > 0
      const reach = diving ? C.keeper.diveReach : C.keeper.reach
      if (dist(b.x, b.y, k.x, k.y) > reach || b.z > (diving ? 1.8 : 2.45)) continue
      const chance = this.keeperStat(C.keeper.save, k) * (1 - clamp((sp - 20) / 30, 0, 0.4))
      if (Math.random() < chance) {
        if (sp < (diving ? 18 : 24) && Math.random() < 0.55) {
          this.giveBall(k)
          this.setPiece = { kind: 'keeper', team: k.team, taker: k, x: k.x, y: k.y, ready: true, wait: C.keeper.holdTime }
          if (k.team === 'away') this.autoSwitch(true)
        } else {
          // Parried out toward the side of the goal, never back into the middle
          const side = Math.sign(b.x - this.cx) || (Math.random() < 0.5 ? -1 : 1)
          b.vy = -b.vy * 0.25
          b.vx = side * (5 + Math.random() * 4)
          b.vz = 2 + Math.random() * 2
          this.lastTouch = k.team
          this.flight = 'free'
          k.cooldown = 0.4
        }
        audio.save()
        haptic(20)
        this.banner('DEFESA!', '', 0.9, k.team === 'home' ? HOME_CSS : AWAY_CSS)
      } else this.keeperBeaten = true
      return
    }
  }

  /** A loose ball goes to the nearest player who can control it */
  private collect() {
    if (this.owner || this.setPiece) return
    const b = this.ball
    let best: Footballer | null = null
    let bd = Infinity
    for (const f of this.players) {
      if (f.cooldown > 0 || f.stun > 0 || f.slide > 0) continue
      const hands = f.role === 'gk' && this.inOwnBox(f.team, f.x, f.y)
      const reach = hands ? 1.0 : CONTROL_R
      if (b.z > (hands ? 2.3 : 1.1)) continue
      const d = dist(f.x, f.y, b.x, b.y)
      if (d < reach && d < bd) {
        bd = d
        best = f
      }
    }
    if (!best) return
    const sp = Math.hypot(b.vx, b.vy)
    const hands = best.role === 'gk' && this.inOwnBox(best.team, best.x, best.y)
    if (hands) {
      this.giveBall(best)
      this.setPiece = { kind: 'keeper', team: best.team, taker: best, x: best.x, y: best.y, ready: true, wait: C.keeper.holdTime }
      if (best.team === 'away') this.autoSwitch(true)
      return
    }
    if (best === this.passTarget || sp < C.control.hotSpeed || Math.random() < C.control.hotChance) {
      this.giveBall(best)
      return
    }
    // Too hot to handle: it comes off him
    b.vx = b.vx * -0.25 + (Math.random() - 0.5) * 5
    b.vy = b.vy * -0.25 + (Math.random() - 0.5) * 5
    b.vz = 1.5
    this.lastTouch = best.team
    this.flight = 'free'
    best.cooldown = 0.4
    this.passTarget = null
    audio.bounce()
  }

  /** Standing tackles: run into the dribbler to try and nick it. The tackler visibly pokes at it. */
  private tackles() {
    const o = this.owner
    if (!o || this.setPiece || this.ownerTime < C.control.lockout) return
    const T = C.tackle
    for (const f of this.rivals(o.team)) {
      if (f.stun > 0 || f.slide > 0 || f.tackleCd > 0 || f.role === 'gk') continue
      if (dist(f.x, f.y, o.x, o.y) > T.reach) continue
      f.tackleCd = T.cooldown
      f.kickT = 0.3
      this.face(f, o.x - f.x, o.y - f.y, Math.PI)
      let chance = f.team === 'away' ? byLevel(C.ai.tackle, this.level) : f === this.controlled ? T.human : T.mate
      // From behind is much harder; a ball knocked ahead at a sprint is easier to reach
      if (o.fx * (f.x - o.x) + o.fy * (f.y - o.y) < -0.3) chance *= T.fromBehind
      if (Math.hypot(o.vx, o.vy) > RUN + 0.5) chance += 0.1
      if (Math.random() >= chance) continue
      o.cooldown = 0.5
      if (Math.random() < 0.6) {
        this.giveBall(f)
      } else {
        const n = norm(this.ball.x - f.x, this.ball.y - f.y)
        this.owner = null
        this.flight = 'free'
        this.ball.vx = n.x * 4 + (Math.random() - 0.5) * 3
        this.ball.vy = n.y * 4 + (Math.random() - 0.5) * 3
        this.lastTouch = f.team
      }
      audio.kick(0.25)
      if (f.team === 'home') haptic(15)
      return
    }
  }

  private goal(scorer: Team) {
    const home = scorer === 'home'
    if (home) this.home++
    else this.away++
    this.scorer = scorer
    this.goalTimer = C.match.goalPause
    this.owner = null
    this.passTarget = null
    this.flight = 'free'
    this.charging = false
    this.buffered = null
    this.shake = 0.8
    this.flash = 1
    this.flashColor = home ? HOME_CSS : AWAY_CSS
    this.banner(home ? 'GOLO!' : 'GOLO CPU', `${this.home} - ${this.away}`, 2.4, home ? HOME_CSS : AWAY_CSS)
    this.confetti(home ? HOME_CSS : AWAY_CSS)
    if (home) audio.goal()
    else audio.conceded()
    haptic(home ? 60 : 30)
    this.emit()
  }

  private halfTime() {
    this.half = 2
    this.mode = 'halftime'
    this.releaseAll()
    this.banners = []
    audio.stopCrowd()
    audio.fullTime()
    this.emit()
  }

  private fullTime() {
    this.clock = C.match.time
    this.mode = 'over'
    this.releaseAll()
    audio.stopCrowd()
    audio.fullTime()
    if (this.home > this.away) {
      this.result = 'win'
      audio.win()
      this.streak++
      this.level++
      if (this.streak > this.best) {
        this.best = this.streak
        this.newBest = true
        writeBest(this.best)
      }
    } else if (this.home < this.away) {
      this.result = 'loss'
      this.streak = 0
      this.level = 1
    } else {
      this.result = 'draw'
    }
    this.emit()
  }

  // ---------------- Effects ----------------

  /** One notification at a time: a new one replaces the old, so they never pile up */
  private banner(text: string, sub: string, life: number, color: string) {
    if (!text) return
    this.banners = [{ text, sub, life, max: life, color }]
  }

  private confetti(color: string) {
    const colors = [color, '#fde047', '#f8fafc']
    for (let i = 0; i < 140; i++) {
      this.particles.push({
        x: Math.random() * this.w,
        y: -10 - Math.random() * this.h * 0.4,
        vx: (Math.random() - 0.5) * 60,
        vy: 60 + Math.random() * 120,
        life: 2.5 + Math.random(),
        color: colors[i % 3],
        size: 3 + Math.random() * 4,
        spin: Math.random() * 6,
      })
    }
  }

  private burstAt(x: number, y: number, z: number, color: string, count: number) {
    const p = this.project(x, z, y)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 40 + Math.random() * 120
      this.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.3,
        color,
        size: 2 + Math.random() * 2,
        spin: 0,
      })
    }
  }

  // ---------------- Frame loop ----------------

  private frame = (t: number) => {
    // After a hidden tab or a pause lastFrame is reset, so the first frame back is a normal one
    const ms = this.lastFrame ? Math.min(t - this.lastFrame, 100) : 16
    const dt = ms / 1000
    this.lastFrame = t
    if (this.mode === 'playing') {
      this.acc += dt
      let steps = 0
      while (this.acc >= C.match.step && this.mode === 'playing' && steps < C.match.maxSteps) {
        this.step(C.match.step)
        this.acc -= C.match.step
        steps++
      }
      // Too far behind: drop the backlog instead of fast-forwarding
      if (steps === C.match.maxSteps) this.acc = 0
    } else {
      this.acc = 0
      this.time += dt * 0.3
    }
    this.emit()
    this.watchPerformance(ms)
    this.update(dt)
    this.render(dt)
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 0.98
      p.spin += dt * 8
      p.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
    for (const b of this.banners) b.life -= dt
    this.banners = this.banners.filter((b) => b.life > 0)
    this.shake = Math.max(0, this.shake - dt * 1.5)
    this.flash = Math.max(0, this.flash - dt * 2.5)
  }

  /** World (sim x, height, sim y) to overlay pixels */
  private project(x: number, h: number, y: number) {
    this.v3.set(x - PITCH_W / 2, h, y - PITCH_H / 2).project(this.camera)
    return { x: ((this.v3.x + 1) / 2) * this.w, y: ((1 - this.v3.y) / 2) * this.h, behind: this.v3.z > 1 }
  }

  private render(dt: number) {
    const b = this.ball
    const o = this.owner
    const K = C.camera

    // Broadcast-style camera from behind your goal: looks ahead of the ball, leans toward your player
    let tx = o ? o.x + o.fx * K.lookAhead : b.x + b.vx * 0.25
    let ty = o ? o.y + o.fy * K.lookAhead : b.y + b.vy * 0.25
    const c0 = this.controlled
    if (c0 !== o && this.mode !== 'menu') {
      tx = lerp(tx, c0.x, K.controlledPull)
      ty = lerp(ty, c0.y, K.controlledPull)
    }
    const k = 1 - Math.exp(-dt * K.follow)
    this.focus.x += (clamp(tx, 8, PITCH_W - 8) - this.focus.x) * k
    this.focus.y += (clamp(ty, 6, PITCH_H + 2) - this.focus.y) * k
    // Close in a little around the box you're attacking
    const nearGoal = clamp(1 - (this.focus.y - 6) / 20, 0, 1)
    this.zoom += (lerp(1, K.attackZoom, nearGoal) - this.zoom) * (1 - Math.exp(-dt * 1.5))
    const fx = this.focus.x - PITCH_W / 2
    const fz = this.focus.y - PITCH_H / 2
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    // Landscape screens show more width; pull back a touch in portrait so passing options stay in view
    const aspectBack = this.w < this.h ? 1 : 0.9
    this.camera.position.set(fx * 0.85 + sx, K.height * this.zoom * aspectBack + sy, fz + K.back * this.zoom * aspectBack)
    this.camera.lookAt(fx * 0.92, 0, fz - 3.5)
    this.sun.position.set(fx - 14, 34, fz + 16)
    this.sun.target.position.set(fx, 0, fz - 3)

    const containing = this.containing()
    for (const f of this.players) {
      const m = f.model.root
      m.position.set(f.x - PITCH_W / 2, 0, f.y - PITCH_H / 2)
      const yaw = Math.atan2(f.fx, f.fy)
      m.rotation.y = yaw
      let dive = 0
      if (f.diveDir !== 0 && (f.dive > 0 || f.stun > 0)) {
        // Dive direction in the model's own frame: its local +x is (cos yaw, -sin yaw) in the world
        const local = f.diveDir * Math.cos(yaw)
        dive = Math.sign(local || 1) * (f.dive > 0 ? 1 : Math.min(1, f.stun / 0.35))
      }
      // Keepers set themselves when the ball is in their third; your player crouches when containing
      const keeperSet = f.role === 'gk' && Math.abs(b.y - (f.team === 'home' ? PITCH_H : 0)) < 28 && this.owner !== f
      f.model.pose(
        {
          phase: f.phase,
          speed: Math.min(1, Math.hypot(f.vx, f.vy) / SPRINT),
          kick: f.kickT > 0 ? 0.35 + 0.65 * (1 - f.kickT / 0.35) : 0,
          slide: f.slide > 0 ? 1 : f.stun > 0 && f.diveDir === 0 ? Math.min(1, f.stun / 0.3) : 0,
          dive,
          celebrate: this.goalTimer > 0 && f.team === this.scorer && f.role !== 'gk',
          crouch: (f === this.controlled && containing) || keeperSet ? 1 : 0,
          time: this.time + f.num,
        },
        dt,
      )
    }

    // Ball: rolls about the axis perpendicular to its motion
    const scale = C.ball.drawScale
    this.ballMesh.position.set(b.x - PITCH_W / 2, b.z + BALL_R * scale, b.y - PITCH_H / 2)
    const speed = Math.hypot(b.vx, b.vy)
    if (speed > 0.05 && this.mode === 'playing') {
      this.v3.set(b.vy, 0, -b.vx).normalize()
      this.q.setFromAxisAngle(this.v3, (speed * dt) / BALL_R)
      this.ballMesh.quaternion.premultiply(this.q)
    }
    const lift = clamp(b.z / 4, 0, 1)
    this.ballShadow.position.set(b.x - PITCH_W / 2, 0.025, b.y - PITCH_H / 2)
    this.ballShadow.scale.setScalar(scale * (1 - lift * 0.4))
    this.ballShadow.material.opacity = 1 - lift * 0.6

    this.nets[0].position.z = -GOAL_DEPTH - this.netBulge[0] * 0.6
    this.nets[1].position.z = -GOAL_DEPTH - this.netBulge[1] * 0.6

    const c = this.controlled
    const visible = this.mode !== 'menu'
    this.marker.visible = this.arrow.visible = visible
    this.marker.position.set(c.x - PITCH_W / 2, 0.03, c.y - PITCH_H / 2)
    // The marker's arrow points up its texture, i.e. local -z: turn it to the facing
    this.marker.rotation.y = Math.atan2(-c.fx, -c.fy)
    this.arrow.position.set(c.x - PITCH_W / 2, 2.35 + Math.sin(this.time * 5) * 0.08, c.y - PITCH_H / 2)
    this.arrow.rotation.y += dt * 2
    const r = this.passTarget
    this.receiverRing.visible = !!r && r.team === 'away'
    if (r) this.receiverRing.position.set(r.x - PITCH_W / 2, 0.03, r.y - PITCH_H / 2)

    this.renderer.render(this.scene, this.camera)
    this.drawOverlay()
  }

  private drawOverlay() {
    const { octx: g, w, h } = this
    g.clearRect(0, 0, w, h)

    if (this.mode === 'playing' || this.mode === 'paused') {
      const c = this.controlled
      const head = this.project(c.x, 2.75, c.y)
      if (!head.behind && this.charging) {
        // Shot power with the sweet spot marked; past it the bar turns red
        const bw = 46
        const x0 = head.x - bw / 2
        const y0 = head.y - 4
        const p = Math.pow(this.charge, C.shot.curve)
        g.fillStyle = 'rgba(0, 0, 0, 0.6)'
        g.fillRect(x0 - 2, y0 - 2, bw + 4, 10)
        g.fillStyle = 'rgba(163, 230, 53, 0.35)'
        g.fillRect(x0 + bw * C.shot.sweetMin, y0, bw * (C.shot.sweetMax - C.shot.sweetMin), 6)
        g.fillStyle = p > C.shot.sweetMax ? '#ef4444' : p >= C.shot.sweetMin ? '#a3e635' : '#22d3ee'
        g.fillRect(x0, y0 + 1, bw * p, 4)
      }
      this.drawRadar()
    }

    for (const p of this.particles) {
      g.save()
      g.globalAlpha = Math.min(1, p.life * 2)
      g.translate(p.x, p.y)
      g.rotate(p.spin)
      g.fillStyle = p.color
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      g.restore()
    }

    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const b of this.banners) {
      const t = 1 - b.life / b.max
      const a = Math.min(1, b.life * 3, t * 8)
      const big = b.text.length <= 9
      const scale = big ? 1 + Math.max(0, 0.25 - t) * 1.5 : 1
      g.globalAlpha = a
      g.font = `900 ${Math.round((big ? Math.min(38, w / 11) : 18) * scale)}px Orbitron, sans-serif`
      g.shadowColor = b.color
      g.shadowBlur = 18
      g.fillStyle = b.color
      g.fillText(b.text, w / 2, h * 0.36)
      if (b.sub) {
        g.font = '700 13px Orbitron, sans-serif'
        g.shadowBlur = 6
        g.fillStyle = '#f8fafc'
        g.fillText(b.sub, w / 2, h * 0.36 + 32)
      }
    }
    g.globalAlpha = 1
    g.shadowBlur = 0

    if (this.flash > 0) {
      g.globalAlpha = this.flash * 0.3
      g.fillStyle = this.flashColor
      g.fillRect(0, 0, w, h)
      g.globalAlpha = 1
    }
  }

  /** Mini-map in the top corner, clear of the touch controls, with every player and the ball */
  private drawRadar() {
    const g = this.octx
    const landscape = this.w > this.h
    const rw = landscape ? Math.min(56, this.h * 0.18) : Math.min(70, this.w * 0.17)
    const rh = (rw * PITCH_H) / PITCH_W
    const x0 = this.w - rw - 8
    const y0 = 8
    g.fillStyle = 'rgba(4, 12, 8, 0.55)'
    g.fillRect(x0, y0, rw, rh)
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    g.lineWidth = 1
    g.strokeRect(x0 + 0.5, y0 + 0.5, rw - 1, rh - 1)
    g.beginPath()
    g.moveTo(x0, y0 + rh / 2)
    g.lineTo(x0 + rw, y0 + rh / 2)
    g.stroke()
    const bw = (rw * BOX_W) / PITCH_W
    const bd = (rh * BOX_D) / PITCH_H
    g.strokeRect(x0 + (rw - bw) / 2, y0 + 0.5, bw, bd)
    g.strokeRect(x0 + (rw - bw) / 2, y0 + rh - bd - 0.5, bw, bd)
    const sx = rw / PITCH_W
    const sy = rh / PITCH_H
    for (const f of this.players) {
      const you = f === this.controlled
      g.fillStyle = f.team === 'home' ? (you ? '#fde047' : HOME_CSS) : AWAY_CSS
      g.beginPath()
      g.arc(x0 + clamp(f.x, 0, PITCH_W) * sx, y0 + clamp(f.y, 0, PITCH_H) * sy, you ? 2.6 : 1.9, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(x0 + clamp(this.ball.x, 0, PITCH_W) * sx, y0 + clamp(this.ball.y, 0, PITCH_H) * sy, 1.8, 0, Math.PI * 2)
    g.fill()
  }
}
