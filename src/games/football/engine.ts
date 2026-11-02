import {
  ACESFilmicToneMapping,
  CanvasTexture,
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
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { audio } from './audio'
import { Humanoid, type Kit, type Look } from './humanoid'
import { buildStadium } from './stadium'

// The simulation works on a flat pitch in metres: x across (0..PITCH_W), y along (0..PITCH_H), z up.
// Home attacks toward y = 0, which is the far end of the screen. The 3D scene centres the pitch:
// three.js x = x - PITCH_W / 2, z = y - PITCH_H / 2, y = height.
const PITCH_W = 52
const PITCH_H = 80
const GOAL_W = 7.6
const GOAL_DEPTH = 2
const CROSSBAR = 2.44
const BOX_W = 30
const BOX_D = 13
const PLAYER_R = 0.45
const BALL_R = 0.16
const RUN_SPEED = 6.4
const SPRINT_SPEED = 8.6
/** Speed multiplier while dribbling */
const DRIBBLE = 0.9
const GRAVITY = 9.8
const ROLL_FRICTION = 0.85
const AIR_DRAG = 0.08
/** How close the ball must be to take it under control */
const CONTROL_R = 0.8
const TACKLE_R = 1.15
/** Seconds of holding shoot for a full-power shot */
const SHOT_CHARGE = 0.85
const SLIDE_TIME = 0.55
const DIVE_TIME = 0.6
/** Real seconds per match; the HUD shows it as 90 minutes */
const MATCH_TIME = 180
const KICKOFF_FREEZE = 1.4
const GOAL_PAUSE = 2.8
// The simulation runs in fixed sub-steps so fast shots can't pass through keepers
const STEP = 1 / 120

const BEST_KEY = 'kitumba-football:best'

export type GameMode = 'menu' | 'playing' | 'paused' | 'over'
export type MatchResult = 'win' | 'draw' | 'loss'
export type Action = 'pass' | 'shoot' | 'through' | 'sprint'
type Team = 'home' | 'away'
type Role = 'gk' | 'def' | 'mid' | 'fwd'
type RestartKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'keeper'

export interface HudState {
  mode: GameMode
  home: number
  away: number
  minute: number
  level: number
  streak: number
  best: number
  result: MatchResult | null
  newBest: boolean
  /** Your team has the ball: the action buttons attack instead of defend */
  attacking: boolean
  /** Home share of possession, in percent */
  possession: number
}

interface Footballer {
  team: Team
  role: Role
  num: number
  /** Formation slot in the attacking frame: ax across, ay from own goal (0) to the opponent's (1) */
  baseX: number
  baseY: number
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

const HOME_KIT: Kit = { shirt: 0x06b6d4, sleeve: 0x0e7490, shorts: 0xf1f5f9, socks: 0x06b6d4, number: '#ffffff' }
const HOME_GK: Kit = { shirt: 0xf59e0b, sleeve: 0xf59e0b, shorts: 0x1f2937, socks: 0xf59e0b, number: '#111827' }
// The rival changes its kit every division
const AWAY_KITS: Kit[] = [
  { shirt: 0xc026d3, sleeve: 0x701a75, shorts: 0x1e1b4b, socks: 0xc026d3, number: '#ffffff' },
  { shirt: 0xdc2626, sleeve: 0xffffff, shorts: 0xffffff, socks: 0xdc2626, number: '#ffffff' },
  { shirt: 0x18181b, sleeve: 0xfacc15, shorts: 0x18181b, socks: 0xfacc15, number: '#facc15' },
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

const ballTexture = () => {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#f8fafc'
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = '#111827'
  // Patches spread over the sphere's equirectangular map
  for (const [x, y, r] of [
    [32, 64, 14],
    [96, 30, 12],
    [96, 98, 12],
    [160, 64, 14],
    [224, 30, 12],
    [224, 98, 12],
    [0, 10, 18],
    [128, 4, 16],
    [64, 124, 16],
    [192, 124, 16],
  ]) {
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9)
    }
    g.closePath()
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
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
  private camera = new PerspectiveCamera(46, 0.75, 0.5, 400)
  private sun: DirectionalLight
  private ballMesh: Mesh
  private ring: Mesh
  private aimArc: Mesh
  private arrow: Mesh
  private receiverRing: Mesh
  private focus = { x: PITCH_W / 2, y: PITCH_H / 2 }
  private v3 = new Vector3()
  private q = new Quaternion()

  private mode: GameMode = 'menu'
  private players: Footballer[] = []
  private homeTeam: Footballer[] = []
  private awayTeam: Footballer[] = []
  private awayKit = -1
  private controlled!: Footballer
  private owner: Footballer | null = null
  private ownerTime = 0
  private passTarget: Footballer | null = null
  private lastTouch: Team = 'home'
  private lastKicker: Footballer | null = null
  /** The current shot already got past the keeper's hands, so it isn't checked again */
  private keeperBeaten = false
  private setPiece: SetPiece | null = null
  private ball: Ball = { x: PITCH_W / 2, y: PITCH_H / 2, z: 0, vx: 0, vy: 0, vz: 0 }

  private input = { x: 0, y: 0 }
  private held: Record<Action, boolean> = { pass: false, shoot: false, through: false, sprint: false }
  private charging = false
  private charge = 0
  private switchTimer = 0

  private home = 0
  private away = 0
  private clock = 0
  private halfDone = false
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
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 600
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
    this.scene.add(
      buildStadium(
        {
          w: PITCH_W,
          h: PITCH_H,
          goalW: GOAL_W,
          goalDepth: GOAL_DEPTH,
          crossbar: CROSSBAR,
          boxW: BOX_W,
          boxD: BOX_D,
          sixW: 14,
          sixD: 4.6,
          penSpot: 9,
          circleR: 7,
        },
        aniso,
      ),
    )

    this.ballMesh = new Mesh(
      new SphereGeometry(BALL_R, 24, 16),
      new MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }),
    )
    this.ballMesh.castShadow = true
    // Drawn a little oversized so it reads at broadcast distance
    this.ballMesh.scale.setScalar(1.35)
    this.scene.add(this.ballMesh)

    const marker = (color: string, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false })
    this.ring = new Mesh(new RingGeometry(0.62, 0.8, 40).rotateX(-Math.PI / 2), marker(HOME_CSS, 0.9))
    this.aimArc = new Mesh(
      new RingGeometry(0.88, 1.12, 16, 1, Math.PI / 2 - 0.35, 0.7).rotateX(-Math.PI / 2),
      marker('#fde047', 0.9),
    )
    this.arrow = new Mesh(new ConeGeometry(0.17, 0.34, 4).rotateX(Math.PI), marker(HOME_CSS, 1))
    this.receiverRing = new Mesh(new RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), marker('#f8fafc', 0.7))
    for (const m of [this.ring, this.aimArc, this.receiverRing]) {
      m.position.y = 0.03
      m.renderOrder = 1
    }
    this.scene.add(this.ring, this.aimArc, this.arrow, this.receiverRing)

    this.buildTeams()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.kickoff('home')
    this.freeze = 0
    this.banners = []
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    audio.stopCrowd()
    this.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      obj.geometry.dispose()
      const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        ;(m as MeshStandardMaterial).map?.dispose()
        m.dispose()
      }
    })
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
    this.halfDone = false
    this.possHome = 0
    this.possAway = 0
    this.result = null
    this.newBest = false
    this.banners = []
    this.particles = []
    this.goalTimer = 0
    this.charging = false
    for (const f of this.players) f.stamina = 1
    this.kickoff('home')
    this.mode = 'playing'
    audio.whistle()
    audio.startCrowd()
    this.emit()
  }

  togglePause() {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      audio.stopCrowd()
    } else if (this.mode === 'paused') {
      this.mode = 'playing'
      audio.startCrowd()
    } else return
    audio.pause()
    this.emit()
  }

  /** Movement vector from keyboard or joystick; each axis in [-1, 1], screen-up is negative y. */
  setInput(x: number, y: number) {
    const n = norm(x, y)
    const len = Math.min(1, n.d)
    this.input = { x: n.x * len, y: n.y * len }
  }

  /** Button press or release. What a button does depends on who has the ball, like on a pad. */
  press(action: Action, down: boolean) {
    const was = this.held[action]
    this.held[action] = down
    if (this.mode !== 'playing' || this.freeze > 0 || this.goalTimer > 0) {
      if (!down) this.charging = false
      return
    }
    const c = this.controlled
    const mine = this.owner === c
    const sp = this.setPiece

    if (action === 'pass' && down && !was) {
      if (mine) this.humanPass(c, false)
      else if (this.looseNear(c)) this.humanPass(c, false)
      else if (this.possessionTeam() !== 'home') this.switchPlayer()
    } else if (action === 'through' && down && !was) {
      if (mine) this.humanPass(c, true)
    } else if (action === 'shoot') {
      if (down && !was) {
        if (mine && sp?.kind === 'corner') this.humanCross(c)
        else if (mine && sp) this.humanPass(c, false)
        else if (mine || this.looseNear(c)) {
          this.charging = true
          this.charge = 0
        } else if (this.possessionTeam() !== 'home') this.slideTackle(c, this.input.x, this.input.y)
      } else if (!down && this.charging) {
        this.charging = false
        if (this.owner === c || this.looseNear(c)) this.shoot(c, this.charge, this.aimFromInput())
      }
    }
  }

  // ---------------- Internals ----------------

  private emit() {
    const total = this.possHome + this.possAway
    const hud: HudState = {
      mode: this.mode,
      home: this.home,
      away: this.away,
      minute: Math.min(90, Math.floor((this.clock / MATCH_TIME) * 90)),
      level: this.level,
      streak: this.streak,
      best: this.best,
      result: this.result,
      newBest: this.newBest,
      attacking: this.possessionTeam() === 'home',
      // Only reported at full time, so React isn't re-rendered every frame
      possession: this.mode === 'over' && total > 0 ? Math.round((this.possHome / total) * 100) : 50,
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.w = w
    this.h = h
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
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          fx: 0,
          fy: team === 'home' ? -1 : 1,
          phase: rnd() * 6,
          pace: 0.95 + rnd() * 0.1 + (role === 'fwd' ? 0.03 : 0),
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
    return t === 'home'
      ? { ax: x / PITCH_W, ay: 1 - y / PITCH_H }
      : { ax: 1 - x / PITCH_W, ay: y / PITCH_H }
  }

  private toWorld(t: Team, ax: number, ay: number) {
    return t === 'home'
      ? { x: ax * PITCH_W, y: (1 - ay) * PITCH_H }
      : { x: (1 - ax) * PITCH_W, y: ay * PITCH_H }
  }

  /** Inside the penalty box that team t defends */
  private inOwnBox(t: Team, x: number, y: number) {
    const line = t === 'home' ? PITCH_H : 0
    return Math.abs(x - this.cx) < BOX_W / 2 && Math.abs(y - line) < BOX_D
  }

  private possessionTeam(): Team | null {
    return this.owner?.team ?? this.passTarget?.team ?? this.setPiece?.team ?? null
  }

  private looseNear(f: Footballer) {
    const b = this.ball
    return !this.owner && !this.setPiece && b.z < 1 && dist(f.x, f.y, b.x, b.y) < CONTROL_R + 0.5
  }

  private nearestTo(team: Footballer[], x: number, y: number, skip?: (f: Footballer) => boolean) {
    let best: Footballer | null = null
    let bd = Infinity
    for (const f of team) {
      if (skip?.(f)) continue
      const d = dist(f.x, f.y, x, y)
      if (d < bd) {
        bd = d
        best = f
      }
    }
    return best
  }

  // ---------------- Kickoff and restarts ----------------

  /** Everyone back to their half, the ball on the centre spot, `team` to kick off. */
  private kickoff(team: Team) {
    const cy = PITCH_H / 2
    this.owner = null
    this.passTarget = null
    this.ball = { x: this.cx, y: cy, z: 0, vx: 0, vy: 0, vz: 0 }
    for (const f of this.players) {
      const p = this.toWorld(f.team, f.baseX, Math.min(f.baseY * 0.92, 0.46))
      f.x = p.x
      f.y = p.y
      // The defending side stays outside the centre circle
      if (f.team !== team) {
        const n = norm(f.x - this.cx, f.y - cy)
        if (n.d < 8.5) {
          f.x = this.cx + n.x * 8.5
          f.y = cy + Math.abs(n.y || 1) * 8.5 * (f.team === 'home' ? 1 : -1)
        }
      }
      f.vx = f.vy = 0
      f.fx = 0
      f.fy = this.attackDir(f.team)
      f.stun = f.slide = f.dive = f.kickT = f.cooldown = 0
      f.diveDir = 0
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
    this.freeze = KICKOFF_FREEZE
    this.banner(RESTART_TEXT.kickoff, team === 'home' ? 'Passa para começar' : '', 1.4, '#e0f2fe')
  }

  private restart(kind: RestartKind, team: Team, x: number, y: number) {
    this.owner = null
    this.passTarget = null
    this.ball = { x, y, z: 0, vx: 0, vy: 0, vz: 0 }
    const taker =
      kind === 'goalkick'
        ? this.keeperOf(team)
        : this.nearestTo(this.teamOf(team), x, y, (f) => f.role === 'gk' || f.stun > 0)!
    this.setPiece = { kind, team, taker, x, y, ready: false, wait: 0.7 + Math.random() * 0.5 }
    if (team === 'home' && taker.role !== 'gk') this.controlled = taker
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
    if (sp.kind !== 'keeper') {
      b.x = sp.x
      b.y = sp.y
      b.z = 0
    }
    b.vx = b.vy = b.vz = 0
    // Aim: up the pitch at a kickoff, toward the penalty spot from a corner, infield otherwise
    let aim: { x: number; y: number }
    if (sp.kind === 'kickoff' || sp.kind === 'keeper' || sp.kind === 'goalkick') aim = { x: 0, y: this.attackDir(sp.team) }
    else if (sp.kind === 'corner') aim = norm(this.cx - sp.x, this.targetLine(sp.team) + this.attackDir(sp.team) * -9 - sp.y)
    else aim = norm(this.cx - sp.x, this.attackDir(sp.team) * 6)

    if (sp.kind === 'keeper') {
      // The keeper holds the ball in his hands
      b.x = t.x + t.fx * 0.35
      b.y = t.y + t.fy * 0.35
      b.z = 1.1
      this.drive(t, 0, 0, s)
    } else if (!sp.ready) {
      const spot = { x: sp.x - aim.x * (PLAYER_R + BALL_R + 0.1), y: sp.y - aim.y * (PLAYER_R + BALL_R + 0.1) }
      this.steer(t, spot.x, spot.y, SPRINT_SPEED, s)
      if (dist(t.x, t.y, spot.x, spot.y) < 0.3) {
        sp.ready = true
        t.fx = aim.x
        t.fy = aim.y
        this.giveBall(t)
      }
      return
    } else {
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
      const mates = this.teamOf(t.team).filter((f) => f !== t && this.inOwnBox(t.team === 'home' ? 'away' : 'home', f.x, f.y))
      const r = mates[Math.floor(Math.random() * mates.length)]
      const line = this.targetLine(t.team)
      const tx = r ? r.x : this.cx + (Math.random() - 0.5) * 8
      const ty = r ? r.y : line - this.attackDir(t.team) * (6 + Math.random() * 4)
      return this.passBall(t, tx, ty, r ?? null, 'lofted')
    }
    const opt = this.bestPass(t, sp.kind === 'goalkick' || sp.kind === 'keeper')
    if (opt) return this.passBall(t, opt.r.x, opt.r.y, opt.r, opt.lofted ? 'lofted' : 'ground')
    this.passBall(t, t.x + (Math.random() - 0.5) * 16, t.y + this.attackDir(t.team) * 25, null, 'lofted')
  }

  // ---------------- Ball control ----------------

  private giveBall(f: Footballer) {
    const prev = this.possessionTeam()
    this.owner = f
    this.ownerTime = 0
    this.passTarget = null
    this.lastTouch = f.team
    this.keeperBeaten = false
    this.ball.vz = 0
    if (f.team === 'home' && f.role !== 'gk') this.controlled = f
    else if (f.team === 'away' && prev !== 'away') this.autoSwitch(false)
  }

  /** Hand control to the teammate nearest the ball when yours is far out of the play. */
  private autoSwitch(always: boolean) {
    const b = this.ball
    const n = this.nearestTo(this.homeTeam, b.x, b.y, (f) => f.role === 'gk')
    if (!n) return
    const cur = dist(this.controlled.x, this.controlled.y, b.x, b.y)
    if (always ? n !== this.controlled : cur > dist(n.x, n.y, b.x, b.y) + 4) {
      this.controlled = n
      this.charging = false
    }
  }

  /** Defending: take over the teammate best placed to win the ball. */
  private switchPlayer() {
    const b = this.ball
    const target = this.owner ?? { x: b.x, y: b.y }
    // Prefer someone between the ball and our goal
    let best: Footballer | null = null
    let bs = Infinity
    for (const f of this.homeTeam) {
      if (f === this.controlled || f.role === 'gk') continue
      const d = dist(f.x, f.y, target.x, target.y) + (f.y < target.y ? 3 : 0)
      if (d < bs) {
        bs = d
        best = f
      }
    }
    if (best) {
      this.controlled = best
      audio.click()
    }
  }

  private kickBall(f: Footballer, vx: number, vy: number, vz: number) {
    const b = this.ball
    this.owner = null
    this.setPiece = null
    this.passTarget = null
    if (b.z > 0.9 && f.role === 'gk') b.z = 0.9
    b.vx = vx
    b.vy = vy
    b.vz = vz
    // Start the ball just ahead of the kicker so his own body doesn't block it
    const n = norm(vx, vy)
    b.x = f.x + n.x * (PLAYER_R + BALL_R + 0.05)
    b.y = f.y + n.y * (PLAYER_R + BALL_R + 0.05)
    f.cooldown = 0.3
    f.kickT = 0.35
    f.fx = n.x || f.fx
    f.fy = n.y || f.fy
    this.lastTouch = f.team
    this.lastKicker = f
    this.keeperBeaten = false
    this.charging = false
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
    // CPU passes get less accurate in the lower divisions
    if (f.team === 'away') dir += (Math.random() - 0.5) * Math.max(0.02, 0.12 - this.level * 0.015)
    const ux = Math.cos(dir)
    const uy = Math.sin(dir)
    if (kind === 'lofted') {
      const T = clamp(0.55 + n.d / 32, 0.75, 1.7)
      const vh = (n.d * 0.85) / T
      this.kickBall(f, ux * vh, uy * vh, (GRAVITY * T) / 2)
      audio.kick(0.6)
    } else {
      // Rolling with exponential friction loses ROLL_FRICTION m/s per metre: arrive with a few m/s left
      const arrive = kind === 'through' ? 2.5 : 4.5
      const v = clamp(ROLL_FRICTION * n.d + arrive, 7, 28)
      this.kickBall(f, ux * v, uy * v, 0)
      audio.kick(0.35)
    }
    this.passTarget = receiver
    if (receiver && receiver.team === 'home') this.controlled = receiver
  }

  private shoot(f: Footballer, power: number, aimX: number | null) {
    const b = this.ball
    const line = this.targetLine(f.team)
    const k = this.keeperOf(f.team === 'home' ? 'away' : 'home')
    // Without an aim, go for the side the keeper isn't covering
    const side = aimX ?? (k.x < this.cx ? 1 : -1) * (0.45 + Math.random() * 0.55)
    const tx = this.cx + side * (GOAL_W / 2 - 0.45)
    const d = dist(b.x, b.y, tx, line)
    // Harder and longer shots spray more
    let err = (0.012 + power * 0.05 + d * 0.0016) * (Math.random() * 2 - 1)
    if (f.team === 'away') err *= Math.max(0.7, 1.5 - this.level * 0.1)
    const dir = Math.atan2(line - b.y, tx - b.x) + err
    const speed = 18 + power * 14
    const vz = 0.5 + power * power * 7.5 + d * 0.04
    this.kickBall(f, Math.cos(dir) * speed, Math.sin(dir) * speed, vz)
    audio.kick(0.6 + power * 0.4)
    this.burstAt(b.x, b.y, 0.4, f.team === 'home' ? HOME_CSS : AWAY_CSS, 10)
  }

  private aimFromInput() {
    // Home shoots up the screen, so joystick x is the aim across the goal
    return Math.abs(this.input.x) > 0.25 ? clamp(this.input.x * 1.3, -1, 1) : null
  }

  private humanDir(f: Footballer) {
    const n = norm(this.input.x, this.input.y)
    return n.d > 0.3 ? n : { x: f.fx, y: f.fy, d: 1 }
  }

  private humanPass(f: Footballer, through: boolean) {
    const dir = this.humanDir(f)
    const r = this.pickReceiver(f, dir.x, dir.y)
    if (!r) {
      // Nobody that way: play it into space
      const len = through ? 16 : 11
      this.passBall(f, f.x + dir.x * len, f.y + dir.y * len, null, 'ground')
      return
    }
    const d = dist(f.x, f.y, r.x, r.y)
    if (through) {
      // Into the space ahead of the runner, toward goal
      const ahead = norm(dir.x * 0.4, this.attackDir('home') + dir.y * 0.4)
      const tx = r.x + ahead.x * 7 + r.vx * 0.5
      const ty = r.y + ahead.y * 7 + r.vy * 0.5
      this.passBall(f, tx, ty, r, d > 26 ? 'lofted' : 'through')
    } else {
      this.passBall(f, r.x, r.y, r, d > 26 ? 'lofted' : 'ground')
    }
  }

  private humanCross(f: Footballer) {
    const mates = this.homeTeam.filter((m) => m !== f && this.inOwnBox('away', m.x, m.y))
    const dir = this.humanDir(f)
    let r: Footballer | null = null
    let bs = -Infinity
    for (const m of mates) {
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
  private pickReceiver(f: Footballer, dx: number, dy: number) {
    let best: Footballer | null = null
    let bs = -Infinity
    for (const t of this.teamOf(f.team)) {
      if (t === f) continue
      const n = norm(t.x - f.x, t.y - f.y)
      if (n.d < 2 || n.d > 45) continue
      const align = (n.x * dx + n.y * dy)
      if (align < 0.6) continue
      const free = Math.min(6, this.nearestRivalDist(t))
      const s = align * 4 - n.d * 0.05 + free * 0.15 - (t.role === 'gk' ? 2 : 0)
      if (s > bs) {
        bs = s
        best = t
      }
    }
    return best
  }

  private nearestRivalDist(f: Footballer) {
    let d = Infinity
    for (const o of this.rivals(f.team)) d = Math.min(d, dist(o.x, o.y, f.x, f.y))
    return d
  }

  /** CPU passing: the most useful open teammate, or null if nobody is worth it */
  private bestPass(f: Footballer, allowLong: boolean) {
    let best: { r: Footballer; score: number; lofted: boolean } | null = null
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
      if (!best || score > best.score) best = { r: t, score, lofted }
    }
    return best
  }

  private slideTackle(f: Footballer, dx: number, dy: number) {
    if (f.slide > 0 || f.stun > 0) return
    const n = norm(dx, dy)
    const dir = n.d > 0.3 ? n : { x: f.fx, y: f.fy }
    f.slide = SLIDE_TIME
    f.slideX = dir.x
    f.slideY = dir.y
    f.fx = dir.x
    f.fy = dir.y
    f.vx = dir.x * 9.5
    f.vy = dir.y * 9.5
    audio.whiff()
  }

  // ---------------- Simulation ----------------

  private step(s: number) {
    this.time += s
    for (const f of this.players) {
      f.kickT = Math.max(0, f.kickT - s)
    }

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
        if (this.clock >= MATCH_TIME) return this.fullTime()
        this.kickoff(this.scorer === 'home' ? 'away' : 'home')
      }
      return
    }

    this.clock += s
    if (this.clock >= MATCH_TIME) return this.fullTime()
    if (!this.halfDone && this.clock >= MATCH_TIME / 2) {
      this.halfDone = true
      audio.fullTime()
      this.kickoff('away')
      this.freeze = 2.6
      this.banner('INTERVALO', `${this.home} - ${this.away}`, 2.4, '#fde047')
      return
    }

    const poss = this.possessionTeam()
    if (poss === 'home') this.possHome += s
    else if (poss === 'away') this.possAway += s
    this.ownerTime += s
    if (this.charging) this.charge = Math.min(1, this.charge + s / SHOT_CHARGE)
    // Defending with a player miles from the ball: hand you someone closer
    this.switchTimer -= s
    if (this.switchTimer <= 0 && poss !== 'home') {
      this.switchTimer = 0.6
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

    const chasers = this.chasers(poss)
    for (const f of this.players) this.think(f, poss, chasers, s)
    this.separate()
    this.updateSetPiece(s)
    if (this.mode !== 'playing') return
    this.moveBall(s)
    if (this.goalTimer > 0 || this.setPiece?.ready === false) return
    this.saves()
    this.collect()
    this.tackles()
  }

  /** Who goes for the ball: the CPU presses with one or two, your AI teammates only help when asked. */
  private chasers(poss: Team | null) {
    const set = new Set<Footballer>()
    if (this.setPiece) return set
    const b = this.ball
    for (const team of ['home', 'away'] as const) {
      if (poss === team) continue
      const side = this.teamOf(team).filter(
        (f) => f.role !== 'gk' && f !== this.controlled && f.stun <= 0 && f !== this.owner,
      )
      side.sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y))
      const first = side[0]
      if (!first) continue
      const d = dist(first.x, first.y, b.x, b.y)
      if (team === 'away') {
        set.add(first)
        if (this.level >= 3 && this.owner && side[1]) set.add(side[1])
      } else {
        const me = dist(this.controlled.x, this.controlled.y, b.x, b.y)
        // Press button, a loose ball nobody else is closer to, or an attacker running at him
        if (this.held.through || (poss === null && d < me - 1) || d < 3) set.add(first)
      }
    }
    return set
  }

  private think(f: Footballer, poss: Team | null, chasers: Set<Footballer>, s: number) {
    if (f.slide > 0) return this.sliding(f, s)
    if (f.dive > 0) return this.diving(f, s)
    if (f.stun > 0) return this.drive(f, 0, 0, s, 4)
    if (this.setPiece?.taker === f) return
    if (f.role === 'gk') return this.keeper(f, s)
    if (f === this.controlled) return this.human(f, s)
    if (f === this.owner) return this.cpuOwner(f, s)
    if (f === this.passTarget) return this.receive(f, s)
    if (chasers.has(f)) return this.chase(f, s)
    this.support(f, poss, s)
  }

  private drive(f: Footballer, vx: number, vy: number, s: number, accel = 7) {
    const k = Math.min(1, s * accel)
    f.vx += (vx - f.vx) * k
    f.vy += (vy - f.vy) * k
    f.x = clamp(f.x + f.vx * s, -2.5, PITCH_W + 2.5)
    f.y = clamp(f.y + f.vy * s, -1.5, PITCH_H + 1.5)
    const sp = Math.hypot(f.vx, f.vy)
    if (sp > 0.5) this.face(f, f.vx, f.vy, s * (this.owner === f ? 9 : 12))
    f.phase += sp * s * 1.5
    // Opponents keep their distance at set pieces
    const sp2 = this.setPiece
    if (sp2 && f.team !== sp2.team) {
      const r = sp2.kind === 'throw' ? 3 : 8
      const bx = this.ball.x
      const by = this.ball.y
      const n = norm(f.x - bx, f.y - by)
      if (n.d < r && n.d > 0) {
        f.x = bx + n.x * r
        f.y = by + n.y * r
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
    if (sprint && f.stamina > 0.05 && Math.hypot(f.vx, f.vy) > 2) {
      f.stamina = Math.max(0, f.stamina - s * 0.16)
      return lerp(RUN_SPEED, SPRINT_SPEED, Math.min(1, f.stamina / 0.25)) * f.pace
    }
    f.stamina = Math.min(1, f.stamina + s * 0.06)
    return RUN_SPEED * f.pace
  }

  private cpuPace() {
    return Math.min(1.08, 0.9 + this.level * 0.035)
  }

  private human(f: Footballer, s: number) {
    // A pass on its way to you: run onto it until you take over with the stick
    if (this.passTarget === f && Math.hypot(this.input.x, this.input.y) < 0.2) return this.receive(f, s)
    const top = this.topSpeed(f, this.held.sprint, s) * (this.owner === f ? DRIBBLE : 1)
    this.drive(f, this.input.x * top, this.input.y * top, s, 9)
    if (Math.hypot(this.input.x, this.input.y) < 0.1) this.faceBall(f, s)
  }

  private cpuOwner(f: Footballer, s: number) {
    const line = this.targetLine(f.team)
    const dg = dist(f.x, f.y, this.cx, line)
    const pressure = this.nearestRivalDist(f)
    f.think -= s
    if (f.think <= 0 && this.ownerTime > 0.25) {
      f.think = 0.2 + Math.random() * 0.25
      const angleOk = Math.abs(f.x - this.cx) < dg * 0.75 + 2
      if (angleOk && (dg < 11 || (dg < 22 && Math.random() < 0.18 + this.level * 0.02))) {
        return this.shoot(f, clamp(0.35 + Math.random() * 0.4 + dg * 0.008, 0, 0.85), null)
      }
      const opt = this.bestPass(f, false)
      if (opt && (pressure < 2.4 || (opt.score > 2.4 && Math.random() < 0.35) || Math.random() < 0.06)) {
        return this.passBall(f, opt.r.x, opt.r.y, opt.r, opt.lofted ? 'lofted' : 'ground')
      }
    }
    // Dribble toward goal, bending away from defenders in the way and off the touchlines
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
    const free = pressure > 5 && f.stamina > 0.3
    const top = this.topSpeed(f, free, s) * DRIBBLE * this.cpuPace()
    this.drive(f, n.x * top, n.y * top, s)
  }

  /** Best place to meet the ball: the first point on its path this player can get to in time */
  private intercept(f: Footballer) {
    const b = this.ball
    const speed = RUN_SPEED * f.pace
    const k = b.z > 0.3 ? AIR_DRAG : ROLL_FRICTION
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
      if (f.team === 'away' && d > 1.4 && d < 2.6 && f.slide <= 0 && Math.random() < 0.0012 * Math.min(4, this.level)) {
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

  /** Off the ball: hold a shape that slides with the ball, mark nearby attackers when defending */
  private support(f: Footballer, poss: Team | null, s: number) {
    const b = this.toAttack(f.team, this.ball.x, this.ball.y)
    const att = poss === f.team
    const def = poss !== null && !att
    let ay = f.baseY + (b.ay - 0.45) * 0.62 + (att ? 0.1 : def ? -0.04 : 0)
    if (f.role === 'fwd' && att) ay += 0.05
    if (def && f.role !== 'fwd') ay = Math.min(ay, b.ay - (f.role === 'def' ? 0.06 : 0.01))
    const range = { def: [0.06, 0.62], mid: [0.16, 0.84], fwd: [0.3, 0.93], gk: [0, 0.2] }[f.role]
    ay = clamp(ay, range[0], range[1])
    let ax = f.baseX + (b.ax - 0.5) * 0.45
    ax = 0.5 + (ax - 0.5) * (att ? 1.12 : def ? 0.82 : 1)
    // Runs off the ball, so attackers don't stand still
    if (att) ax += Math.sin(this.time * 0.6 + f.num) * 0.05
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
    const d = dist(f.x, f.y, tx, ty)
    const speed = d > 6 ? RUN_SPEED * 0.95 : Math.max(1.2, d * 1.1)
    this.steer(f, tx, ty, Math.min(speed, this.topSpeed(f, d > 14, s)), s)
    this.faceBall(f, s)
  }

  private keeper(k: Footballer, s: number) {
    if (this.owner === k) {
      // Picked the ball up outside the hands-rule: just move it on
      const opt = this.bestPass(k, true)
      if (opt) return this.passBall(k, opt.r.x, opt.r.y, opt.r, opt.lofted ? 'lofted' : 'ground')
      return this.passBall(k, this.cx, PITCH_H / 2, null, 'lofted')
    }
    const home = k.team === 'home'
    const line = home ? PITCH_H : 0
    const b = this.ball
    const speed = home ? RUN_SPEED : RUN_SPEED * this.cpuPace()

    // A shot coming in: get across, or dive if there's no time
    const incoming = !this.owner && (home ? b.vy > 6 : b.vy < -6) && !this.keeperBeaten && this.lastTouch !== k.team
    if (incoming && k.stun <= 0) {
      const t = (k.y - b.y) / b.vy
      if (t > 0 && t < 1.6) {
        const px = b.x + b.vx * t
        if (Math.abs(px - this.cx) < GOAL_W / 2 + 1.5) {
          const gap = px - k.x
          const reflex = home ? 1 : Math.min(1, 0.6 + this.level * 0.07)
          if (Math.abs(gap) > 0.7 && t < 0.55) {
            k.dive = DIVE_TIME
            k.diveDir = Math.sign(gap)
            k.vx = Math.sign(gap) * Math.min(7.5 * reflex, Math.abs(gap) / Math.max(t, 0.15) * 1.1)
            k.vy = 0
            return
          }
          this.steer(k, px, k.y, SPRINT_SPEED * reflex, s)
          this.face(k, b.x - k.x, b.y - k.y, s * 6)
          return
        }
      }
    }

    // Come out for a loose ball in the box
    if (!this.owner && !this.setPiece && this.inOwnBox(k.team, b.x, b.y)) {
      const mine = this.nearestTo(this.players, b.x, b.y) === k
      if (mine || Math.hypot(b.vx, b.vy) < 7) {
        const p = this.intercept(k)
        if (this.inOwnBox(k.team, p.x, p.y)) return this.steer(k, p.x, p.y, SPRINT_SPEED, s)
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
    const decay = Math.exp(-2.5 * s)
    k.vx *= decay
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
    if (b.z < 0.5 && f.cooldown <= 0 && dist(footX, footY, b.x, b.y) < 0.8 && this.owner?.team !== f.team) {
      const victim = this.owner
      if (victim) victim.stun = 0.9
      this.owner = null
      this.passTarget = null
      this.setPiece = null
      b.vx = f.slideX * 7 + (Math.random() - 0.5) * 3
      b.vy = f.slideY * 7 + (Math.random() - 0.5) * 3
      b.vz = 0.8
      this.lastTouch = f.team
      this.keeperBeaten = false
      f.cooldown = 0.25
      audio.kick(0.45)
      if (victim) this.banner('CARRINHO!', '', 0.8, f.team === 'home' ? HOME_CSS : AWAY_CSS)
    }
    if (f.slide <= 0) f.stun = 0.45
  }

  private celebrate(s: number) {
    const hero = this.lastKicker?.team === this.scorer ? this.lastKicker : this.teamOf(this.scorer)[10]
    for (const f of this.players) {
      if (f.slide > 0) this.sliding(f, s)
      else if (f.dive > 0) this.diving(f, s)
      else if (f === hero) {
        // Off to the corner flag
        const cornerX = f.x < this.cx ? 0.5 : PITCH_W - 0.5
        this.steer(f, cornerX, this.targetLine(f.team) - this.attackDir(f.team) * 1.5, RUN_SPEED, s)
      } else if (f.team === this.scorer && f.role !== 'gk') {
        this.steer(f, hero.x, hero.y + 1.5, RUN_SPEED * 0.9, s)
      } else this.drive(f, 0, 0, s, 3)
    }
    this.separate()
  }

  /** Keeps players from overlapping each other. */
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
        a.x -= (n.x * overlap) / 2
        a.y -= (n.y * overlap) / 2
        b.x += (n.x * overlap) / 2
        b.y += (n.y * overlap) / 2
      }
    }
  }

  private moveBall(s: number) {
    const b = this.ball
    const o = this.owner
    if (this.setPiece) return
    if (o) {
      // Dribbling: the ball runs a touch ahead of the feet, nudged forward every stride
      const sp = Math.hypot(o.vx, o.vy)
      const touch = 0.2 * (0.5 + 0.5 * Math.sin(o.phase * Math.PI * 2)) * Math.min(1, sp / RUN_SPEED)
      const ahead = PLAYER_R + BALL_R + 0.08 + (sp / SPRINT_SPEED) * 0.3 + touch
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
    b.vz -= GRAVITY * s
    b.z += b.vz * s
    if (b.z <= 0) {
      b.z = 0
      if (b.vz < -1.5) {
        if (b.vz < -4) audio.bounce()
        b.vz = -b.vz * 0.45
      } else b.vz = 0
    }
    const decay = Math.exp(-(b.z > 0.02 ? AIR_DRAG : ROLL_FRICTION) * s)
    b.vx *= decay
    b.vy *= decay
    b.x += b.vx * s
    b.y += b.vy * s

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
    audio.post()
    this.shake = Math.max(this.shake, 0.25)
    this.banner('POSTE!', '', 0.9, '#f8fafc')
  }

  /** After a goal the ball stays inside the net */
  private inNet() {
    const b = this.ball
    const top = b.y < PITCH_H / 2
    const back = top ? -GOAL_DEPTH + BALL_R : PITCH_H + GOAL_DEPTH - BALL_R
    if (top ? b.y < back : b.y > back) {
      b.y = back
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

  /** Shots that reach a keeper's hands */
  private saves() {
    const b = this.ball
    if (this.owner || this.keeperBeaten || this.setPiece) return
    const sp = Math.hypot(b.vx, b.vy)
    if (sp < 6) return
    for (const k of [this.keeperOf('home'), this.keeperOf('away')]) {
      if (this.lastTouch === k.team || (k.stun > 0 && k.dive <= 0)) continue
      if (!(k.team === 'home' ? b.vy > 0 : b.vy < 0)) continue
      const diving = k.dive > 0
      const reach = diving ? 1.3 : 0.8
      if (dist(b.x, b.y, k.x, k.y) > reach || b.z > (diving ? 1.8 : 2.45)) continue
      const base = k.team === 'home' ? 0.72 : Math.min(0.9, 0.42 + this.level * 0.07)
      const chance = base * (1 - clamp((sp - 20) / 30, 0, 0.4))
      if (Math.random() < chance) {
        if (sp < (diving ? 18 : 24) && Math.random() < 0.55) {
          this.giveBall(k)
          this.setPiece = { kind: 'keeper', team: k.team, taker: k, x: k.x, y: k.y, ready: true, wait: 1.2 }
          if (k.team === 'away') this.autoSwitch(true)
        } else {
          // Parried away from goal
          b.vy = -b.vy * 0.3
          b.vx = (Math.random() - 0.5) * 8 + Math.sign(b.x - k.x || 1) * 4
          b.vz = 2 + Math.random() * 2
          this.lastTouch = k.team
          k.cooldown = 0.4
          audio.bounce()
        }
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
      this.setPiece = { kind: 'keeper', team: best.team, taker: best, x: best.x, y: best.y, ready: true, wait: 1 }
      if (best.team === 'away') this.autoSwitch(true)
      return
    }
    if (best === this.passTarget || sp < 12 || Math.random() < 0.4) {
      this.giveBall(best)
      return
    }
    // Too hot to handle: it comes off him
    b.vx = b.vx * -0.25 + (Math.random() - 0.5) * 5
    b.vy = b.vy * -0.25 + (Math.random() - 0.5) * 5
    b.vz = 1.5
    this.lastTouch = best.team
    best.cooldown = 0.4
    this.passTarget = null
    audio.bounce()
  }

  /** Standing tackles: run into the dribbler to try and nick it */
  private tackles() {
    const o = this.owner
    if (!o || this.setPiece || this.ownerTime < 0.35) return
    for (const f of this.rivals(o.team)) {
      if (f.stun > 0 || f.slide > 0 || f.tackleCd > 0 || f.role === 'gk') continue
      if (dist(f.x, f.y, o.x, o.y) > TACKLE_R) continue
      f.tackleCd = 0.75
      let chance = f.team === 'away' ? Math.min(0.55, 0.18 + this.level * 0.05) : f === this.controlled ? 0.5 : 0.3
      // From behind is much harder
      if (o.fx * (f.x - o.x) + o.fy * (f.y - o.y) < -0.3) chance *= 0.5
      if (Math.random() >= chance) continue
      o.cooldown = 0.5
      if (Math.random() < 0.6) {
        this.giveBall(f)
      } else {
        const n = norm(this.ball.x - f.x, this.ball.y - f.y)
        this.owner = null
        this.ball.vx = n.x * 4 + (Math.random() - 0.5) * 3
        this.ball.vy = n.y * 4 + (Math.random() - 0.5) * 3
        this.lastTouch = f.team
      }
      audio.kick(0.25)
      return
    }
  }

  private goal(scorer: Team) {
    const home = scorer === 'home'
    if (home) this.home++
    else this.away++
    this.scorer = scorer
    this.goalTimer = GOAL_PAUSE
    this.owner = null
    this.passTarget = null
    this.charging = false
    this.shake = 0.8
    this.flash = 1
    this.flashColor = home ? HOME_CSS : AWAY_CSS
    this.banner(home ? 'GOLO!' : 'GOLO CPU', `${this.home} - ${this.away}`, 2.4, home ? HOME_CSS : AWAY_CSS)
    this.confetti(home ? HOME_CSS : AWAY_CSS)
    if (home) audio.goal()
    else audio.conceded()
    this.emit()
  }

  private fullTime() {
    this.clock = MATCH_TIME
    this.mode = 'over'
    this.charging = false
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
    const dt = Math.min(t - (this.lastFrame || t), 100) / 1000
    this.lastFrame = t
    if (this.mode === 'playing') {
      this.acc += dt
      while (this.acc >= STEP && this.mode === 'playing') {
        this.step(STEP)
        this.acc -= STEP
      }
    } else {
      this.acc = 0
      this.time += dt * 0.3
    }
    this.emit()
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

    // Broadcast-style camera from behind your goal, following the play
    let tx = o ? o.x + o.fx * 3 : b.x + b.vx * 0.25
    let ty = o ? o.y + o.fy * 3 : b.y + b.vy * 0.25
    // Lean toward the player you control so he stays in shot
    const c0 = this.controlled
    if (c0 !== o && this.mode !== 'menu') {
      tx = lerp(tx, c0.x, 0.3)
      ty = lerp(ty, c0.y, 0.3)
    }
    const k = 1 - Math.exp(-dt * 2.6)
    this.focus.x += (clamp(tx, 8, PITCH_W - 8) - this.focus.x) * k
    this.focus.y += (clamp(ty, 6, PITCH_H + 2) - this.focus.y) * k
    const fx = this.focus.x - PITCH_W / 2
    const fz = this.focus.y - PITCH_H / 2
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    this.camera.position.set(fx * 0.85 + sx, 12.5 + sy, fz + 14)
    this.camera.lookAt(fx * 0.92, 0, fz - 3.5)
    this.sun.position.set(fx - 14, 34, fz + 16)
    this.sun.target.position.set(fx, 0, fz - 3)

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
      f.model.pose({
        phase: f.phase,
        speed: Math.min(1, Math.hypot(f.vx, f.vy) / SPRINT_SPEED),
        kick: f.kickT > 0 ? 0.35 + 0.65 * (1 - f.kickT / 0.35) : 0,
        slide: f.slide > 0 ? 1 : f.stun > 0 && f.diveDir === 0 ? Math.min(1, f.stun / 0.3) : 0,
        dive,
        celebrate: this.goalTimer > 0 && f.team === this.scorer && f.role !== 'gk',
        time: this.time + f.num,
      })
    }

    // Ball: rolls about the axis perpendicular to its motion
    this.ballMesh.position.set(b.x - PITCH_W / 2, b.z + BALL_R * 1.35, b.y - PITCH_H / 2)
    const speed = Math.hypot(b.vx, b.vy)
    if (speed > 0.05 && this.mode === 'playing') {
      this.v3.set(b.vy, 0, -b.vx).normalize()
      this.q.setFromAxisAngle(this.v3, (speed * dt) / BALL_R)
      this.ballMesh.quaternion.premultiply(this.q)
    }

    const c = this.controlled
    const cX = c.x - PITCH_W / 2
    const cZ = c.y - PITCH_H / 2
    const pulse = 0.75 + Math.sin(this.time * 8) * 0.2
    this.ring.position.set(cX, 0.03, cZ)
    this.ring.scale.setScalar(pulse * 0.15 + 0.9)
    this.aimArc.position.set(cX, 0.03, cZ)
    this.aimArc.rotation.y = Math.atan2(c.fx, c.fy)
    this.aimArc.visible = this.owner === c
    this.arrow.position.set(cX, 2.35 + Math.sin(this.time * 5) * 0.08, cZ)
    this.arrow.rotation.y += dt * 2
    const visible = this.mode !== 'menu'
    this.ring.visible = this.arrow.visible = visible
    if (!visible) this.aimArc.visible = false
    const r = this.passTarget
    this.receiverRing.visible = !!r && r.team === 'away'
    if (r) this.receiverRing.position.set(r.x - PITCH_W / 2, 0.03, r.y - PITCH_H / 2)

    this.renderer.render(this.scene, this.camera)
    this.drawOverlay()
  }

  private drawOverlay() {
    const { octx: g, w, h } = this
    g.clearRect(0, 0, w, h)

    if (this.mode !== 'menu') {
      const c = this.controlled
      const head = this.project(c.x, 2.75, c.y)
      if (!head.behind) {
        // Stamina, and shot power while charging
        const bw = 34
        g.fillStyle = 'rgba(0, 0, 0, 0.5)'
        g.fillRect(head.x - bw / 2 - 1, head.y - 1, bw + 2, 5)
        g.fillStyle = c.stamina > 0.3 ? '#a3e635' : '#f97316'
        g.fillRect(head.x - bw / 2, head.y, bw * c.stamina, 3)
        if (this.charging) {
          g.fillStyle = 'rgba(0, 0, 0, 0.55)'
          g.fillRect(head.x - bw / 2 - 1, head.y - 9, bw + 2, 7)
          g.fillStyle = this.charge > 0.85 ? '#ef4444' : this.charge > 0.6 ? '#fde047' : '#22d3ee'
          g.fillRect(head.x - bw / 2, head.y - 8, bw * this.charge, 5)
        }
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
      g.font = `900 ${Math.round((big ? 38 : 18) * scale)}px Orbitron, sans-serif`
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

  /** Mini-map in the bottom corner with every player, the ball and you highlighted */
  private drawRadar() {
    const g = this.octx
    const rw = Math.min(70, this.w * 0.17)
    const rh = (rw * PITCH_H) / PITCH_W
    const x0 = this.w - rw - 8
    const y0 = this.h - rh - 8
    g.fillStyle = 'rgba(4, 12, 8, 0.55)'
    g.fillRect(x0, y0, rw, rh)
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    g.lineWidth = 1
    g.strokeRect(x0 + 0.5, y0 + 0.5, rw - 1, rh - 1)
    g.beginPath()
    g.moveTo(x0, y0 + rh / 2)
    g.lineTo(x0 + rw, y0 + rh / 2)
    g.stroke()
    g.strokeRect(x0 + rw * 0.21, y0 + 0.5, rw * 0.58, (rh * BOX_D) / PITCH_H)
    g.strokeRect(x0 + rw * 0.21, y0 + rh - (rh * BOX_D) / PITCH_H - 0.5, rw * 0.58, (rh * BOX_D) / PITCH_H)
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
