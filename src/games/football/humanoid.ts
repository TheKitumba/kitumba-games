import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from 'three'

// A footballer built from capsules and pivot groups, in metres, feet on y = 0, facing +z.
// Joints are groups so the limbs can be posed with plain rotations every frame.

export interface Kit {
  shirt: number
  sleeve: number
  shorts: number
  socks: number
  /** CSS colour for the shirt number */
  number: string
}

export interface Look {
  skin: number
  hair: number
  /** 0 short, 1 buzz cut, 2 afro, 3 shaved */
  hairStyle: number
  /** Height multiplier around 1.8 m */
  scale: number
}

export interface Pose {
  /** Run cycle angle in radians */
  phase: number
  /** 0 standing, ~0.75 running, 1 sprinting */
  speed: number
  /** 0..1 progress of a kick, 0 when not kicking */
  kick: number
  /** 0..1 how far into a slide tackle (or a fall) the body is */
  slide: number
  /** Keeper dive in local space: -1 to the model's right, 1 to its left, 0 standing */
  dive: number
  celebrate: boolean
  time: number
}

const HIP_Y = 0.92

// Shared geometry: every player is the same mesh set with different materials
let geo: Record<string, BufferGeometry> | null = null
const geometry = () => {
  if (geo) return geo
  const capsule = (r: number, len: number, pivotTop: boolean) => {
    const g = new CapsuleGeometry(r, len, 4, 10)
    if (pivotTop) g.translate(0, -len / 2, 0)
    return g
  }
  geo = {
    torso: capsule(0.17, 0.32, false).translate(0, 0.3, 0),
    shorts: new CylinderGeometry(0.17, 0.2, 0.26, 12).translate(0, -0.05, 0),
    shortsLeg: new CylinderGeometry(0.1, 0.095, 0.2, 10).translate(0, -0.1, 0),
    thigh: capsule(0.082, 0.44, true),
    shin: capsule(0.064, 0.4, true),
    foot: new BoxGeometry(0.11, 0.08, 0.26).translate(0, -0.42, 0.06),
    upperArm: capsule(0.052, 0.24, true),
    sleeve: new CylinderGeometry(0.072, 0.066, 0.15, 10).translate(0, -0.06, 0),
    forearm: capsule(0.045, 0.22, true),
    hand: new SphereGeometry(0.05, 8, 6).translate(0, -0.27, 0),
    neck: new CylinderGeometry(0.05, 0.058, 0.12, 8),
    head: new SphereGeometry(0.115, 16, 12),
    hair0: new SphereGeometry(0.123, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).rotateX(-0.25),
    hair1: new SphereGeometry(0.119, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45).rotateX(-0.2),
    hair2: new SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).rotateX(-0.3),
    nose: new BoxGeometry(0.03, 0.04, 0.04),
    number: new PlaneGeometry(0.24, 0.24),
  }
  return geo
}

const matCache = new Map<string, MeshStandardMaterial>()
const mat = (color: number, roughness = 0.85) => {
  const key = `${color}:${roughness}`
  let m = matCache.get(key)
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness })
    matCache.set(key, m)
  }
  return m
}

const numberMaterial = (n: number, color: string) => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.font = '900 46px Orbitron, Arial Black, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 6
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  g.strokeText(String(n), 32, 35)
  g.fillStyle = color
  g.fillText(String(n), 32, 35)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return new MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.8 })
}

const mesh = (g: BufferGeometry, m: Material, parent: Group, x = 0, y = 0, z = 0) => {
  const o = new Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = true
  parent.add(o)
  return o
}

const joint = (parent: Group, x: number, y: number, z = 0) => {
  const g = new Group()
  g.position.set(x, y, z)
  parent.add(g)
  return g
}

export class Humanoid {
  readonly root = new Group()
  private hips: Group
  private chest: Group
  private head: Group
  private legs: { hip: Group; knee: Group }[] = []
  private arms: { shoulder: Group; elbow: Group }[] = []
  private numberMat: MeshStandardMaterial

  constructor(kit: Kit, look: Look, shirtNumber: number, keeper: boolean) {
    const g = geometry()
    const skin = mat(look.skin, 0.7)
    const shirt = mat(kit.shirt, 0.75)
    const sleeve = mat(kit.sleeve, 0.75)
    const shorts = mat(kit.shorts, 0.8)
    const socks = mat(kit.socks, 0.9)
    const boots = mat(0x111318, 0.4)
    const gloves = keeper ? mat(0xf5f5f5, 0.6) : skin

    this.root.scale.setScalar(look.scale)
    this.hips = joint(this.root, 0, HIP_Y)
    mesh(g.shorts, shorts, this.hips)

    for (const side of [1, -1]) {
      const hip = joint(this.hips, side * 0.1, -0.02)
      mesh(g.thigh, skin, hip)
      mesh(g.shortsLeg, shorts, hip)
      const knee = joint(hip, 0, -0.44)
      mesh(g.shin, socks, knee)
      mesh(g.foot, boots, knee)
      this.legs.push({ hip, knee })
    }

    this.chest = joint(this.hips, 0, 0.04)
    const torso = mesh(g.torso, shirt, this.chest)
    torso.scale.set(1.3, 1, 0.72)
    this.numberMat = numberMaterial(shirtNumber, kit.number)
    const num = mesh(g.number, this.numberMat, this.chest, 0, 0.36, -0.128)
    num.rotation.y = Math.PI
    num.castShadow = false

    for (const side of [1, -1]) {
      const shoulder = joint(this.chest, side * 0.25, 0.54)
      shoulder.rotation.z = side * 0.12
      mesh(g.upperArm, skin, shoulder)
      mesh(g.sleeve, keeper ? shirt : sleeve, shoulder)
      const elbow = joint(shoulder, 0, -0.27)
      mesh(g.forearm, keeper ? shirt : skin, elbow)
      mesh(g.hand, gloves, elbow)
      this.arms.push({ shoulder, elbow })
    }

    mesh(g.neck, skin, this.chest, 0, 0.64)
    this.head = joint(this.chest, 0, 0.78)
    mesh(g.head, skin, this.head)
    mesh(g.nose, skin, this.head, 0, -0.01, 0.11)
    if (look.hairStyle < 3) mesh(g[`hair${look.hairStyle}`], mat(look.hair, 0.95), this.head, 0, 0.02, -0.01)
  }

  dispose() {
    this.numberMat.map?.dispose()
    this.numberMat.dispose()
  }

  pose(p: Pose) {
    const [legA, legB] = this.legs
    const [armA, armB] = this.arms
    const s = p.speed
    const amp = Math.min(1, s * 3) * (0.5 + 0.45 * s)
    const swing = Math.sin(p.phase)

    // Running: legs swing opposite each other, knees fold on the back swing, arms counter the legs
    legA.hip.rotation.set(-swing * amp, 0, 0)
    legB.hip.rotation.set(swing * amp, 0, 0)
    legA.knee.rotation.x = amp * (0.35 + 0.85 * Math.max(0, Math.sin(p.phase - 1.3)))
    legB.knee.rotation.x = amp * (0.35 + 0.85 * Math.max(0, Math.sin(p.phase + Math.PI - 1.3)))
    armA.shoulder.rotation.set(swing * amp * 0.9, 0, 0.12)
    armB.shoulder.rotation.set(-swing * amp * 0.9, 0, -0.12)
    armA.elbow.rotation.x = -(0.25 + s * 1.1)
    armB.elbow.rotation.x = -(0.25 + s * 1.1)

    this.hips.position.set(0, HIP_Y - amp * 0.04 + Math.abs(Math.cos(p.phase)) * amp * 0.06, 0)
    this.hips.rotation.set(0, 0, 0)
    this.chest.rotation.set(0.06 + s * 0.22, swing * amp * 0.15, 0)
    this.head.rotation.set(-s * 0.18, 0, 0)
    if (s < 0.05) {
      // Idle: weight shifting and breathing so nobody stands like a statue
      const breathe = Math.sin(p.time * 2.2)
      this.chest.rotation.x = 0.04 + breathe * 0.015
      legA.knee.rotation.x = 0.12
      legB.knee.rotation.x = 0.12
      legA.hip.rotation.x = -0.06
      armA.shoulder.rotation.x = 0.05 + breathe * 0.03
      armB.shoulder.rotation.x = 0.05 - breathe * 0.03
    }

    if (p.kick > 0) {
      // Wind the kicking leg back, then snap it through the ball
      const k = p.kick
      const back = k < 0.35 ? k / 0.35 : Math.max(0, 1 - (k - 0.35) / 0.2)
      const through = k < 0.35 ? 0 : Math.min(1, (k - 0.35) / 0.25) * (1 - Math.max(0, (k - 0.75) / 0.25))
      legA.hip.rotation.x = back * 0.8 - through * 1.35
      legA.knee.rotation.x = back * 1.3 + 0.1
      legB.hip.rotation.x = 0.1
      legB.knee.rotation.x = 0.25
      armA.shoulder.rotation.z = 0.7
      armB.shoulder.rotation.z = -0.7
      this.chest.rotation.x = 0.15 - through * 0.25
    }

    if (p.slide > 0) {
      // Lean back on the hip with the legs out in front
      const t = p.slide
      this.hips.rotation.x = -1.3 * t
      this.hips.position.y = HIP_Y - 0.68 * t
      legA.hip.rotation.x = -0.15 * t
      legA.knee.rotation.x = 0.05
      legB.hip.rotation.x = 0.2 * t
      legB.knee.rotation.x = 1.2 * t
      armA.shoulder.rotation.set(-0.4 * t, 0, 1.1 * t)
      armB.shoulder.rotation.set(-0.4 * t, 0, -1.1 * t)
    }

    if (p.dive !== 0) {
      // Keeper stretched out sideways, both arms reaching past the head
      const d = p.dive
      this.hips.rotation.z = -d * 1.35
      this.hips.position.y = HIP_Y + 0.15 - Math.abs(d) * 0.35
      armA.shoulder.rotation.set(0, 0, 2.9)
      armB.shoulder.rotation.set(0, 0, -2.9)
      armA.elbow.rotation.x = -0.1
      armB.elbow.rotation.x = -0.1
      legA.hip.rotation.set(0, 0, 0.25)
      legB.hip.rotation.set(0, 0, -0.1)
    }

    if (p.celebrate) {
      const jump = Math.abs(Math.sin(p.time * 7))
      this.hips.position.y = HIP_Y + jump * 0.22
      armA.shoulder.rotation.set(0, 0, 2.6 + jump * 0.2)
      armB.shoulder.rotation.set(0, 0, -2.6 - jump * 0.2)
      armA.elbow.rotation.x = -0.2
      armB.elbow.rotation.x = -0.2
      legA.knee.rotation.x = jump * 0.6
      legB.knee.rotation.x = jump * 0.6
    }
  }
}
