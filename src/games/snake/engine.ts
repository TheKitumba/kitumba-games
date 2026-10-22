import { audio } from './audio'

export const COLS = 24
export const ROWS = 24

const BEST_KEY = 'neon-snake:best'
const COMBO_WINDOW = 2500
const FOODS_PER_LEVEL = 5
const BONUS_TTL = 6000

export type GameMode = 'menu' | 'playing' | 'paused' | 'over'

export interface HudState {
  mode: GameMode
  score: number
  best: number
  level: number
  length: number
  combo: number
  wrap: boolean
  newBest: boolean
}

interface Point {
  x: number
  y: number
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
    // storage unavailable — best score just won't persist
  }
}

export class SnakeGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private onChange: (hud: HudState) => void
  private resizeObserver: ResizeObserver
  private raf = 0
  private lastFrame = 0

  private w = 0
  private h = 0
  private cell = 0

  private mode: GameMode = 'menu'
  private snake: Point[] = []
  private prev: Point[] = []
  private dir: Point = { x: 1, y: 0 }
  private queue: Point[] = []
  private grow = 0
  private food: Point = { x: 0, y: 0 }
  private bonus: (Point & { ttl: number }) | null = null
  private score = 0
  private best = readBest()
  private newBest = false
  private level = 1
  private eaten = 0
  private combo = 0
  private lastEatAt = -Infinity
  private tickMs = 135
  private acc = 0
  private time = 0
  private shake = 0
  private flash = 0
  private deathAt = 0
  private wrap = false
  private particles: Particle[] = []
  private texts: FloatText[] = []

  constructor(canvas: HTMLCanvasElement, onChange: (hud: HudState) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.onChange = onChange
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.reset()
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
  }

  // ---------------- Public controls ----------------

  start() {
    audio.unlock()
    this.reset()
    this.mode = 'playing'
    audio.start()
    audio.bpm = 112
    audio.startMusic()
    this.emit()
  }

  togglePause() {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      audio.stopMusic()
    } else if (this.mode === 'paused') {
      this.mode = 'playing'
      audio.startMusic()
    } else return
    audio.pause()
    this.emit()
  }

  setWrap(wrap: boolean) {
    if (this.mode === 'playing' || this.mode === 'paused') return
    this.wrap = wrap
    this.emit()
  }

  setDirection(x: number, y: number) {
    if (this.mode !== 'playing') return
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir
    if ((x === -last.x && y === -last.y) || (x === last.x && y === last.y)) return
    if (this.queue.length < 3) {
      this.queue.push({ x, y })
      audio.turn()
    }
  }

  // ---------------- Internals ----------------

  private emit() {
    this.onChange({
      mode: this.mode,
      score: this.score,
      best: this.best,
      level: this.level,
      length: this.snake.length,
      combo: this.combo,
      wrap: this.wrap,
      newBest: this.newBest,
    })
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
    this.cell = w / COLS
  }

  private reset() {
    const y = Math.floor(ROWS / 2)
    this.snake = [
      { x: 8, y },
      { x: 7, y },
      { x: 6, y },
      { x: 5, y },
    ]
    this.prev = this.snake.map((p) => ({ ...p }))
    this.dir = { x: 1, y: 0 }
    this.queue = []
    this.grow = 0
    this.score = 0
    this.newBest = false
    this.level = 1
    this.eaten = 0
    this.combo = 0
    this.lastEatAt = -Infinity
    this.tickMs = 135
    this.acc = 0
    this.bonus = null
    this.particles = []
    this.texts = []
    this.food = this.randomFreeCell() ?? { x: 16, y }
  }

  private randomFreeCell(): Point | null {
    const taken = new Set(this.snake.map((p) => p.y * COLS + p.x))
    if (this.bonus) taken.add(this.bonus.y * COLS + this.bonus.x)
    if (this.food) taken.add(this.food.y * COLS + this.food.x)
    const free: number[] = []
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i)
    if (!free.length) return null
    const i = free[Math.floor(Math.random() * free.length)]
    return { x: i % COLS, y: Math.floor(i / COLS) }
  }

  private step() {
    if (this.queue.length) this.dir = this.queue.shift()!
    const old = this.snake
    const head = { x: old[0].x + this.dir.x, y: old[0].y + this.dir.y }

    if (this.wrap) {
      head.x = (head.x + COLS) % COLS
      head.y = (head.y + ROWS) % ROWS
    } else if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      return this.die()
    }

    const eatsFood = head.x === this.food.x && head.y === this.food.y
    const eatsBonus = !!this.bonus && head.x === this.bonus.x && head.y === this.bonus.y
    const willGrow = this.grow > 0 || eatsFood || eatsBonus
    // The tail moves away this tick unless we're growing
    const body = willGrow ? old : old.slice(0, -1)
    if (body.some((p) => p.x === head.x && p.y === head.y)) return this.die()

    this.prev = old.map((p) => ({ ...p }))
    this.snake = [head, ...old]

    if (eatsFood) this.eatFood(head)
    if (eatsBonus) this.eatBonus(head)

    if (this.grow > 0) {
      this.grow--
      this.prev.push({ ...old[old.length - 1] })
    } else {
      this.snake.pop()
    }
  }

  private multiplier() {
    return Math.min(1 + this.combo, 5)
  }

  private eatFood(at: Point) {
    this.combo = this.time - this.lastEatAt < COMBO_WINDOW ? this.combo + 1 : 0
    this.lastEatAt = this.time
    const pts = 10 * this.level * this.multiplier()
    this.addScore(pts, at, 300)
    this.grow += 1
    this.eaten++
    this.burst(at, 300, 22)
    audio.eat(this.combo)

    const next = this.randomFreeCell()
    if (!next) return this.die()
    this.food = next

    if (this.eaten % FOODS_PER_LEVEL === 0) this.levelUp()
    if (!this.bonus && Math.random() < 0.28) {
      const cell = this.randomFreeCell()
      if (cell) {
        this.bonus = { ...cell, ttl: BONUS_TTL }
        audio.bonusSpawn()
      }
    }
    this.emit()
  }

  private eatBonus(at: Point) {
    const pts = 50 * this.level * this.multiplier()
    this.addScore(pts, at, 45)
    this.grow += 3
    this.bonus = null
    this.burst(at, 45, 40)
    this.shake = 6
    audio.bonus()
    this.emit()
  }

  private levelUp() {
    this.level++
    this.tickMs = Math.max(55, 135 - (this.level - 1) * 9)
    audio.bpm = 112 + (this.level - 1) * 4
    this.flash = 1
    audio.levelUp()
    this.texts.push({
      x: this.w / 2,
      y: this.h / 2,
      text: `NÍVEL ${this.level}`,
      life: 1400,
      hue: 185,
    })
  }

  private addScore(pts: number, at: Point, hue: number) {
    this.score += pts
    if (this.score > this.best) {
      this.best = this.score
      this.newBest = true
      writeBest(this.best)
    }
    const label = this.multiplier() > 1 ? `+${pts}  x${this.multiplier()}` : `+${pts}`
    this.texts.push({
      x: (at.x + 0.5) * this.cell,
      y: at.y * this.cell,
      text: label,
      life: 900,
      hue,
    })
  }

  private die() {
    this.mode = 'over'
    this.deathAt = this.time
    this.shake = 14
    this.flash = 1
    audio.stopMusic()
    audio.die()
    this.snake.forEach((p, i) => this.burst(p, 185 + (i / this.snake.length) * 115, 6))
    this.prev = this.snake.map((p) => ({ ...p }))
    this.emit()
  }

  private burst(p: Point, hue: number, count: number) {
    const cx = (p.x + 0.5) * this.cell
    const cy = (p.y + 0.5) * this.cell
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 0.04 + Math.random() * 0.22
      const max = 400 + Math.random() * 500
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: max,
        max,
        size: 1 + Math.random() * 2.5,
        hue: hue + (Math.random() * 30 - 15),
      })
    }
  }

  private frame = (t: number) => {
    const dt = Math.min(t - (this.lastFrame || t), 100)
    this.lastFrame = t
    this.time += dt

    if (this.mode === 'playing') {
      this.acc += dt
      while (this.acc >= this.tickMs && this.mode === 'playing') {
        this.acc -= this.tickMs
        this.step()
      }
      if (this.bonus) {
        this.bonus.ttl -= dt
        if (this.bonus.ttl <= 0) this.bonus = null
      }
      if (this.combo > 0 && this.time - this.lastEatAt > COMBO_WINDOW) {
        this.combo = 0
        this.emit()
      }
    }

    this.update(dt)
    const alpha = this.mode === 'playing' ? Math.min(this.acc / this.tickMs, 1) : 1
    this.render(alpha)
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
      t.y -= dt * 0.03
    }
    this.texts = this.texts.filter((t) => t.life > 0)
    this.shake = Math.max(0, this.shake - dt * 0.03)
    this.flash = Math.max(0, this.flash - dt * 0.0025)
  }

  // ---------------- Rendering ----------------

  private render(alpha: number) {
    const c = this.ctx
    const { w, h, cell } = this
    c.save()
    c.clearRect(0, 0, w, h)

    if (this.shake > 0) {
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    }

    this.drawGrid()
    this.drawFood()
    this.drawBonus()
    this.drawSnake(alpha)

    // Particles (additive)
    c.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const a = p.life / p.max
      c.fillStyle = `hsla(${p.hue}, 100%, 65%, ${a})`
      c.beginPath()
      c.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2)
      c.fill()
    }
    c.globalCompositeOperation = 'source-over'

    // Floating texts
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    for (const t of this.texts) {
      const big = t.text.startsWith('NÍVEL')
      c.font = `700 ${big ? cell * 1.6 : cell * 0.6}px Orbitron, sans-serif`
      c.shadowColor = `hsl(${t.hue}, 100%, 60%)`
      c.shadowBlur = 16
      c.fillStyle = `hsla(${t.hue}, 100%, 85%, ${Math.min(1, t.life / 400)})`
      c.fillText(t.text, t.x, t.y)
    }
    c.shadowBlur = 0

    if (this.flash > 0) {
      c.fillStyle = this.mode === 'over'
        ? `rgba(255, 40, 90, ${this.flash * 0.35})`
        : `rgba(80, 230, 255, ${this.flash * 0.18})`
      c.fillRect(0, 0, w, h)
    }
    c.restore()
  }

  private drawGrid() {
    const c = this.ctx
    const { w, h, cell } = this
    c.fillStyle = '#040713'
    c.fillRect(0, 0, w, h)

    // Soft radial vignette glow
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7)
    g.addColorStop(0, 'rgba(56, 30, 120, 0.35)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)

    c.lineWidth = 1
    c.strokeStyle = 'rgba(56, 189, 248, 0.07)'
    c.beginPath()
    for (let i = 1; i < COLS; i++) {
      c.moveTo(Math.round(i * cell) + 0.5, 0)
      c.lineTo(Math.round(i * cell) + 0.5, h)
    }
    for (let i = 1; i < ROWS; i++) {
      c.moveTo(0, Math.round(i * cell) + 0.5)
      c.lineTo(w, Math.round(i * cell) + 0.5)
    }
    c.stroke()

    // Dots at intersections
    c.fillStyle = 'rgba(125, 211, 252, 0.18)'
    for (let x = 1; x < COLS; x++)
      for (let y = 1; y < ROWS; y++) c.fillRect(x * cell - 0.75, y * cell - 0.75, 1.5, 1.5)

    // Moving scan band
    const sy = ((this.time * 0.08) % (h + 120)) - 60
    const sg = c.createLinearGradient(0, sy - 60, 0, sy + 60)
    sg.addColorStop(0, 'rgba(34, 211, 238, 0)')
    sg.addColorStop(0.5, 'rgba(34, 211, 238, 0.06)')
    sg.addColorStop(1, 'rgba(34, 211, 238, 0)')
    c.fillStyle = sg
    c.fillRect(0, sy - 60, w, 120)

    // Wall glow in walled mode
    if (!this.wrap) {
      c.strokeStyle = 'rgba(244, 63, 94, 0.35)'
      c.lineWidth = 2
      c.shadowColor = '#f43f5e'
      c.shadowBlur = 12
      c.strokeRect(1, 1, w - 2, h - 2)
      c.shadowBlur = 0
    }
  }

  private drawFood() {
    const c = this.ctx
    const { cell, time } = this
    const cx = (this.food.x + 0.5) * cell
    const cy = (this.food.y + 0.5) * cell
    const pulse = 1 + Math.sin(time * 0.008) * 0.12

    c.save()
    c.translate(cx, cy)
    c.rotate(time * 0.002)
    c.strokeStyle = 'rgba(232, 121, 249, 0.6)'
    c.lineWidth = 1.5
    c.setLineDash([cell * 0.2, cell * 0.15])
    c.beginPath()
    c.arc(0, 0, cell * 0.55 * pulse, 0, Math.PI * 2)
    c.stroke()
    c.setLineDash([])
    c.restore()

    const g = c.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.36 * pulse)
    g.addColorStop(0, '#fff')
    g.addColorStop(0.35, '#f0abfc')
    g.addColorStop(1, '#c026d3')
    c.shadowColor = '#e879f9'
    c.shadowBlur = 22
    c.fillStyle = g
    c.beginPath()
    c.arc(cx, cy, cell * 0.32 * pulse, 0, Math.PI * 2)
    c.fill()
    c.shadowBlur = 0
  }

  private drawBonus() {
    const b = this.bonus
    if (!b) return
    if (b.ttl < 1500 && Math.floor(b.ttl / 120) % 2 === 0) return
    const c = this.ctx
    const { cell, time } = this
    const cx = (b.x + 0.5) * cell
    const cy = (b.y + 0.5) * cell
    const r = cell * 0.42

    // Countdown ring
    c.strokeStyle = 'rgba(250, 204, 21, 0.8)'
    c.lineWidth = 2
    c.beginPath()
    c.arc(cx, cy, cell * 0.7, -Math.PI / 2, -Math.PI / 2 + (b.ttl / BONUS_TTL) * Math.PI * 2)
    c.stroke()

    c.save()
    c.translate(cx, cy)
    c.rotate(time * 0.004)
    c.shadowColor = '#facc15'
    c.shadowBlur = 24
    const g = c.createLinearGradient(-r, -r, r, r)
    g.addColorStop(0, '#fef9c3')
    g.addColorStop(1, '#f59e0b')
    c.fillStyle = g
    c.beginPath()
    c.moveTo(0, -r)
    c.lineTo(r, 0)
    c.lineTo(0, r)
    c.lineTo(-r, 0)
    c.closePath()
    c.fill()
    c.restore()
    c.shadowBlur = 0
  }

  private drawSnake(alpha: number) {
    const c = this.ctx
    const { cell } = this
    const n = this.snake.length
    if (!n) return

    const dead = this.mode === 'over'
    const fade = dead ? Math.max(0, 1 - (this.time - this.deathAt) / 900) : 1
    if (fade <= 0) return

    const pts = this.snake.map((p, i) => {
      const from = this.prev[i] ?? p
      // Don't interpolate across a wrap-around edge
      if (Math.abs(from.x - p.x) > 1 || Math.abs(from.y - p.y) > 1) {
        return { x: (p.x + 0.5) * cell, y: (p.y + 0.5) * cell }
      }
      return {
        x: (from.x + (p.x - from.x) * alpha + 0.5) * cell,
        y: (from.y + (p.y - from.y) * alpha + 0.5) * cell,
      }
    })

    const hueAt = (i: number) => (dead ? 350 : 185 + (i / Math.max(n - 1, 1)) * 115)

    c.globalAlpha = fade
    c.lineCap = 'round'
    c.lineJoin = 'round'

    // Glow pass then core pass
    for (const pass of [0, 1]) {
      for (let i = n - 1; i > 0; i--) {
        const a = pts[i]
        const b = pts[i - 1]
        if (Math.abs(a.x - b.x) > cell * 1.5 || Math.abs(a.y - b.y) > cell * 1.5) continue
        const taper = 0.55 + 0.25 * (1 - i / n)
        const hue = hueAt(i)
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
        if (pass === 0) {
          c.strokeStyle = `hsla(${hue}, 100%, 55%, 0.35)`
          c.lineWidth = cell * (taper + 0.35)
          c.shadowColor = `hsl(${hue}, 100%, 55%)`
          c.shadowBlur = 18
        } else {
          c.strokeStyle = `hsl(${hue}, 95%, ${60 + 10 * Math.sin(this.time * 0.006 - i * 0.5)}%)`
          c.lineWidth = cell * taper
          c.shadowBlur = 0
        }
        c.stroke()
      }
    }
    c.shadowBlur = 0

    // Inner highlight line for a glassy tube look
    c.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    c.lineWidth = cell * 0.12
    c.beginPath()
    for (let i = 0; i < n; i++) {
      const p = pts[i]
      const q = pts[i - 1]
      if (i === 0 || Math.abs(p.x - q.x) > cell * 1.5 || Math.abs(p.y - q.y) > cell * 1.5) {
        c.moveTo(p.x, p.y)
      } else c.lineTo(p.x, p.y)
    }
    c.stroke()

    // Head
    const head = pts[0]
    const dir = this.dir
    c.shadowColor = dead ? '#f43f5e' : '#22d3ee'
    c.shadowBlur = 26
    const hg = c.createRadialGradient(head.x, head.y, 0, head.x, head.y, cell * 0.5)
    hg.addColorStop(0, '#ffffff')
    hg.addColorStop(0.5, dead ? '#fda4af' : '#a5f3fc')
    hg.addColorStop(1, dead ? '#e11d48' : '#06b6d4')
    c.fillStyle = hg
    c.beginPath()
    c.arc(head.x, head.y, cell * 0.46, 0, Math.PI * 2)
    c.fill()
    c.shadowBlur = 0

    // Eyes
    const px = -dir.y
    const py = dir.x
    for (const side of [-1, 1]) {
      const ex = head.x + dir.x * cell * 0.15 + px * side * cell * 0.2
      const ey = head.y + dir.y * cell * 0.15 + py * side * cell * 0.2
      c.fillStyle = '#020617'
      c.beginPath()
      c.arc(ex, ey, cell * 0.1, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = dead ? '#f43f5e' : '#22d3ee'
      c.beginPath()
      c.arc(ex + dir.x * cell * 0.03, ey + dir.y * cell * 0.03, cell * 0.04, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  }
}
