import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { audio } from './audio'

// World units: the arena spans ±ARENA_X on x and ±ARENA_Z on z, y is up.
// The camera looks down from +z, so screen-right is +x and screen-down is +z.
const ARENA_X = 13
const ARENA_Z = 8.5
const PLAYER_SPEED = 9
const PLAYER_RADIUS = 0.5
const START_HP = 3
const MAX_HP = 5
const FIRE_DELAY = 0.11
const RAPID_DELAY = 0.055
const BULLET_SPEED = 26
const BULLET_LIFE = 0.8
const SPREAD = 0.2
const DASH_SPEED = 30
const DASH_TIME = 0.16
const DASH_COOLDOWN = 0.9
const INVULN = 1.6
const POWER_TIME = 9
const PICKUP_LIFE = 9
const COMBO_WINDOW = 2
const SPAWN_WARN = 0.9
const SHOCKWAVE_RADIUS = 5
// Physics runs in fixed sub-steps so fast bullets can't tunnel through enemies
const STEP = 1 / 120

const BEST_KEY = 'kitumba-blaster:best'
const QUALITY_KEY = 'kitumba-blaster:quality'

// Pool sizes double as hard caps on what the GPU has to draw
const MAX_ENEMIES = 64
const MAX_BULLETS = 160
const MAX_ENEMY_BULLETS = 96
const MAX_PARTICLES = 700
const MAX_PICKUPS = 8
const RIPPLES = 6

export type GameMode = 'menu' | 'playing' | 'paused' | 'over'
export type EnemyKind = 'drone' | 'dasher' | 'sniper' | 'tank'
export type PickupKind = 'spread' | 'rapid' | 'shield' | 'heal'
export type QualityPref = 'auto' | 'high' | 'low'
/** 2 = bloom at up to 2× pixel ratio, 1 = bloom at 1×, 0 = no post-processing */
export type QualityLevel = 0 | 1 | 2

interface EnemySpec {
  hp: number
  speed: number
  radius: number
  points: number
  color: number
  /** Chance of dropping a pickup on death */
  drop: number
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  drone: { hp: 1, speed: 4.2, radius: 0.55, points: 100, color: 0xff2bd6, drop: 0.05 },
  // Stalks, winds up, then charges in a straight line
  dasher: { hp: 2, speed: 2, radius: 0.6, points: 150, color: 0xffa31a, drop: 0.08 },
  // Keeps its distance and fires slow orbs
  sniper: { hp: 3, speed: 3, radius: 0.65, points: 250, color: 0x3dff8b, drop: 0.12 },
  tank: { hp: 9, speed: 1.6, radius: 1.1, points: 450, color: 0x8b5cff, drop: 0.5 },
}

const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[]

export const PICKUP_COLORS: Record<PickupKind, number> = {
  spread: 0xff4fd8,
  rapid: 0xffc21a,
  shield: 0x7dff4f,
  heal: 0xff4f6a,
}

export interface HudState {
  mode: GameMode
  score: number
  best: number
  wave: number
  hp: number
  maxHp: number
  combo: number
  power: 'spread' | 'rapid' | null
  shield: boolean
  dashReady: boolean
  banner: string | null
  kills: number
  newBest: boolean
  quality: QualityPref
  qualityLevel: QualityLevel
}

interface Bullet {
  x: number
  z: number
  vx: number
  vz: number
  life: number
}

interface Enemy {
  kind: EnemyKind
  x: number
  z: number
  vx: number
  vz: number
  hp: number
  /** State timer; meaning depends on the kind */
  t: number
  state: number
  dirX: number
  dirZ: number
  fireIn: number
  /** Hit flash, 1 → 0 */
  flash: number
  spin: number
  strafe: 1 | -1
}

interface Spawn {
  kind: EnemyKind
  x: number
  z: number
  t: number
}

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  color: Color
}

interface Pickup {
  kind: PickupKind
  x: number
  z: number
  life: number
}

/** Fixed-size object pool: no allocations while playing. Iterate backwards when removing. */
class Pool<T> {
  readonly items: T[]
  count = 0
  constructor(cap: number, make: () => T) {
    this.items = Array.from({ length: cap }, make)
  }
  /** A recycled slot, or null when the pool is full */
  add(): T | null {
    return this.count < this.items.length ? this.items[this.count++] : null
  }
  /** Swap-remove: the last live item takes slot `i` */
  remove(i: number) {
    const last = --this.count
    const item = this.items[i]
    this.items[i] = this.items[last]
    this.items[last] = item
  }
  clear() {
    this.count = 0
  }
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

const readQuality = (): QualityPref => {
  try {
    const v = localStorage.getItem(QUALITY_KEY)
    return v === 'high' || v === 'low' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const writeQuality = (v: QualityPref) => {
  try {
    localStorage.setItem(QUALITY_KEY, v)
  } catch {
    // storage unavailable — choice just won't persist
  }
}

// Phones start one step down: their GPUs are slower and their screens denser
const initialLevel = (pref: QualityPref): QualityLevel =>
  pref === 'high' ? 2 : pref === 'low' ? 0 : matchMedia('(pointer: coarse)').matches ? 1 : 2

/** Colours above 1 are what the bloom pass picks up */
const hdr = (hex: number, k: number) => new Color(hex).multiplyScalar(k)

function instanced(geometry: BufferGeometry, material: Material, cap: number) {
  const mesh = new InstancedMesh(geometry, material, cap)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  // Instances move all over the arena; the geometry's own bounds would cull them wrongly
  mesh.frustumCulled = false
  // Allocate the colour buffer up front so the shader compiles with it
  const white = new Color(1, 1, 1)
  for (let i = 0; i < cap; i++) mesh.setColorAt(i, white)
  mesh.count = 0
  return mesh
}

const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FLOOR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uHurt;
  uniform vec2 uArena;
  uniform vec4 uRipples[${RIPPLES}];
  varying vec2 vPos;

  float grid(vec2 p) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec2 p = vPos;
    float minor = grid(p);
    float major = grid(p / 4.0);

    // Explosions send a ring of light across the grid
    float wave = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float d = length(p - r.xy) - r.z * 14.0;
      wave += exp(-d * d * 2.0) * r.w * max(0.0, 1.0 - r.z * 1.4);
    }

    vec2 edge = abs(p) - uArena;
    float inside = step(max(edge.x, edge.y), 0.0);
    float fade = inside + (1.0 - inside) * 0.25 * exp(-max(edge.x, edge.y) * 0.4);

    vec3 lineColor = mix(vec3(0.45, 0.1, 0.8), vec3(0.1, 0.75, 1.0), 0.5 + 0.5 * sin(uTime * 0.6 + p.x * 0.12 + p.y * 0.08));
    vec3 col = vec3(0.004, 0.003, 0.014);
    col += lineColor * (minor * 0.12 + major * 0.32) * fade * (1.0 + wave * 4.0);
    col += vec3(0.25, 0.9, 1.0) * wave * 0.08 * inside;
    col += vec3(0.6, 0.02, 0.12) * uHurt * inside * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

export class BlasterGame {
  private container: HTMLElement
  private onChange: (hud: HudState) => void
  private resizeObserver: ResizeObserver
  private raf = 0
  private lastFrame = 0
  private lastHud = ''
  private w = 1
  private h = 1
  /** Set on resize so a paused game still redraws once */
  private dirty = true

  // ---------- Rendering ----------
  private renderer: WebGLRenderer
  private composer: EffectComposer
  private scene = new Scene()
  private camera = new PerspectiveCamera(50, 1, 0.1, 200)
  private camDist = 20
  private camTarget = new Vector3()
  private floor: ShaderMaterial
  private ship = new Group()
  private shieldMesh: Mesh
  private shipLight: PointLight
  private enemyMeshes = {} as Record<EnemyKind, InstancedMesh>
  private bulletMesh: InstancedMesh
  private enemyBulletMesh: InstancedMesh
  private particleMesh: InstancedMesh
  private spawnMesh: InstancedMesh
  private pickupMesh: InstancedMesh
  private shockMesh: Mesh<RingGeometry, MeshBasicMaterial>
  private dummy = new Object3D()
  private tmpColor = new Color()
  private raycaster = new Raycaster()
  private aimPlane = new Plane(new Vector3(0, 1, 0), -0.6)
  private aimHit = new Vector3()
  private ripples = Array.from({ length: RIPPLES }, () => new Vector4(0, 0, 1, 0))
  private rippleNext = 0

  // ---------- Quality ----------
  private qualityPref: QualityPref = readQuality()
  private qualityLevel: QualityLevel = initialLevel(this.qualityPref)
  private perfSum = 0
  private perfFrames = 0
  private perfSkip = 0

  // ---------- Input ----------
  private moveX = 0
  private moveZ = 0
  private stickAim = false
  private stickFire = false
  private trigger = false
  private pointer = new Vector2()
  private pointerActive = false

  // ---------- Game state ----------
  private mode: GameMode = 'menu'
  private px = 0
  private pz = 0
  private aimX = 0
  private aimZ = -1
  private hp = START_HP
  private shield = false
  private invuln = 0
  private dashT = 0
  private dashCd = 0
  private dashX = 0
  private dashZ = 0
  private fireIn = 0
  private power: 'spread' | 'rapid' | null = null
  private powerT = 0
  private wave = 0
  private queue: EnemyKind[] = []
  private releaseIn = 0
  private intermission = 0
  private chain = 0
  private comboT = 0
  private kills = 0
  private score = 0
  private best = readBest()
  private newBest = false
  private banner: string | null = null
  private bannerT = 0
  private time = 0
  private shake = 0
  private hurt = 0
  private shockT = -1

  private bullets = new Pool<Bullet>(MAX_BULLETS, () => ({ x: 0, z: 0, vx: 0, vz: 0, life: 0 }))
  private enemyBullets = new Pool<Bullet>(MAX_ENEMY_BULLETS, () => ({ x: 0, z: 0, vx: 0, vz: 0, life: 0 }))
  private enemies = new Pool<Enemy>(MAX_ENEMIES, () => ({
    kind: 'drone',
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    hp: 0,
    t: 0,
    state: 0,
    dirX: 0,
    dirZ: 0,
    fireIn: 0,
    flash: 0,
    spin: 0,
    strafe: 1,
  }))
  private spawns = new Pool<Spawn>(MAX_ENEMIES, () => ({ kind: 'drone', x: 0, z: 0, t: 0 }))
  private particles = new Pool<Particle>(MAX_PARTICLES, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    max: 1,
    size: 0,
    color: new Color(),
  }))
  private pickups = new Pool<Pickup>(MAX_PICKUPS, () => ({ kind: 'spread', x: 0, z: 0, life: 0 }))

  constructor(container: HTMLElement, onChange: (hud: HudState) => void) {
    this.container = container
    this.onChange = onChange

    // The engine owns its canvas so a remount (React StrictMode) never reuses a disposed context
    const canvas = document.createElement('canvas')
    canvas.className = 'block h-full w-full'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', 'Arena do jogo de tiros')
    container.prepend(canvas)

    // MSAA is wasted under post-processing (it renders to an off-screen target), and bloom softens edges anyway
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x04030c)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.8, 0.25, 0.8))
    this.composer.addPass(new OutputPass())

    // ---------- Lights: two cheap globals plus one point light that follows the ship ----------
    this.scene.add(new HemisphereLight(0x8a9cff, 0x1a0026, 1.4))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(6, 12, 8)
    this.scene.add(sun)
    this.shipLight = new PointLight(0x22d3ee, 14, 12, 2)
    this.shipLight.position.y = 3
    this.scene.add(this.shipLight)

    // ---------- Floor and walls ----------
    this.floor = new ShaderMaterial({
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uHurt: { value: 0 },
        uArena: { value: new Vector2(ARENA_X, ARENA_Z) },
        uRipples: { value: this.ripples },
      },
    })
    const floor = new Mesh(new PlaneGeometry(ARENA_X * 2 + 80, ARENA_Z * 2 + 80).rotateX(-Math.PI / 2), this.floor)
    this.scene.add(floor)

    // Kept just under the bloom threshold: walls this large would haze the whole screen
    const wallMat = new MeshBasicMaterial({ color: hdr(0x22d3ee, 1.2), toneMapped: false })
    const wallH = 0.35
    const walls: [number, number, number, number][] = [
      [0, -ARENA_Z, ARENA_X * 2 + 0.3, 0.15],
      [0, ARENA_Z, ARENA_X * 2 + 0.3, 0.15],
      [-ARENA_X, 0, 0.15, ARENA_Z * 2],
      [ARENA_X, 0, 0.15, ARENA_Z * 2],
    ]
    for (const [x, z, w, d] of walls) {
      const wall = new Mesh(new BoxGeometry(w, wallH, d), wallMat)
      wall.position.set(x, wallH / 2, z)
      this.scene.add(wall)
    }

    // ---------- Ship ----------
    const shipMat = new MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: 0x0e7490,
      emissiveIntensity: 0.5,
      flatShading: true,
      metalness: 0.4,
      roughness: 0.35,
    })
    const hull = new Mesh(new ConeGeometry(0.5, 1.4, 4).rotateX(Math.PI / 2), shipMat)
    const wings = new Mesh(new BoxGeometry(1.5, 0.1, 0.45), shipMat)
    wings.position.z = -0.3
    const thruster = new Mesh(
      new SphereGeometry(0.2, 10, 8),
      new MeshBasicMaterial({ color: hdr(0x22d3ee, 3), toneMapped: false }),
    )
    thruster.position.z = -0.7
    this.shieldMesh = new Mesh(
      new IcosahedronGeometry(1.05, 1),
      new MeshBasicMaterial({
        color: hdr(PICKUP_COLORS.shield, 1.6),
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.ship.add(hull, wings, thruster, this.shieldMesh)
    this.scene.add(this.ship)

    // ---------- Instanced layers: one draw call per kind, however many are on screen ----------
    const enemyGeo: Record<EnemyKind, BufferGeometry> = {
      drone: new OctahedronGeometry(0.62),
      dasher: new ConeGeometry(0.55, 1.4, 3).rotateX(Math.PI / 2),
      sniper: new TorusGeometry(0.52, 0.17, 6, 14).rotateX(Math.PI / 2),
      tank: new BoxGeometry(1.7, 1.1, 1.7),
    }
    for (const kind of ENEMY_KINDS) {
      const { color } = ENEMIES[kind]
      const mat = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        flatShading: true,
        metalness: 0.3,
        roughness: 0.4,
      })
      this.enemyMeshes[kind] = instanced(enemyGeo[kind], mat, MAX_ENEMIES)
      this.scene.add(this.enemyMeshes[kind])
    }

    this.bulletMesh = instanced(
      new BoxGeometry(0.14, 0.14, 0.8),
      new MeshBasicMaterial({ color: hdr(0x7df9ff, 2.6), toneMapped: false }),
      MAX_BULLETS,
    )
    this.enemyBulletMesh = instanced(
      new SphereGeometry(0.26, 10, 8),
      new MeshBasicMaterial({ color: hdr(0xff5a2b, 2.6), toneMapped: false }),
      MAX_ENEMY_BULLETS,
    )
    this.particleMesh = instanced(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX_PARTICLES,
    )
    this.spawnMesh = instanced(
      new RingGeometry(0.75, 0.95, 28).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      MAX_ENEMIES,
    )
    this.pickupMesh = instanced(
      new OctahedronGeometry(0.42),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX_PICKUPS,
    )
    this.scene.add(this.bulletMesh, this.enemyBulletMesh, this.particleMesh, this.spawnMesh, this.pickupMesh)

    this.shockMesh = new Mesh(
      new RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: hdr(0x7df9ff, 2),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    )
    this.shockMesh.position.y = 0.3
    this.shockMesh.visible = false
    this.scene.add(this.shockMesh)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.reset()
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      obj.geometry.dispose()
      for (const m of [obj.material].flat()) m.dispose()
    })
    this.composer.dispose()
    this.renderer.dispose()
    // Browsers cap live WebGL contexts, so free this one now instead of waiting for GC
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  // ---------------- Public controls ----------------

  start() {
    audio.unlock()
    this.reset()
    this.mode = 'playing'
    this.perfSkip = 1
    audio.start()
    this.startWave(1)
    this.emit()
  }

  togglePause() {
    if (this.mode === 'playing') this.mode = 'paused'
    else if (this.mode === 'paused') {
      this.mode = 'playing'
      this.perfSkip = 1
    } else return
    this.trigger = false
    audio.pause()
    this.emit()
  }

  /** Movement vector from keys or the left stick; x is screen-right, z is screen-down. */
  setMove(x: number, z: number) {
    const len = Math.hypot(x, z)
    const k = len > 1 ? 1 / len : 1
    this.moveX = x * k
    this.moveZ = z * k
  }

  /** Aim vector from the arrow keys or the right stick. Aiming this way also fires. */
  setAim(x: number, z: number) {
    const len = Math.hypot(x, z)
    if (len < 0.25) {
      this.stickAim = false
      this.stickFire = false
      return
    }
    this.aimX = x / len
    this.aimZ = z / len
    this.stickAim = true
    this.stickFire = true
  }

  /** Mouse position in client pixels; the ship turns to face it. */
  setPointer(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    this.pointerActive = true
  }

  /** Mouse button held */
  setTrigger(on: boolean) {
    this.trigger = on && this.mode === 'playing'
  }

  dash() {
    if (this.mode !== 'playing' || this.dashCd > 0) return
    // Dash where you're going, or where you're facing when standing still
    const moving = this.moveX !== 0 || this.moveZ !== 0
    this.dashX = moving ? this.moveX : this.aimX
    this.dashZ = moving ? this.moveZ : this.aimZ
    const len = Math.hypot(this.dashX, this.dashZ) || 1
    this.dashX /= len
    this.dashZ /= len
    this.dashT = DASH_TIME
    this.dashCd = DASH_COOLDOWN
    audio.dash()
    this.emit()
  }

  setQuality(pref: QualityPref) {
    this.qualityPref = pref
    writeQuality(pref)
    this.qualityLevel = initialLevel(pref)
    this.perfSum = this.perfFrames = 0
    this.applyQuality()
    this.dirty = true
    this.emit()
  }

  // ---------------- Internals ----------------

  private emit() {
    const hud: HudState = {
      mode: this.mode,
      score: this.score,
      best: this.best,
      wave: this.wave,
      hp: this.hp,
      maxHp: MAX_HP,
      combo: this.combo,
      power: this.power,
      shield: this.shield,
      dashReady: this.dashCd <= 0,
      banner: this.bannerT > 0 ? this.banner : null,
      kills: this.kills,
      newBest: this.newBest,
      quality: this.qualityPref,
      qualityLevel: this.qualityLevel,
    }
    const key = JSON.stringify(hud)
    if (key === this.lastHud) return
    this.lastHud = key
    this.onChange(hud)
  }

  private get combo() {
    return Math.min(8, 1 + Math.floor(this.chain / 4))
  }

  private resize() {
    // clientWidth ignores CSS transforms, unlike getBoundingClientRect
    this.w = Math.max(1, this.container.clientWidth)
    this.h = Math.max(1, this.container.clientHeight)
    const aspect = this.w / this.h
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    // Pull back on narrow screens so the arena's width still fits
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360)
    this.camDist = Math.max(17, (ARENA_X * 1.4) / (tanHalf * aspect))
    this.applyQuality()
    this.dirty = true
  }

  private applyQuality() {
    const dpr = this.qualityLevel === 2 ? Math.min(window.devicePixelRatio || 1, 2) : 1
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.w, this.h, false)
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(this.w, this.h)
  }

  /** In "auto", step the quality down whenever frames run long for two seconds straight. */
  private monitorPerf(dt: number) {
    if (this.qualityPref !== 'auto' || this.qualityLevel === 0 || this.mode !== 'playing') return
    // Skip the first second after (re)starting: shader compiles and audio unlock cause hitches
    if (this.perfSkip > 0) {
      this.perfSkip -= dt / 1000
      return
    }
    this.perfSum += dt
    this.perfFrames++
    if (this.perfSum < 2000) return
    const avg = this.perfSum / this.perfFrames
    this.perfSum = this.perfFrames = 0
    // Below ~48 fps
    if (avg > 21) {
      this.qualityLevel = (this.qualityLevel - 1) as QualityLevel
      this.applyQuality()
      this.perfSkip = 0.5
    }
  }

  private reset() {
    this.px = 0
    this.pz = 3
    this.aimX = 0
    this.aimZ = -1
    this.hp = START_HP
    this.shield = false
    this.invuln = 0
    this.dashT = 0
    this.dashCd = 0
    this.fireIn = 0
    this.power = null
    this.powerT = 0
    this.wave = 0
    this.queue = []
    this.releaseIn = 0
    this.intermission = 0
    this.chain = 0
    this.comboT = 0
    this.kills = 0
    this.score = 0
    this.newBest = false
    this.bannerT = 0
    this.hurt = 0
    this.trigger = false
    this.bullets.clear()
    this.enemyBullets.clear()
    this.enemies.clear()
    this.spawns.clear()
    this.pickups.clear()
  }

  private startWave(n: number) {
    this.wave = n
    const q: EnemyKind[] = []
    const add = (kind: EnemyKind, count: number) => {
      for (let i = 0; i < count; i++) q.push(kind)
    }
    add('drone', 5 + n * 2)
    add('dasher', n >= 2 ? n : 0)
    add('sniper', n >= 3 ? n - 2 : 0)
    add('tank', n >= 4 ? Math.floor((n - 2) / 2) : 0)
    // Shuffle so each batch is a mix
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[q[i], q[j]] = [q[j], q[i]]
    }
    this.queue = q
    this.releaseIn = 0.8
    this.showBanner(`ONDA ${n}`)
    audio.waveStart()
  }

  private showBanner(text: string) {
    this.banner = text
    this.bannerT = 1.6
  }

  private get speedScale() {
    return Math.min(1.45, 1 + (this.wave - 1) * 0.04)
  }

  private queueSpawn(kind: EnemyKind) {
    const s = this.spawns.add()
    if (!s) return
    const m = 1.5
    // Never drop an enemy on top of the player
    for (let tries = 0; tries < 12; tries++) {
      s.x = (Math.random() * 2 - 1) * (ARENA_X - m)
      s.z = (Math.random() * 2 - 1) * (ARENA_Z - m)
      if (Math.hypot(s.x - this.px, s.z - this.pz) > 7) break
    }
    s.kind = kind
    s.t = SPAWN_WARN
  }

  private spawnEnemy(s: Spawn) {
    const e = this.enemies.add()
    if (!e) return
    const spec = ENEMIES[s.kind]
    e.kind = s.kind
    e.x = s.x
    e.z = s.z
    e.vx = e.vz = 0
    e.hp = spec.hp
    e.state = 0
    e.t = 1 + Math.random()
    e.fireIn = 1.5 + Math.random() * 1.5
    e.flash = 1
    e.spin = Math.random() * Math.PI * 2
    e.strafe = Math.random() < 0.5 ? 1 : -1
    this.burst(s.x, 0.5, s.z, spec.color, 10, 4)
  }

  private step(s: number) {
    this.time += s

    // ---------- Timers ----------
    this.invuln = Math.max(0, this.invuln - s)
    this.dashCd = Math.max(0, this.dashCd - s)
    if (this.powerT > 0) {
      this.powerT -= s
      if (this.powerT <= 0) this.power = null
    }
    if (this.comboT > 0) {
      this.comboT -= s
      if (this.comboT <= 0) this.chain = 0
    }

    // ---------- Player ----------
    if (this.dashT > 0) {
      this.dashT -= s
      this.px += this.dashX * DASH_SPEED * s
      this.pz += this.dashZ * DASH_SPEED * s
      if (Math.random() < 0.6) this.burst(this.px, 0.5, this.pz, 0x22d3ee, 1, 1)
    } else {
      this.px += this.moveX * PLAYER_SPEED * s
      this.pz += this.moveZ * PLAYER_SPEED * s
    }
    this.px = Math.max(-ARENA_X + PLAYER_RADIUS, Math.min(ARENA_X - PLAYER_RADIUS, this.px))
    this.pz = Math.max(-ARENA_Z + PLAYER_RADIUS, Math.min(ARENA_Z - PLAYER_RADIUS, this.pz))

    this.fireIn -= s
    if ((this.trigger || this.stickFire) && this.fireIn <= 0) {
      this.fire()
      this.fireIn = Math.max(this.fireIn, 0) + (this.power === 'rapid' ? RAPID_DELAY : FIRE_DELAY)
    }

    // ---------- Projectiles ----------
    for (let i = this.bullets.count - 1; i >= 0; i--) {
      const b = this.bullets.items[i]
      b.x += b.vx * s
      b.z += b.vz * s
      b.life -= s
      if (b.life <= 0 || Math.abs(b.x) > ARENA_X || Math.abs(b.z) > ARENA_Z) {
        if (b.life > 0) this.burst(b.x, 0.5, b.z, 0x22d3ee, 3, 3)
        this.bullets.remove(i)
      }
    }
    for (let i = this.enemyBullets.count - 1; i >= 0; i--) {
      const b = this.enemyBullets.items[i]
      b.x += b.vx * s
      b.z += b.vz * s
      b.life -= s
      if (b.life <= 0 || Math.abs(b.x) > ARENA_X || Math.abs(b.z) > ARENA_Z) {
        this.enemyBullets.remove(i)
      } else if (Math.hypot(b.x - this.px, b.z - this.pz) < PLAYER_RADIUS + 0.22) {
        this.enemyBullets.remove(i)
        this.damagePlayer()
        if (this.mode !== 'playing') return
      }
    }

    // ---------- Waves ----------
    for (let i = this.spawns.count - 1; i >= 0; i--) {
      const sp = this.spawns.items[i]
      sp.t -= s
      if (sp.t <= 0) {
        this.spawnEnemy(sp)
        this.spawns.remove(i)
      }
    }
    if (this.intermission > 0) {
      this.intermission -= s
      if (this.intermission <= 0) this.startWave(this.wave + 1)
    } else {
      this.releaseIn -= s
      const alive = this.enemies.count + this.spawns.count
      if (this.queue.length && this.releaseIn <= 0 && alive < Math.min(40, 14 + this.wave * 2)) {
        const batch = Math.min(this.queue.length, 2 + Math.floor(this.wave / 2))
        for (let i = 0; i < batch; i++) this.queueSpawn(this.queue.pop()!)
        this.releaseIn = Math.max(0.7, 2.2 - this.wave * 0.1)
      }
      if (!this.queue.length && alive === 0) {
        const bonus = 250 * this.wave
        this.addScore(bonus)
        this.showBanner(`ONDA LIMPA +${bonus.toLocaleString('pt-PT')}`)
        this.intermission = 2.6
      }
    }

    // ---------- Enemies ----------
    this.updateEnemies(s)
    this.collide()
    if (this.mode !== 'playing') return

    // ---------- Pickups ----------
    for (let i = this.pickups.count - 1; i >= 0; i--) {
      const p = this.pickups.items[i]
      p.life -= s
      if (p.life <= 0) this.pickups.remove(i)
      else if (Math.hypot(p.x - this.px, p.z - this.pz) < 1.1) {
        this.collect(p)
        this.pickups.remove(i)
      }
    }
  }

  private fire() {
    const base = Math.atan2(this.aimX, this.aimZ)
    const shots = this.power === 'spread' ? 3 : 1
    for (let k = 0; k < shots; k++) {
      const b = this.bullets.add()
      if (!b) break
      const a = base + (shots === 1 ? 0 : (k - 1) * SPREAD)
      const sx = Math.sin(a)
      const sz = Math.cos(a)
      b.x = this.px + sx * 0.8
      b.z = this.pz + sz * 0.8
      b.vx = sx * BULLET_SPEED
      b.vz = sz * BULLET_SPEED
      b.life = BULLET_LIFE
    }
    audio.shoot()
  }

  private updateEnemies(s: number) {
    const sm = this.speedScale
    const items = this.enemies.items
    for (let i = 0; i < this.enemies.count; i++) {
      const e = items[i]
      const spec = ENEMIES[e.kind]
      const dx = this.px - e.x
      const dz = this.pz - e.z
      const d = Math.hypot(dx, dz) || 1
      const nx = dx / d
      const nz = dz / d
      let tx = 0
      let tz = 0
      let accel = 4

      e.flash = Math.max(0, e.flash - s * 5)
      e.spin += s * (e.kind === 'tank' ? 0.6 : 3)

      if (e.kind === 'drone' || e.kind === 'tank') {
        tx = nx * spec.speed * sm
        tz = nz * spec.speed * sm
        if (e.kind === 'tank') accel = 2
      } else if (e.kind === 'dasher') {
        e.t -= s
        if (e.state === 0) {
          // Stalk
          tx = nx * spec.speed * sm
          tz = nz * spec.speed * sm
          if (e.t <= 0) {
            e.state = 1
            e.t = 0.5
            e.dirX = nx
            e.dirZ = nz
          }
        } else if (e.state === 1) {
          // Wind-up: freeze and flash, then lock the direction
          accel = 10
          e.flash = Math.max(e.flash, 0.5 + 0.5 * Math.sin(e.t * 40))
          if (e.t <= 0) {
            e.state = 2
            e.t = 0.5
            e.vx = e.dirX * 15 * sm
            e.vz = e.dirZ * 15 * sm
          }
        } else {
          // Charge
          tx = e.vx
          tz = e.vz
          if (e.t <= 0) {
            e.state = 0
            e.t = 1.2 + Math.random() * 0.8
          }
        }
      } else {
        // Sniper: hold a ring 7–10 units out and circle-strafe
        const radial = d < 7 ? -1 : d > 10 ? 1 : 0
        tx = (nx * radial - nz * e.strafe * 0.8) * spec.speed * sm
        tz = (nz * radial + nx * e.strafe * 0.8) * spec.speed * sm
        e.fireIn -= s
        if (e.fireIn < 0.35) e.flash = Math.max(e.flash, 0.6)
        if (e.fireIn <= 0) {
          e.fireIn = Math.max(1.4, 2.6 - this.wave * 0.06) + Math.random() * 0.6
          const b = this.enemyBullets.add()
          if (b) {
            const speed = 7 + Math.min(3, this.wave * 0.2)
            b.x = e.x
            b.z = e.z
            b.vx = nx * speed
            b.vz = nz * speed
            b.life = 4
            audio.enemyShot()
          }
        }
      }

      const k = Math.min(1, s * accel)
      e.vx += (tx - e.vx) * k
      e.vz += (tz - e.vz) * k
      e.x += e.vx * s
      e.z += e.vz * s
      const r = spec.radius
      if (Math.abs(e.x) > ARENA_X - r) {
        e.x = Math.sign(e.x) * (ARENA_X - r)
        e.vx *= -0.5
        e.strafe = -e.strafe as 1 | -1
      }
      if (Math.abs(e.z) > ARENA_Z - r) {
        e.z = Math.sign(e.z) * (ARENA_Z - r)
        e.vz *= -0.5
        e.strafe = -e.strafe as 1 | -1
      }
    }

    // Keep the swarm from stacking into one blob; tanks barely budge
    for (let i = 0; i < this.enemies.count; i++) {
      const a = items[i]
      const ra = ENEMIES[a.kind].radius
      for (let j = i + 1; j < this.enemies.count; j++) {
        const b = items[j]
        const rb = ENEMIES[b.kind].radius
        const dx = b.x - a.x
        const dz = b.z - a.z
        const min = ra + rb
        const d2 = dx * dx + dz * dz
        if (d2 >= min * min || d2 === 0) continue
        const d = Math.sqrt(d2)
        const push = (min - d) / d
        const wa = a.kind === 'tank' ? 0.1 : b.kind === 'tank' ? 0.9 : 0.5
        a.x -= dx * push * wa
        a.z -= dz * push * wa
        b.x += dx * push * (1 - wa)
        b.z += dz * push * (1 - wa)
      }
    }
  }

  private collide() {
    const items = this.enemies.items
    for (let i = this.bullets.count - 1; i >= 0; i--) {
      const b = this.bullets.items[i]
      for (let j = 0; j < this.enemies.count; j++) {
        const e = items[j]
        const r = ENEMIES[e.kind].radius + 0.15
        const dx = e.x - b.x
        const dz = e.z - b.z
        if (dx * dx + dz * dz > r * r) continue
        e.hp--
        e.flash = 1
        const push = e.kind === 'tank' ? 0.02 : 0.12
        e.vx += b.vx * push
        e.vz += b.vz * push
        this.burst(b.x, 0.5, b.z, ENEMIES[e.kind].color, 3, 4)
        this.bullets.remove(i)
        if (e.hp <= 0) this.kill(j)
        else audio.hit()
        break
      }
    }

    if (this.invuln > 0 || this.dashT > 0) return
    for (let j = 0; j < this.enemies.count; j++) {
      const e = items[j]
      if (Math.hypot(e.x - this.px, e.z - this.pz) < ENEMIES[e.kind].radius + PLAYER_RADIUS - 0.1) {
        this.damagePlayer()
        return
      }
    }
  }

  private kill(index: number) {
    const e = this.enemies.items[index]
    const spec = ENEMIES[e.kind]
    const big = e.kind === 'tank'
    this.chain++
    this.comboT = COMBO_WINDOW
    this.kills++
    this.addScore(spec.points * this.combo)
    this.burst(e.x, 0.6, e.z, spec.color, big ? 48 : 20, big ? 10 : 7)
    this.burst(e.x, 0.6, e.z, 0xffffff, big ? 12 : 5, 6)
    this.ripple(e.x, e.z, big ? 1 : 0.5)
    this.shake = Math.max(this.shake, big ? 0.6 : 0.18)
    audio.explode(big)
    if (Math.random() < spec.drop) this.dropPickup(e.x, e.z)
    this.enemies.remove(index)
  }

  private dropPickup(x: number, z: number) {
    const p = this.pickups.add()
    if (!p) return
    const options: PickupKind[] = ['spread', 'rapid', 'shield']
    if (this.hp < MAX_HP) options.push('heal')
    // Low on health: hearts become much more likely
    p.kind = this.hp <= 1 && Math.random() < 0.5 ? 'heal' : options[Math.floor(Math.random() * options.length)]
    p.x = x
    p.z = z
    p.life = PICKUP_LIFE
  }

  private collect(p: Pickup) {
    if (p.kind === 'spread' || p.kind === 'rapid') {
      this.power = p.kind
      this.powerT = POWER_TIME
    } else if (p.kind === 'shield') this.shield = true
    else this.hp = Math.min(MAX_HP, this.hp + 1)
    this.burst(p.x, 0.6, p.z, PICKUP_COLORS[p.kind], 16, 5)
    audio.powerUp()
  }

  private damagePlayer() {
    if (this.invuln > 0 || this.dashT > 0) return
    this.shockwave()
    if (this.shield) {
      this.shield = false
      this.invuln = 1
      audio.explode()
      return
    }
    this.hp--
    this.invuln = INVULN
    this.hurt = 1
    this.shake = 1
    this.chain = 0
    audio.hurt()
    this.burst(this.px, 0.6, this.pz, 0xff2b55, 24, 8)
    if (this.hp <= 0) this.gameOver()
  }

  /** Clears enemy fire and shoves nearby enemies away, so a hit never chains into another. */
  private shockwave() {
    this.shockT = 0
    this.enemyBullets.clear()
    this.ripple(this.px, this.pz, 1)
    for (let i = 0; i < this.enemies.count; i++) {
      const e = this.enemies.items[i]
      const dx = e.x - this.px
      const dz = e.z - this.pz
      const d = Math.hypot(dx, dz) || 1
      if (d > SHOCKWAVE_RADIUS) continue
      const force = e.kind === 'tank' ? 6 : 14
      e.vx = (dx / d) * force
      e.vz = (dz / d) * force
      if (e.kind === 'dasher') {
        e.state = 0
        e.t = 1.2
      }
    }
  }

  private gameOver() {
    this.mode = 'over'
    this.trigger = false
    this.shake = 1.6
    audio.gameOver()
    this.burst(this.px, 0.6, this.pz, 0x22d3ee, 70, 12)
    this.burst(this.px, 0.6, this.pz, 0xffffff, 20, 8)
    this.ripple(this.px, this.pz, 1)
    this.emit()
  }

  private addScore(pts: number) {
    this.score += pts
    if (this.score > this.best) {
      this.best = this.score
      this.newBest = true
      writeBest(this.best)
    }
  }

  private ripple(x: number, z: number, strength: number) {
    this.ripples[this.rippleNext].set(x, z, 0, strength)
    this.rippleNext = (this.rippleNext + 1) % RIPPLES
  }

  private burst(x: number, y: number, z: number, color: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const p = this.particles.add()
      if (!p) return
      const a = Math.random() * Math.PI * 2
      const speed = power * (0.3 + Math.random() * 0.7)
      p.x = x
      p.y = y
      p.z = z
      p.vx = Math.cos(a) * speed
      p.vz = Math.sin(a) * speed
      p.vy = 2 + Math.random() * power * 0.8
      p.max = p.life = 0.35 + Math.random() * 0.55
      p.size = 0.08 + Math.random() * 0.16
      p.color.setHex(color).multiplyScalar(2.2)
    }
  }

  /** Cosmetic updates keep running on the game-over screen so the explosion plays out. */
  private updateEffects(s: number) {
    for (let i = this.particles.count - 1; i >= 0; i--) {
      const p = this.particles.items[i]
      p.life -= s
      if (p.life <= 0) {
        this.particles.remove(i)
        continue
      }
      p.vy -= 16 * s
      p.x += p.vx * s
      p.y += p.vy * s
      p.z += p.vz * s
      if (p.y < 0.05) {
        p.y = 0.05
        p.vy *= -0.4
        p.vx *= 0.7
        p.vz *= 0.7
      }
    }
    for (const r of this.ripples) r.z += s
    if (this.shockT >= 0) {
      this.shockT += s
      if (this.shockT > 0.45) this.shockT = -1
    }
    if (this.bannerT > 0) this.bannerT -= s
    this.shake = Math.max(0, this.shake - s * 2.5)
    this.hurt = Math.max(0, this.hurt - s * 2)
  }

  private aimAtPointer() {
    if (this.stickAim || !this.pointerActive) return
    this.raycaster.setFromCamera(this.pointer, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.aimHit)) return
    const dx = this.aimHit.x - this.px
    const dz = this.aimHit.z - this.pz
    const len = Math.hypot(dx, dz)
    if (len < 0.3) return
    this.aimX = dx / len
    this.aimZ = dz / len
  }

  private render(s: number) {
    const d = this.dummy
    const t = this.time

    // ---------- Camera: trails the ship a little, shakes on impacts ----------
    this.camTarget.x += (this.px * 0.35 - this.camTarget.x) * Math.min(1, s * 4)
    this.camTarget.z += (this.pz * 0.3 - this.camTarget.z) * Math.min(1, s * 4)
    const sh = this.shake * this.shake * 0.6
    this.camera.position.set(
      this.camTarget.x + (Math.random() - 0.5) * sh,
      this.camDist * 0.86,
      this.camTarget.z + this.camDist * 0.5 + (Math.random() - 0.5) * sh,
    )
    this.camera.lookAt(this.camTarget)

    // ---------- Ship ----------
    this.ship.position.set(this.px, 0.6 + Math.sin(t * 3) * 0.06, this.pz)
    this.ship.rotation.y = Math.atan2(this.aimX, this.aimZ)
    this.ship.rotation.z = -this.moveX * 0.35
    this.ship.visible = this.mode !== 'over' && (this.invuln <= 0 || Math.floor(t * 14) % 2 === 0)
    this.shieldMesh.visible = this.shield
    this.shieldMesh.rotation.set(t * 0.8, t * 1.3, 0)
    this.shipLight.position.x = this.px
    this.shipLight.position.z = this.pz

    // ---------- Enemies ----------
    const counts: Record<EnemyKind, number> = { drone: 0, dasher: 0, sniper: 0, tank: 0 }
    for (let i = 0; i < this.enemies.count; i++) {
      const e = this.enemies.items[i]
      const mesh = this.enemyMeshes[e.kind]
      const n = counts[e.kind]++
      d.position.set(e.x, (e.kind === 'tank' ? 0.6 : 0.7) + Math.sin(t * 4 + e.spin) * 0.08, e.z)
      if (e.kind === 'dasher') {
        // Point the arrow along its charge, or at the player while stalking
        const ax = e.state === 0 ? this.px - e.x : e.dirX
        const az = e.state === 0 ? this.pz - e.z : e.dirZ
        d.rotation.set(0, Math.atan2(ax, az), 0)
      } else d.rotation.set(e.kind === 'drone' ? e.spin * 0.5 : 0, e.spin, 0)
      d.scale.setScalar(1 + e.flash * 0.15)
      d.updateMatrix()
      mesh.setMatrixAt(n, d.matrix)
      mesh.setColorAt(n, this.tmpColor.setScalar(1 + e.flash * 5))
    }
    for (const kind of ENEMY_KINDS) {
      const mesh = this.enemyMeshes[kind]
      mesh.count = counts[kind]
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.needsUpdate = true
    }

    // ---------- Projectiles ----------
    d.scale.setScalar(1)
    for (let i = 0; i < this.bullets.count; i++) {
      const b = this.bullets.items[i]
      d.position.set(b.x, 0.6, b.z)
      d.rotation.set(0, Math.atan2(b.vx, b.vz), 0)
      d.updateMatrix()
      this.bulletMesh.setMatrixAt(i, d.matrix)
    }
    this.bulletMesh.count = this.bullets.count
    this.bulletMesh.instanceMatrix.needsUpdate = true

    d.rotation.set(0, 0, 0)
    for (let i = 0; i < this.enemyBullets.count; i++) {
      const b = this.enemyBullets.items[i]
      d.position.set(b.x, 0.6, b.z)
      d.scale.setScalar(1 + Math.sin(t * 20 + i) * 0.15)
      d.updateMatrix()
      this.enemyBulletMesh.setMatrixAt(i, d.matrix)
    }
    this.enemyBulletMesh.count = this.enemyBullets.count
    this.enemyBulletMesh.instanceMatrix.needsUpdate = true

    // ---------- Particles ----------
    for (let i = 0; i < this.particles.count; i++) {
      const p = this.particles.items[i]
      d.position.set(p.x, p.y, p.z)
      d.rotation.set(p.life * 9, p.life * 7, 0)
      d.scale.setScalar(p.size * (p.life / p.max))
      d.updateMatrix()
      this.particleMesh.setMatrixAt(i, d.matrix)
      this.particleMesh.setColorAt(i, p.color)
    }
    this.particleMesh.count = this.particles.count
    this.particleMesh.instanceMatrix.needsUpdate = true
    this.particleMesh.instanceColor!.needsUpdate = true

    // ---------- Spawn warnings: rings that close in before the enemy appears ----------
    d.rotation.set(0, 0, 0)
    for (let i = 0; i < this.spawns.count; i++) {
      const sp = this.spawns.items[i]
      d.position.set(sp.x, 0.03, sp.z)
      d.scale.setScalar(1 + (sp.t / SPAWN_WARN) * 1.6)
      d.updateMatrix()
      this.spawnMesh.setMatrixAt(i, d.matrix)
      this.spawnMesh.setColorAt(i, this.tmpColor.setHex(ENEMIES[sp.kind].color).multiplyScalar(2))
    }
    this.spawnMesh.count = this.spawns.count
    this.spawnMesh.instanceMatrix.needsUpdate = true
    this.spawnMesh.instanceColor!.needsUpdate = true

    // ---------- Pickups: blink during their last two seconds ----------
    let n = 0
    for (let i = 0; i < this.pickups.count; i++) {
      const p = this.pickups.items[i]
      if (p.life < 2 && Math.floor(p.life * 8) % 2 === 0) continue
      d.position.set(p.x, 0.7 + Math.sin(t * 4 + i) * 0.15, p.z)
      d.rotation.set(0, t * 2.5, 0)
      d.scale.setScalar(1)
      d.updateMatrix()
      this.pickupMesh.setMatrixAt(n, d.matrix)
      this.pickupMesh.setColorAt(n, this.tmpColor.setHex(PICKUP_COLORS[p.kind]).multiplyScalar(2.4))
      n++
    }
    this.pickupMesh.count = n
    this.pickupMesh.instanceMatrix.needsUpdate = true
    this.pickupMesh.instanceColor!.needsUpdate = true

    // ---------- Shockwave and floor ----------
    this.shockMesh.visible = this.shockT >= 0
    if (this.shockT >= 0) {
      const k = this.shockT / 0.45
      this.shockMesh.position.x = this.px
      this.shockMesh.position.z = this.pz
      this.shockMesh.scale.setScalar(0.5 + k * SHOCKWAVE_RADIUS)
      this.shockMesh.material.opacity = 1 - k
    }
    this.floor.uniforms.uTime.value = t
    this.floor.uniforms.uHurt.value = this.hurt

    if (this.qualityLevel > 0) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  private frame = (now: number) => {
    const dt = Math.min(now - (this.lastFrame || now), 100)
    this.lastFrame = now
    const s = dt / 1000
    this.monitorPerf(dt)

    if (this.mode === 'playing') {
      this.aimAtPointer()
      const steps = Math.min(12, Math.ceil(s / STEP))
      for (let i = 0; i < steps && this.mode === 'playing'; i++) this.step(s / steps)
    } else if (this.mode === 'menu') {
      // Idle spin so the menu doesn't look frozen
      this.time += s
      const a = this.time * 0.6
      this.aimX = Math.sin(a)
      this.aimZ = Math.cos(a)
    } else if (this.mode === 'over') this.time += s

    // A paused frame doesn't change, so the GPU can rest until something resizes
    if (this.mode !== 'paused') {
      this.updateEffects(s)
      this.render(s)
    } else if (this.dirty) this.render(0)
    this.dirty = false
    this.emit()
    this.raf = requestAnimationFrame(this.frame)
  }
}
