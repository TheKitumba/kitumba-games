import { audio } from './audio'

// World units: 1 unit = 1 lane width. The canvas maps units to pixels on resize.
export const LANES = 4
const SHOULDER = 0.35
const CAR_W = 0.56
const CAR_H = 1
// Cars in a lane share one speed, so they never run into each other
const LANE_SPEEDS = [1.2, 1.8, 2.4, 3]
const BASE_SPEED = 6
const MAX_SPEED = 13
const BOOST = 1.45
const LEVEL_DISTANCE = 260
const HITBOX_INSET = 0.07

const BEST_KEY = 'kitumba-racer:best'
const VEHICLE_KEY = 'kitumba-racer:vehicle'

export type GameMode = 'menu' | 'playing' | 'paused' | 'over'

export type VehicleKind = 'car' | 'moto' | 'truck'

export interface VehicleSpec {
  name: string
  /** Body size in lane units */
  w: number
  h: number
  /** Lane-change slide speed, lanes/s */
  steer: number
  /** Multiplier on cruise speed */
  speed: number
  /** Multiplier on every point earned */
  points: number
  /** Engine drone pitch */
  pitch: number
  hue: number
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  car: { name: 'Carro', w: 0.56, h: 1, steer: 9, speed: 1, points: 1, pitch: 1, hue: 185 },
  // Slips through gaps and steers sharply, but rides faster
  moto: { name: 'Mota', w: 0.28, h: 0.78, steer: 13, speed: 1.15, points: 1.2, pitch: 1.8, hue: 150 },
  // Slower, but long, wide and sluggish to steer — rewarded with more points
  truck: { name: 'Camião', w: 0.74, h: 1.7, steer: 6, speed: 0.85, points: 1.5, pitch: 0.55, hue: 215 },
}

export const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[]

export interface HudState {
  mode: GameMode
  vehicle: VehicleKind
  score: number
  best: number
  level: number
  kmh: number
  boosting: boolean
  newBest: boolean
}

interface Car {
  lane: number
  y: number
  hue: number
  passed: boolean
}

interface Coin {
  lane: number
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

const TRAFFIC_HUES = [300, 45, 90, 350, 265, 20]

const laneX = (lane: number) => SHOULDER + lane + 0.5

// The car keeps the original key so existing records survive
const bestKey = (kind: VehicleKind) => (kind === 'car' ? BEST_KEY : `${BEST_KEY}:${kind}`)

const readBest = (kind: VehicleKind) => {
  try {
    return Number(localStorage.getItem(bestKey(kind))) || 0
  } catch {
    return 0
  }
}

const writeBest = (kind: VehicleKind, v: number) => {
  try {
    localStorage.setItem(bestKey(kind), String(v))
  } catch {
    // storage unavailable — best score just won't persist
  }
}

const readVehicle = (): VehicleKind => {
  try {
    const v = localStorage.getItem(VEHICLE_KEY)
    return v && v in VEHICLES ? (v as VehicleKind) : 'car'
  } catch {
    return 'car'
  }
}

const writeVehicle = (kind: VehicleKind) => {
  try {
    localStorage.setItem(VEHICLE_KEY, kind)
  } catch {
    // storage unavailable — choice just won't persist
  }
}

export class RacerGame {
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
  /** Visible road length in units */
  private viewH = 0

  private mode: GameMode = 'menu'
  private vehicle: VehicleKind = readVehicle()
  private lane = 1
  private x = laneX(1)
  private speed = BASE_SPEED
  private boosting = false
  private cars: Car[] = []
  private coins: Coin[] = []
  private spawnIn = 0
  private coinIn = 0
  private distance = 0
  private points = 0
  private score = 0
  private best = readBest(this.vehicle)
  private newBest = false
  private level = 1
  private roadOffset = 0
  private time = 0
  private shake = 0
  private flash = 0
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
    audio.stopEngine()
  }

  // ---------------- Public controls ----------------

  start() {
    audio.unlock()
    this.reset()
    this.mode = 'playing'
    audio.start()
    audio.startEngine(this.spec.pitch)
    this.emit()
  }

  /** Only allowed between runs, from the menu or the game-over screen. */
  setVehicle(kind: VehicleKind) {
    if (this.mode === 'playing' || this.mode === 'paused' || kind === this.vehicle) return
    this.vehicle = kind
    writeVehicle(kind)
    this.best = readBest(kind)
    this.newBest = false
    this.x = laneX(this.lane)
    this.emit()
  }

  togglePause() {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      this.boosting = false
      audio.stopEngine()
    } else if (this.mode === 'paused') {
      this.mode = 'playing'
      audio.startEngine(this.spec.pitch)
    } else return
    audio.pause()
    this.emit()
  }

  steer(dir: -1 | 1) {
    if (this.mode !== 'playing') return
    const next = Math.max(0, Math.min(LANES - 1, this.lane + dir))
    if (next === this.lane) return
    this.lane = next
    audio.laneChange()
  }

  setBoost(on: boolean) {
    if (this.mode !== 'playing' || on === this.boosting) return
    this.boosting = on
    if (on) audio.boost()
    this.emit()
  }

  // ---------------- Internals ----------------

  private emit() {
    const hud: HudState = {
      mode: this.mode,
      vehicle: this.vehicle,
      score: this.score,
      best: this.best,
      level: this.level,
      // Quantized so the HUD doesn't re-render on every frame of acceleration
      kmh: Math.round((this.speed * 15) / 5) * 5,
      boosting: this.boosting,
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
    this.unit = w / (LANES + SHOULDER * 2)
    this.viewH = h / this.unit
  }

  private get spec() {
    return VEHICLES[this.vehicle]
  }

  /** Centre of the player; the rear always sits 0.8 lanes above the bottom edge. */
  private get playerY() {
    return this.viewH - 0.8 - this.spec.h / 2
  }

  private targetSpeed() {
    const base = Math.min(MAX_SPEED, BASE_SPEED + (this.level - 1) * 0.6) * this.spec.speed
    return this.boosting ? base * BOOST : base
  }

  private reset() {
    this.lane = 1
    this.x = laneX(1)
    this.speed = BASE_SPEED * this.spec.speed
    this.boosting = false
    this.cars = []
    this.coins = []
    this.spawnIn = 0.6
    this.coinIn = 2
    this.distance = 0
    this.points = 0
    this.score = 0
    this.newBest = false
    this.level = 1
    this.particles = []
    this.texts = []
  }

  /** Seconds until a car in `lane` at `y` reaches the player's row. */
  private arrival(lane: number, y: number) {
    return (this.playerY - y) / (this.speed - LANE_SPEEDS[lane])
  }

  private spawnCar() {
    const y = -CAR_H
    const { h } = this.spec
    // Longer vehicles occupy the player's row for longer, so they need wider gaps
    const gap = CAR_H + h + 0.6
    const window = 0.25 * (CAR_H + h)
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5)
    for (const lane of lanes) {
      // Keep spacing inside the lane
      if (this.cars.some((c) => c.lane === lane && c.y < y + gap)) continue
      // Never let every lane be blocked at the same moment: there's always a way through
      const t = this.arrival(lane, y)
      const blocked = new Set(
        this.cars.filter((c) => Math.abs(this.arrival(c.lane, c.y) - t) < window).map((c) => c.lane),
      )
      blocked.add(lane)
      if (blocked.size >= LANES) continue
      const hue = TRAFFIC_HUES[Math.floor(Math.random() * TRAFFIC_HUES.length)]
      this.cars.push({ lane, y, hue, passed: false })
      return
    }
  }

  private spawnCoin() {
    const lane = Math.floor(Math.random() * LANES)
    if (this.cars.some((c) => c.lane === lane && c.y < 2)) return
    this.coins.push({ lane, y: -0.5 })
  }

  private step(dt: number) {
    const s = dt / 1000

    // Speed eases toward its target so boost feels like acceleration
    this.speed += (this.targetSpeed() - this.speed) * Math.min(1, s * 3)
    const base = BASE_SPEED * this.spec.speed
    audio.setEngine((this.speed - base) / (MAX_SPEED * this.spec.speed * BOOST - base))

    // Slide between lanes
    const tx = laneX(this.lane)
    const dx = tx - this.x
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), this.spec.steer * s)

    const travelled = this.speed * s
    this.roadOffset = (this.roadOffset + travelled) % 2
    this.distance += travelled
    this.points += travelled * this.level * (this.boosting ? 2 : 1) * this.spec.points
    this.setScore(Math.floor(this.points))

    if (this.distance >= this.level * LEVEL_DISTANCE) this.levelUp()

    // Traffic moves down the screen at the speed difference
    for (const c of this.cars) c.y += (this.speed - LANE_SPEEDS[c.lane]) * s
    for (const c of this.coins) c.y += this.speed * s

    this.spawnIn -= s
    if (this.spawnIn <= 0) {
      this.spawnCar()
      this.spawnIn = Math.max(0.32, 0.95 - this.level * 0.06) * (0.7 + Math.random() * 0.6)
    }
    this.coinIn -= s
    if (this.coinIn <= 0) {
      this.spawnCoin()
      this.coinIn = 1.8 + Math.random() * 2
    }

    this.checkCollisions()
    if (this.mode !== 'playing') return

    this.cars = this.cars.filter((c) => c.y < this.viewH + CAR_H)
    this.coins = this.coins.filter((c) => c.y < this.viewH + 1)
    this.emit()
  }

  private checkCollisions() {
    const py = this.playerY
    const { w, h, points } = this.spec
    // Half-extents of both boxes added together, each shrunk by the inset
    const reachX = (w + CAR_W) / 2 - HITBOX_INSET * 2
    const reachY = (h + CAR_H) / 2 - HITBOX_INSET * 2

    for (const c of this.cars) {
      const cx = laneX(c.lane)
      if (Math.abs(cx - this.x) < reachX && Math.abs(c.y - py) < reachY) return this.crash(c)

      // A car that just went past in the neighbouring lane is a near miss
      if (!c.passed && c.y - CAR_H / 2 > py + h / 2) {
        c.passed = true
        if (Math.abs(cx - this.x) < 1.1) {
          const pts = Math.round(25 * this.level * points)
          this.addPoints(pts, cx, py, `RASPÃO +${pts}`, 185)
          audio.nearMiss()
          this.shake = Math.max(this.shake, 2)
        }
      }
    }

    this.coins = this.coins.filter((coin) => {
      const cx = laneX(coin.lane)
      if (Math.abs(cx - this.x) < 0.5 && Math.abs(coin.y - py) < 0.2 + h / 2) {
        const pts = Math.round(50 * this.level * points)
        this.addPoints(pts, cx, py - 0.6, `+${pts}`, 45)
        this.burst(cx, coin.y, 45, 18, 0.12)
        audio.coin()
        return false
      }
      return true
    })
  }

  private addPoints(pts: number, x: number, y: number, label: string, hue: number) {
    this.points += pts
    this.setScore(Math.floor(this.points))
    this.texts.push({ x: x * this.unit, y: y * this.unit, text: label, life: 900, hue })
  }

  private setScore(score: number) {
    this.score = score
    if (this.score > this.best) {
      this.best = this.score
      this.newBest = true
      writeBest(this.vehicle, this.best)
    }
  }

  private levelUp() {
    this.level++
    this.flash = 0.6
    audio.levelUp()
    this.texts.push({ x: this.w / 2, y: this.h / 2, text: `NÍVEL ${this.level}`, life: 1400, hue: 185 })
  }

  private crash(car: Car) {
    this.mode = 'over'
    this.boosting = false
    this.shake = 16
    this.flash = 1
    audio.stopEngine()
    audio.crash()
    const mx = (this.x + laneX(car.lane)) / 2
    const my = (this.playerY + car.y) / 2
    this.burst(mx, my, this.spec.hue, 40, 0.3)
    this.burst(mx, my, car.hue, 40, 0.3)
    this.burst(mx, my, 30, 30, 0.18)
    this.emit()
  }

  private burst(ux: number, uy: number, hue: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 0.04 + Math.random() * power
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

    if (this.mode === 'playing') this.step(dt)
    // Gentle roll in the menu so the road looks alive
    else if (this.mode === 'menu') this.roadOffset = (this.roadOffset + BASE_SPEED * 0.5 * (dt / 1000)) % 2

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
      t.y -= dt * 0.03
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

    this.drawRoad()

    for (const coin of this.coins) this.drawCoin(laneX(coin.lane) * unit, coin.y * unit)
    for (const c of this.cars) this.drawCar(laneX(c.lane) * unit, c.y * unit, c.hue, false)
    if (this.mode !== 'over') this.drawPlayer(this.x * unit, this.playerY * unit)

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
      const big = t.text.startsWith('NÍVEL')
      ctx.font = `700 ${big ? 34 : 13}px Orbitron, sans-serif`
      ctx.fillStyle = `hsla(${t.hue}, 100%, 75%, ${Math.min(1, t.life / 400)})`
      ctx.shadowColor = `hsl(${t.hue}, 100%, 60%)`
      ctx.shadowBlur = 12
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.shadowBlur = 0

    if (this.flash > 0) {
      const hue = this.mode === 'over' ? 350 : 185
      ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${this.flash * 0.3})`
      ctx.fillRect(-20, -20, w + 40, h + 40)
    }
    ctx.restore()
  }

  private drawRoad() {
    const { ctx, w, h, unit } = this
    const left = SHOULDER * unit
    const right = w - SHOULDER * unit

    ctx.fillStyle = '#05060f'
    ctx.fillRect(-20, -20, w + 40, h + 40)
    ctx.fillStyle = '#0a0b1c'
    ctx.fillRect(left, -20, right - left, h + 40)

    // Roadside posts scroll at road speed
    const off = this.roadOffset * unit
    ctx.fillStyle = 'rgba(232, 121, 249, 0.5)'
    for (let y = -2 * unit + off; y < h + unit; y += unit) {
      ctx.fillRect(left * 0.3, y, left * 0.4, unit * 0.25)
      ctx.fillRect(w - left * 0.7, y, left * 0.4, unit * 0.25)
    }

    // Lane dashes
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.35)'
    ctx.lineWidth = 2
    ctx.setLineDash([unit * 0.6, unit * 0.4])
    ctx.lineDashOffset = -off
    for (let i = 1; i < LANES; i++) {
      const x = left + i * unit
      ctx.beginPath()
      ctx.moveTo(x, -unit)
      ctx.lineTo(x, h + unit)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Glowing road edges
    ctx.strokeStyle = '#e879f9'
    ctx.lineWidth = 3
    ctx.shadowColor = '#e879f9'
    ctx.shadowBlur = 14
    for (const x of [left, right]) {
      ctx.beginPath()
      ctx.moveTo(x, -20)
      ctx.lineTo(x, h + 20)
      ctx.stroke()
    }
    ctx.shadowBlur = 0

    // Speed lines while boosting
    if (this.boosting && this.mode === 'playing') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 1
      for (let i = 0; i < 10; i++) {
        const x = left + Math.random() * (right - left)
        const y = Math.random() * h
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + unit * (0.8 + Math.random()))
        ctx.stroke()
      }
    }
  }

  private drawPlayer(cx: number, cy: number) {
    const { ctx, unit } = this
    const { w, h, hue } = this.spec
    const cw = w * unit
    const ch = h * unit
    const y = cy - ch / 2

    // Headlight beams, same length for every vehicle
    const near = cw * 0.35
    const far = near + unit * 0.22
    const reach = unit * 1.6
    const beam = ctx.createLinearGradient(0, y, 0, y - reach)
    beam.addColorStop(0, 'rgba(165, 243, 252, 0.28)')
    beam.addColorStop(1, 'rgba(165, 243, 252, 0)')
    ctx.fillStyle = beam
    ctx.beginPath()
    ctx.moveTo(cx - near, y)
    ctx.lineTo(cx - far, y - reach)
    ctx.lineTo(cx + far, y - reach)
    ctx.lineTo(cx + near, y)
    ctx.fill()

    // Exhaust flame while boosting
    if (this.boosting) {
      const len = unit * (0.35 + Math.random() * 0.25)
      const flame = ctx.createLinearGradient(0, y + ch, 0, y + ch + len)
      flame.addColorStop(0, 'rgba(253, 224, 71, 0.95)')
      flame.addColorStop(1, 'rgba(244, 114, 182, 0)')
      ctx.fillStyle = flame
      ctx.fillRect(cx - cw * 0.22, y + ch - 2, cw * 0.44, len)
    }

    if (this.vehicle === 'moto') this.drawMoto(cx, cy, hue)
    else if (this.vehicle === 'truck') this.drawTruck(cx, cy, hue)
    else this.drawCar(cx, cy, hue, true)
  }

  /** Neon body panel shared by every vehicle. */
  private neonPanel(x: number, y: number, w: number, h: number, r: number, hue: number, glow: number) {
    const { ctx } = this
    ctx.fillStyle = `hsla(${hue}, 80%, 14%, 0.95)`
    ctx.strokeStyle = `hsl(${hue}, 95%, 62%)`
    ctx.lineWidth = 2
    ctx.shadowColor = `hsl(${hue}, 95%, 55%)`
    ctx.shadowBlur = glow
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private tailLights(rects: [number, number, number][], y: number) {
    const { ctx } = this
    ctx.fillStyle = '#f43f5e'
    ctx.shadowColor = '#f43f5e'
    ctx.shadowBlur = 8
    for (const [x, w, h] of rects) ctx.fillRect(x, y, w, h)
    ctx.shadowBlur = 0
  }

  private drawMoto(cx: number, cy: number, hue: number) {
    const { ctx, unit } = this
    const cw = VEHICLES.moto.w * unit
    const ch = VEHICLES.moto.h * unit
    const y = cy - ch / 2

    // Tyres
    ctx.fillStyle = '#0b0b12'
    ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.7)`
    ctx.lineWidth = 1.5
    for (const [wy, ww, wh] of [
      [y, cw * 0.4, ch * 0.24],
      [y + ch * 0.74, cw * 0.48, ch * 0.26],
    ]) {
      ctx.beginPath()
      ctx.roundRect(cx - ww / 2, wy, ww, wh, ww / 2)
      ctx.fill()
      ctx.stroke()
    }

    this.neonPanel(cx - cw * 0.4, y + ch * 0.18, cw * 0.8, ch * 0.6, cw * 0.35, hue, 18)

    // Handlebars stick out past the body
    ctx.strokeStyle = `hsl(${hue}, 95%, 70%)`
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx - cw * 0.85, y + ch * 0.3)
    ctx.lineTo(cx + cw * 0.85, y + ch * 0.3)
    ctx.stroke()
    ctx.lineCap = 'butt'

    // Rider's helmet with visor
    const r = cw * 0.34
    ctx.fillStyle = `hsl(${hue}, 70%, 82%)`
    ctx.beginPath()
    ctx.arc(cx, y + ch * 0.5, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = `hsla(${hue}, 80%, 20%, 0.9)`
    ctx.beginPath()
    ctx.arc(cx, y + ch * 0.5, r * 0.75, Math.PI * 1.15, Math.PI * 1.85)
    ctx.lineTo(cx, y + ch * 0.5)
    ctx.fill()

    ctx.fillStyle = '#ecfeff'
    ctx.fillRect(cx - cw * 0.14, y - 1, cw * 0.28, 3)
    this.tailLights([[cx - cw * 0.18, cw * 0.36, 3]], y + ch - 3)
  }

  private drawTruck(cx: number, cy: number, hue: number) {
    const { ctx, unit } = this
    const cw = VEHICLES.truck.w * unit
    const ch = VEHICLES.truck.h * unit
    const x = cx - cw / 2
    const y = cy - ch / 2
    const trailerY = y + ch * 0.3

    // Cab
    this.neonPanel(x + cw * 0.06, y, cw * 0.88, ch * 0.25, cw * 0.18, hue, 18)
    ctx.fillStyle = `hsla(${hue}, 90%, 70%, 0.5)`
    ctx.beginPath()
    ctx.roundRect(x + cw * 0.16, y + ch * 0.05, cw * 0.68, ch * 0.07, 3)
    ctx.fill()

    // Coupling between cab and trailer
    ctx.fillStyle = `hsla(${hue}, 60%, 40%, 0.8)`
    ctx.fillRect(cx - cw * 0.12, y + ch * 0.25, cw * 0.24, trailerY - (y + ch * 0.25))

    // Trailer with ribbed roof and a centre stripe
    this.neonPanel(x, trailerY, cw, y + ch - trailerY, 4, hue, 14)
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.22)`
    ctx.lineWidth = 1
    for (let ry = trailerY + ch * 0.09; ry < y + ch - 4; ry += ch * 0.09) {
      ctx.beginPath()
      ctx.moveTo(x + 4, ry)
      ctx.lineTo(x + cw - 4, ry)
      ctx.stroke()
    }
    ctx.fillStyle = `hsla(${hue}, 95%, 65%, 0.35)`
    ctx.fillRect(cx - 1.5, trailerY + 4, 3, y + ch - trailerY - 8)

    ctx.fillStyle = '#ecfeff'
    ctx.fillRect(x + cw * 0.12, y + 1, cw * 0.18, 3)
    ctx.fillRect(x + cw * 0.7, y + 1, cw * 0.18, 3)
    this.tailLights(
      [
        [x + cw * 0.06, cw * 0.2, 3],
        [x + cw * 0.74, cw * 0.2, 3],
      ],
      y + ch - 4,
    )
  }

  private drawCar(cx: number, cy: number, hue: number, player: boolean) {
    const { ctx, unit } = this
    const cw = CAR_W * unit
    const ch = CAR_H * unit
    const x = cx - cw / 2
    const y = cy - ch / 2

    this.neonPanel(x, y, cw, ch, cw * 0.28, hue, player ? 18 : 10)

    // Windshield and rear window
    ctx.fillStyle = `hsla(${hue}, 90%, 70%, 0.5)`
    ctx.beginPath()
    ctx.roundRect(x + cw * 0.18, y + ch * 0.22, cw * 0.64, ch * 0.18, 3)
    ctx.fill()
    ctx.fillStyle = `hsla(${hue}, 90%, 70%, 0.25)`
    ctx.beginPath()
    ctx.roundRect(x + cw * 0.2, y + ch * 0.66, cw * 0.6, ch * 0.12, 3)
    ctx.fill()

    // Headlights at the front, tail lights at the back
    ctx.fillStyle = player ? '#ecfeff' : 'rgba(253, 230, 138, 0.8)'
    ctx.fillRect(x + cw * 0.12, y + 1, cw * 0.2, 3)
    ctx.fillRect(x + cw * 0.68, y + 1, cw * 0.2, 3)
    this.tailLights(
      [
        [x + cw * 0.1, cw * 0.24, 3],
        [x + cw * 0.66, cw * 0.24, 3],
      ],
      y + ch - 4,
    )
  }

  private drawCoin(cx: number, cy: number) {
    const { ctx, unit } = this
    const r = unit * 0.16
    const squash = Math.abs(Math.cos(this.time / 260))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(Math.max(0.15, squash), 1)
    ctx.fillStyle = '#fde047'
    ctx.shadowColor = '#facc15'
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.moveTo(0, -r * 1.3)
    ctx.lineTo(r, 0)
    ctx.lineTo(0, r * 1.3)
    ctx.lineTo(-r, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}
