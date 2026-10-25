import { audio } from './audio'

// World units: the pitch is FIELD_W units wide; its length follows the canvas aspect ratio.
const FIELD_W = 10
const MARGIN_X = 0.45
const MARGIN_Y = 0.75
const GOAL_W = 3
const GOAL_DEPTH = 0.55
const PLAYER_R = 0.32
const BALL_R = 0.17
const PLAYER_SPEED = 4.3
const CPU_SPEED = 3
const CPU_SPEED_STEP = 0.25
const CPU_MAX_SPEED = 4.5
const GK_SPEED = 2.3
const KICK_POWER = 10
const KICK_REACH = 0.38
const KICK_COOLDOWN = 0.3
const BALL_FRICTION = 1.1
const WALL_BOUNCE = 0.7
/** Real seconds per match; the HUD shows it as 90 minutes */
const MATCH_TIME = 90
const KICKOFF_FREEZE = 1.4

const BEST_KEY = 'kitumba-football:best'

export type GameMode = 'menu' | 'playing' | 'paused' | 'over'
export type MatchResult = 'win' | 'draw' | 'loss'

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
}

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

interface Footballer extends Body {
  team: 'home' | 'away'
  keeper: boolean
  /** Facing direction, used for kicks and the arrow drawn on the player */
  fx: number
  fy: number
  cooldown: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  hue: number
}

interface FloatText {
  x: number
  y: number
  text: string
  life: number
  hue: number
  big: boolean
}

const HOME_HUE = 185
const AWAY_HUE = 300

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

const norm = (x: number, y: number) => {
  const d = Math.hypot(x, y)
  return d > 1e-6 ? { x: x / d, y: y / d, d } : { x: 0, y: 0, d: 0 }
}

export class FootballGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private onChange: (hud: HudState) => void
  private resizeObserver: ResizeObserver
  private raf = 0
  private lastFrame = 0
  private lastHud = ''

  private w = 0
  private h = 0
  private unit = 0
  /** Pitch length in units */
  private fieldH = 0

  private mode: GameMode = 'menu'
  private ball: Body = { x: 0, y: 0, vx: 0, vy: 0 }
  private player!: Footballer
  private cpu!: Footballer
  private homeKeeper!: Footballer
  private awayKeeper!: Footballer
  private input = { x: 0, y: 0 }
  private home = 0
  private away = 0
  private clock = 0
  /** Seconds left before play resumes after a kickoff */
  private freeze = 0
  private level = 1
  private streak = 0
  private best = readBest()
  private newBest = false
  private result: MatchResult | null = null
  private trail: { x: number; y: number }[] = []
  private time = 0
  private shake = 0
  private flash = 0
  private flashHue = HOME_HUE
  private particles: Particle[] = []
  private texts: FloatText[] = []

  constructor(canvas: HTMLCanvasElement, onChange: (hud: HudState) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.onChange = onChange
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.kickoff()
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    audio.stopCrowd()
  }

  // ---------------- Public controls ----------------

  /** Starts a match at the current division (it goes up after each win). */
  start() {
    audio.unlock()
    this.home = 0
    this.away = 0
    this.clock = 0
    this.result = null
    this.newBest = false
    this.particles = []
    this.texts = []
    this.kickoff()
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

  /** Movement vector from keyboard or joystick; each axis in [-1, 1]. */
  setInput(x: number, y: number) {
    const n = norm(x, y)
    const len = Math.min(1, n.d)
    this.input = { x: n.x * len, y: n.y * len }
  }

  kick() {
    if (this.mode !== 'playing' || this.freeze > 0) return
    const p = this.player
    if (p.cooldown > 0) return
    p.cooldown = KICK_COOLDOWN
    const d = Math.hypot(this.ball.x - p.x, this.ball.y - p.y)
    if (d > PLAYER_R + BALL_R + KICK_REACH) {
      audio.whiff()
      return
    }
    // A shot toward goal that would go just wide is pulled inside the near post
    let { fx, fy } = p
    if (fy < -0.3) {
      const lineX = this.ball.x + (fx * (this.top - this.ball.y)) / fy
      const inside = GOAL_W / 2 - 0.35
      const wide = Math.abs(lineX - this.cx) - inside
      if (wide > 0 && wide < 1.5) {
        const g = norm(this.cx + Math.sign(lineX - this.cx) * inside - this.ball.x, this.top - this.ball.y)
        fx = g.x
        fy = g.y
      }
    }
    this.strike(p, fx, fy, KICK_POWER)
  }

  // ---------------- Internals ----------------

  private emit() {
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
    }
    const key = JSON.stringify(hud)
    if (key === this.lastHud) return
    this.lastHud = key
    this.onChange(hud)
  }

  private resize() {
    // clientWidth ignores CSS 3D transforms, unlike getBoundingClientRect
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.w = w
    this.h = h
    this.unit = w / FIELD_W
    this.fieldH = h / this.unit
  }

  // Pitch bounds in units (the touchlines and goal lines)
  private get left() {
    return MARGIN_X
  }
  private get right() {
    return FIELD_W - MARGIN_X
  }
  private get top() {
    return MARGIN_Y
  }
  private get bottom() {
    return this.fieldH - MARGIN_Y
  }
  private get cx() {
    return FIELD_W / 2
  }
  private get cy() {
    return this.fieldH / 2
  }

  private footballer(team: Footballer['team'], keeper: boolean, x: number, y: number): Footballer {
    return { team, keeper, x, y, vx: 0, vy: 0, fx: 0, fy: team === 'home' ? -1 : 1, cooldown: 0 }
  }

  /** Puts everyone back in their half and the ball on the centre spot. */
  private kickoff() {
    const { cx, cy } = this
    this.ball = { x: cx, y: cy, vx: 0, vy: 0 }
    this.trail = []
    this.player = this.footballer('home', false, cx, cy + 1.6)
    this.cpu = this.footballer('away', false, cx, cy - 1.6)
    this.homeKeeper = this.footballer('home', true, cx, this.bottom - 0.6)
    this.awayKeeper = this.footballer('away', true, cx, this.top + 0.6)
    this.freeze = KICKOFF_FREEZE
  }

  private get footballers() {
    return [this.player, this.cpu, this.homeKeeper, this.awayKeeper]
  }

  private strike(f: Footballer, dx: number, dy: number, power: number) {
    const n = norm(dx, dy)
    this.ball.vx = n.x * power + f.vx * 0.3
    this.ball.vy = n.y * power + f.vy * 0.3
    // A ball behind the kicker is hooked round to the front, so the dribble collision doesn't eat the kick
    if ((this.ball.x - f.x) * n.x + (this.ball.y - f.y) * n.y < 0) {
      this.ball.x = f.x + n.x * (PLAYER_R + BALL_R + 0.02)
      this.ball.y = f.y + n.y * (PLAYER_R + BALL_R + 0.02)
    }
    f.cooldown = KICK_COOLDOWN
    audio.kick(power / KICK_POWER)
    if (power > KICK_POWER * 0.6) this.burst(this.ball.x, this.ball.y, f.team === 'home' ? HOME_HUE : AWAY_HUE, 8, 0.08)
  }

  private step(s: number) {
    if (this.freeze > 0) {
      this.freeze -= s
      if (this.freeze <= 0) audio.whistle()
      return
    }

    this.clock += s
    if (this.clock >= MATCH_TIME) return this.fullTime()

    for (const f of this.footballers) f.cooldown = Math.max(0, f.cooldown - s)

    this.movePlayer(s)
    this.moveCpu(s)
    this.moveKeeper(this.homeKeeper, s)
    this.moveKeeper(this.awayKeeper, s)
    this.separate()
    this.moveBall(s)
    if (this.mode !== 'playing' || this.freeze > 0) return
    for (const f of this.footballers) this.touchBall(f)
    this.emit()
  }

  private steerTo(f: Footballer, tx: number, ty: number, speed: number, s: number) {
    const n = norm(tx - f.x, ty - f.y)
    // Slow down on arrival so players don't jitter around their target
    const v = speed * Math.min(1, n.d / 0.4)
    this.accelerate(f, n.x * v, n.y * v, s)
  }

  private accelerate(f: Footballer, vx: number, vy: number, s: number) {
    const k = Math.min(1, s * 12)
    f.vx += (vx - f.vx) * k
    f.vy += (vy - f.vy) * k
    f.x = clamp(f.x + f.vx * s, this.left + PLAYER_R, this.right - PLAYER_R)
    f.y = clamp(f.y + f.vy * s, this.top + PLAYER_R, this.bottom - PLAYER_R)
    const n = norm(vx, vy)
    if (n.d > 0.5) {
      f.fx = n.x
      f.fy = n.y
    }
  }

  private movePlayer(s: number) {
    this.accelerate(this.player, this.input.x * PLAYER_SPEED, this.input.y * PLAYER_SPEED, s)
  }

  private moveCpu(s: number) {
    const c = this.cpu
    const b = this.ball
    const speed = Math.min(CPU_MAX_SPEED, CPU_SPEED + (this.level - 1) * CPU_SPEED_STEP)
    // The CPU attacks downward, toward the player's goal
    const goal = { x: this.cx, y: this.bottom + GOAL_DEPTH }
    const aim = norm(goal.x - b.x, goal.y - b.y)
    // Get behind the ball (on the side away from the goal), then push through it
    const behind = { x: b.x - aim.x * (PLAYER_R + BALL_R + 0.1), y: b.y - aim.y * (PLAYER_R + BALL_R + 0.1) }
    const toBehind = Math.hypot(behind.x - c.x, behind.y - c.y)
    const lined = (c.x - b.x) * aim.x + (c.y - b.y) * aim.y < 0

    // With the ball in front of it, the CPU dribbles with short taps toward goal and shoots when close.
    // Taps instead of pushing with the body also get the ball off the touchline, where it can't get behind it.
    const reach = Math.hypot(b.x - c.x, b.y - c.y) < PLAYER_R + BALL_R + KICK_REACH
    const ahead = (b.x - c.x) * aim.x + (b.y - c.y) * aim.y > 0
    if (reach && ahead && c.cooldown <= 0) {
      const dist = Math.hypot(goal.x - b.x, goal.y - b.y)
      if (dist < 4 + this.level * 0.3 || (dist < 7 && Math.random() < 0.15)) {
        // Aim at a random spot inside the goal; lower divisions miss more
        const spread = GOAL_W * (0.75 + Math.max(0, 0.6 - this.level * 0.1))
        const tx = this.cx + (Math.random() - 0.5) * spread
        this.strike(c, tx - b.x, this.bottom - b.y, KICK_POWER * (0.75 + Math.min(0.2, this.level * 0.03)))
      } else {
        this.strike(c, aim.x, aim.y, KICK_POWER * 0.42)
      }
      return this.accelerate(c, 0, 0, s)
    }
    if (lined && toBehind < 0.45) return this.steerTo(c, b.x + aim.x, b.y + aim.y, speed * 0.85, s)
    if (!lined) {
      // Wrong side of the ball: loop around it instead of knocking it back toward our own goal
      const px = -aim.y
      const py = aim.x
      const side = (c.x - b.x) * px + (c.y - b.y) * py < 0 ? -1 : 1
      const tx = clamp(b.x - aim.x * 0.7 + px * side * 0.9, this.left + PLAYER_R, this.right - PLAYER_R)
      const ty = clamp(b.y - aim.y * 0.7 + py * side * 0.9, this.top + PLAYER_R, this.bottom - PLAYER_R)
      // Pinned against a line with no way round: just go for the ball
      if (Math.hypot(tx - c.x, ty - c.y) < 0.3) return this.steerTo(c, b.x, b.y, speed, s)
      return this.steerTo(c, tx, ty, speed, s)
    }
    this.steerTo(c, behind.x, behind.y, speed, s)
  }

  private moveKeeper(k: Footballer, s: number) {
    const b = this.ball
    const home = k.team === 'home'
    const line = home ? this.bottom : this.top
    const dir = home ? -1 : 1
    const speed = home ? GK_SPEED : GK_SPEED + Math.min(1, (this.level - 1) * 0.15)
    const ballDist = Math.hypot(b.x - k.x, b.y - k.y)
    const inBox = Math.abs(b.y - line) < 2.2 && Math.abs(b.x - this.cx) < GOAL_W / 2 + 1.2
    // Shots are only stopped if they hit the keeper; a loose ball can be rushed and cleared
    const loose = Math.hypot(b.vx, b.vy) < 4

    let tx: number
    let ty: number
    if (loose && inBox && ballDist < 1.6) {
      tx = b.x
      ty = b.y
    } else {
      // Stand on the line between the ball and the middle of the goal, leaving the corners open
      tx = clamp(this.cx + (b.x - this.cx) * 0.45, this.cx - GOAL_W / 2 + 0.5, this.cx + GOAL_W / 2 - 0.5)
      ty = line + dir * 0.5
    }
    tx = clamp(tx, this.cx - GOAL_W / 2 - 0.6, this.cx + GOAL_W / 2 + 0.6)
    ty = home ? clamp(ty, line - 2, line - PLAYER_R) : clamp(ty, line + PLAYER_R, line + 2)
    // A shot is too fast to follow fully: reflexes improve with the division
    const reflex = home ? 0.6 : Math.min(0.9, 0.3 + (this.level - 1) * 0.08)
    this.steerTo(k, tx, ty, loose ? speed : speed * reflex, s)

    // Clear a loose ball upfield, away from the middle of the goal
    if (loose && k.cooldown <= 0 && ballDist < PLAYER_R + BALL_R + KICK_REACH * 0.8) {
      const side = b.x < this.cx ? -1 : 1
      this.strike(k, side * (0.4 + Math.random() * 0.6), dir, KICK_POWER * 0.85)
      k.cooldown = 0.6
    }
  }

  /** Keeps players from overlapping each other. */
  private separate() {
    const fs = this.footballers
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i]
        const b = fs[j]
        const n = norm(b.x - a.x, b.y - a.y)
        const overlap = PLAYER_R * 2 - n.d
        if (overlap <= 0 || n.d === 0) continue
        a.x -= (n.x * overlap) / 2
        a.y -= (n.y * overlap) / 2
        b.x += (n.x * overlap) / 2
        b.y += (n.y * overlap) / 2
      }
    }
  }

  /** Running into the ball pushes it along: that's dribbling. */
  private touchBall(f: Footballer) {
    const b = this.ball
    const n = norm(b.x - f.x, b.y - f.y)
    const min = PLAYER_R + BALL_R
    if (n.d >= min) return
    if (n.d === 0) {
      n.x = f.fx
      n.y = f.fy
    }
    b.x = f.x + n.x * min
    b.y = f.y + n.y * min
    const rel = (b.vx - f.vx) * n.x + (b.vy - f.vy) * n.y
    if (rel < 0) {
      b.vx -= 1.25 * rel * n.x
      b.vy -= 1.25 * rel * n.y
    }
  }

  private moveBall(s: number) {
    const b = this.ball
    const decay = Math.exp(-BALL_FRICTION * s)
    b.vx *= decay
    b.vy *= decay
    b.x += b.vx * s
    b.y += b.vy * s

    const inMouth = Math.abs(b.x - this.cx) < GOAL_W / 2 - BALL_R
    // Past the goal line inside the mouth: goal
    if (inMouth && b.y < this.top - BALL_R) return this.goal('home')
    if (inMouth && b.y > this.bottom + BALL_R) return this.goal('away')

    let bounced = false
    if (b.x < this.left + BALL_R) {
      b.x = this.left + BALL_R
      b.vx = Math.abs(b.vx) * WALL_BOUNCE
      bounced = true
    } else if (b.x > this.right - BALL_R) {
      b.x = this.right - BALL_R
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE
      bounced = true
    }
    if (!inMouth) {
      if (b.y < this.top + BALL_R) {
        b.y = this.top + BALL_R
        b.vy = Math.abs(b.vy) * WALL_BOUNCE
        bounced = true
      } else if (b.y > this.bottom - BALL_R) {
        b.y = this.bottom - BALL_R
        b.vy = -Math.abs(b.vy) * WALL_BOUNCE
        bounced = true
      }
    }
    // Hitting the woodwork
    const near = Math.abs(Math.abs(b.x - this.cx) - GOAL_W / 2) < BALL_R * 1.5
    const onLine = Math.abs(b.y - this.top) < BALL_R * 2 || Math.abs(b.y - this.bottom) < BALL_R * 2
    if (bounced && Math.hypot(b.vx, b.vy) > 2.5) {
      if (near && onLine) {
        audio.post()
        this.shake = Math.max(this.shake, 4)
      } else audio.bounce()
    }

    this.trail.push({ x: b.x, y: b.y })
    if (this.trail.length > 10) this.trail.shift()
  }

  private goal(scorer: 'home' | 'away') {
    const home = scorer === 'home'
    if (home) this.home++
    else this.away++
    const hue = home ? HOME_HUE : AWAY_HUE
    this.shake = 12
    this.flash = 1
    this.flashHue = hue
    const gy = home ? this.top : this.bottom
    this.burst(this.cx, gy, hue, 60, 0.35)
    this.burst(this.cx, gy, 50, 30, 0.25)
    this.texts.push({
      x: this.w / 2,
      y: this.h / 2,
      text: home ? 'GOLO!' : 'GOLO CPU',
      life: 1500,
      hue,
      big: true,
    })
    if (home) audio.goal()
    else audio.conceded()
    this.kickoff()
    this.freeze = KICKOFF_FREEZE + 0.6
    this.emit()
  }

  private fullTime() {
    this.clock = MATCH_TIME
    this.mode = 'over'
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

  private burst(ux: number, uy: number, hue: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 0.03 + Math.random() * power
      const max = 400 + Math.random() * 600
      this.particles.push({
        x: ux * this.unit,
        y: uy * this.unit,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: max,
        max,
        size: 1 + Math.random() * 3,
        hue: hue + (Math.random() * 30 - 15),
      })
    }
  }

  private frame = (t: number) => {
    const dt = Math.min(t - (this.lastFrame || t), 100)
    this.lastFrame = t
    this.time += dt

    if (this.mode === 'playing') {
      // Sub-steps keep fast kicks from tunnelling through players and walls
      const steps = Math.ceil(dt / 8)
      for (let i = 0; i < steps && this.mode === 'playing'; i++) this.step(dt / steps / 1000)
    }

    this.update(dt)
    this.render()
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 0.97
      p.vy *= 0.97
      p.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
    for (const t of this.texts) {
      t.life -= dt
      t.y -= dt * 0.02
    }
    this.texts = this.texts.filter((t) => t.life > 0)
    this.shake = Math.max(0, this.shake - dt * 0.03)
    this.flash = Math.max(0, this.flash - dt * 0.0025)
  }

  // ---------------- Rendering ----------------

  private render() {
    const { ctx, w, h, unit } = this
    ctx.save()
    ctx.clearRect(0, 0, w, h)
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    }

    this.drawPitch()

    // Ball trail
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i]
      ctx.fillStyle = `rgba(236, 254, 255, ${(i / this.trail.length) * 0.25})`
      ctx.beginPath()
      ctx.arc(p.x * unit, p.y * unit, BALL_R * unit * (i / this.trail.length), 0, Math.PI * 2)
      ctx.fill()
    }

    for (const f of this.footballers) this.drawFootballer(f)
    this.drawBall()

    // Particles
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const a = p.life / p.max
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${a})`
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
    ctx.globalCompositeOperation = 'source-over'

    // Floating texts
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const t of this.texts) {
      ctx.font = `900 ${t.big ? 40 : 13}px Orbitron, sans-serif`
      ctx.fillStyle = `hsla(${t.hue}, 100%, 75%, ${Math.min(1, t.life / 400)})`
      ctx.shadowColor = `hsl(${t.hue}, 100%, 60%)`
      ctx.shadowBlur = 16
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.shadowBlur = 0

    // Kickoff countdown
    if (this.mode === 'playing' && this.freeze > 0 && this.freeze < KICKOFF_FREEZE) {
      ctx.font = '700 14px Orbitron, sans-serif'
      ctx.fillStyle = 'rgba(236, 254, 255, 0.75)'
      ctx.fillText('PONTAPÉ DE SAÍDA', w / 2, h / 2 + unit * 2.4)
    }

    if (this.flash > 0) {
      ctx.fillStyle = `hsla(${this.flashHue}, 100%, 60%, ${this.flash * 0.25})`
      ctx.fillRect(-20, -20, w + 40, h + 40)
    }
    ctx.restore()
  }

  private drawPitch() {
    const { ctx, w, h, unit } = this
    const L = this.left * unit
    const R = this.right * unit
    const T = this.top * unit
    const B = this.bottom * unit
    const cx = this.cx * unit
    const cy = this.cy * unit

    ctx.fillStyle = '#04060e'
    ctx.fillRect(-20, -20, w + 40, h + 40)

    // Mowing stripes
    const stripes = 10
    const sh = (B - T) / stripes
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#07111c' : '#081626'
      ctx.fillRect(L, T + i * sh, R - L, sh)
    }

    // Goals: the top one is the CPU's, the bottom one is yours
    const gw = GOAL_W * unit
    const gd = GOAL_DEPTH * unit
    for (const [y, hue, up] of [
      [T, AWAY_HUE, true],
      [B, HOME_HUE, false],
    ] as const) {
      ctx.fillStyle = `hsla(${hue}, 90%, 50%, 0.12)`
      ctx.fillRect(cx - gw / 2, up ? y - gd : y, gw, gd)
      // Net
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.18)`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = cx - gw / 2; x <= cx + gw / 2; x += unit * 0.25) {
        ctx.moveTo(x, y)
        ctx.lineTo(x, up ? y - gd : y + gd)
      }
      ctx.stroke()
      ctx.strokeStyle = `hsl(${hue}, 95%, 65%)`
      ctx.lineWidth = 3
      ctx.shadowColor = `hsl(${hue}, 95%, 55%)`
      ctx.shadowBlur = 14
      ctx.beginPath()
      ctx.moveTo(cx - gw / 2, y)
      ctx.lineTo(cx - gw / 2, up ? y - gd : y + gd)
      ctx.lineTo(cx + gw / 2, up ? y - gd : y + gd)
      ctx.lineTo(cx + gw / 2, y)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // Lines
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.55)'
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(34, 211, 238, 0.8)'
    ctx.shadowBlur = 8
    ctx.strokeRect(L, T, R - L, B - T)
    ctx.beginPath()
    ctx.moveTo(L, cy)
    ctx.lineTo(R, cy)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, unit * 1.3, 0, Math.PI * 2)
    ctx.stroke()
    // Penalty and goal areas
    const boxW = (GOAL_W + 2.4) * unit
    const boxH = 2.2 * unit
    const smallW = (GOAL_W + 0.8) * unit
    const smallH = 0.8 * unit
    ctx.strokeRect(cx - boxW / 2, T, boxW, boxH)
    ctx.strokeRect(cx - boxW / 2, B - boxH, boxW, boxH)
    ctx.strokeRect(cx - smallW / 2, T, smallW, smallH)
    ctx.strokeRect(cx - smallW / 2, B - smallH, smallW, smallH)
    ctx.beginPath()
    ctx.arc(cx, T + boxH, unit * 0.8, 0, Math.PI)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, B - boxH, unit * 0.8, Math.PI, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.fillStyle = 'rgba(103, 232, 249, 0.7)'
    for (const y of [cy, T + 1.5 * unit, B - 1.5 * unit]) {
      ctx.beginPath()
      ctx.arc(cx, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawFootballer(f: Footballer) {
    const { ctx, unit } = this
    const x = f.x * unit
    const y = f.y * unit
    const r = PLAYER_R * unit
    const hue = f.team === 'home' ? HOME_HUE : AWAY_HUE
    const you = f === this.player

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.beginPath()
    ctx.ellipse(x + r * 0.2, y + r * 0.35, r, r * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()

    // Selection ring under the player you control
    if (you) {
      const pulse = 0.5 + Math.sin(this.time / 180) * 0.2
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${pulse})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = f.keeper ? `hsla(${hue}, 60%, 10%, 0.95)` : `hsla(${hue}, 80%, 16%, 0.95)`
    ctx.strokeStyle = `hsl(${hue}, 95%, ${f.keeper ? 50 : 62}%)`
    ctx.lineWidth = f.keeper ? 2 : 2.5
    ctx.shadowColor = `hsl(${hue}, 95%, 55%)`
    ctx.shadowBlur = you ? 18 : 10
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    // Facing arrow
    const ax = x + f.fx * r * 0.95
    const ay = y + f.fy * r * 0.95
    ctx.fillStyle = `hsl(${hue}, 100%, 78%)`
    ctx.beginPath()
    ctx.moveTo(ax + f.fx * r * 0.45, ay + f.fy * r * 0.45)
    ctx.lineTo(ax - f.fy * r * 0.35, ay + f.fx * r * 0.35)
    ctx.lineTo(ax + f.fy * r * 0.35, ay - f.fx * r * 0.35)
    ctx.closePath()
    ctx.fill()

    if (f.keeper) {
      ctx.font = `700 ${Math.round(r * 0.9)}px Orbitron, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, 0.8)`
      ctx.fillText('GR', x, y + 1)
    }
  }

  private drawBall() {
    const { ctx, unit } = this
    const x = this.ball.x * unit
    const y = this.ball.y * unit
    const r = BALL_R * unit
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.beginPath()
    ctx.ellipse(x + r * 0.3, y + r * 0.4, r, r * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.shadowColor = '#e0f2fe'
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    // Panels spin with the distance the ball travels
    const spin = (this.ball.x + this.ball.y) * 3
    ctx.fillStyle = '#1e293b'
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
