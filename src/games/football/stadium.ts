import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import grassUrl from './assets/pitch-grass-basecolor.png'

// Static scenery, built once. Pitch coordinates are centred: x across, z along, y up, in metres.

export interface PitchSpec {
  w: number
  h: number
  goalW: number
  goalDepth: number
  crossbar: number
  boxW: number
  boxD: number
  sixW: number
  sixD: number
  penSpot: number
  circleR: number
}

const APRON = 4
const PX = 20

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

const texture = (c: HTMLCanvasElement, aniso: number) => {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = aniso
  return t
}

/**
 * Mowed grass with the markings painted on, apron included. The markings are always drawn here at the
 * real dimensions; the grass under them is painted procedurally, then swapped for the grass texture
 * (8 mowing bands per tile, so two tiles make the 16 bands of the pitch) once it loads.
 */
function pitchTexture(p: PitchSpec, aniso: number) {
  const W = (p.w + APRON * 2) * PX
  const H = (p.h + APRON * 2) * PX
  const [c, g] = canvas(W, H)
  const tex = texture(c, aniso)
  // The noise is random, so it's drawn once and reused when the grass is repainted
  const [noise, ng] = canvas(W, H)
  for (let i = 0; i < 60000; i++) {
    const light = Math.random() < 0.5
    ng.fillStyle = light ? 'rgba(180, 255, 170, 0.05)' : 'rgba(0, 30, 0, 0.08)'
    ng.fillRect(Math.random() * W, Math.random() * H, 1, 2 + Math.random() * 3)
  }
  paintPitch(g, p, null, noise)
  const img = new Image()
  img.onload = () => {
    paintPitch(g, p, img, noise)
    tex.needsUpdate = true
  }
  img.src = grassUrl
  return tex
}

function paintPitch(g: CanvasRenderingContext2D, p: PitchSpec, grass: HTMLImageElement | null, noise: HTMLCanvasElement) {
  const W = (p.w + APRON * 2) * PX
  const H = (p.h + APRON * 2) * PX
  const m = (v: number) => (v + APRON) * PX

  g.fillStyle = '#1d5a2a'
  g.fillRect(0, 0, W, H)
  if (grass) {
    const tile = (p.h * PX) / 2
    g.drawImage(grass, m(0), m(0), p.w * PX, tile)
    g.drawImage(grass, m(0), m(0) + tile, p.w * PX, tile)
  } else {
    const bands = 16
    const bh = (p.h * PX) / bands
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? '#2c7a37' : '#33873e'
      g.fillRect(m(0), m(0) + i * bh, p.w * PX, bh)
    }
  }
  // Blade-level noise so the stripes don't look like flat paint
  g.drawImage(noise, 0, 0)

  g.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  g.fillStyle = 'rgba(255, 255, 255, 0.92)'
  g.lineWidth = 0.12 * PX
  const cx = p.w / 2
  const cy = p.h / 2
  g.strokeRect(m(0), m(0), p.w * PX, p.h * PX)
  g.beginPath()
  g.moveTo(m(0), m(cy))
  g.lineTo(m(p.w), m(cy))
  g.stroke()
  g.beginPath()
  g.arc(m(cx), m(cy), p.circleR * PX, 0, Math.PI * 2)
  g.stroke()
  for (const [line, dir] of [
    [0, 1],
    [p.h, -1],
  ]) {
    const box = dir > 0 ? m(line) : m(line - p.boxD)
    g.strokeRect(m(cx - p.boxW / 2), box, p.boxW * PX, p.boxD * PX)
    const six = dir > 0 ? m(line) : m(line - p.sixD)
    g.strokeRect(m(cx - p.sixW / 2), six, p.sixW * PX, p.sixD * PX)
    const spot = line + dir * p.penSpot
    g.beginPath()
    g.arc(m(cx), m(spot), 0.22 * PX, 0, Math.PI * 2)
    g.fill()
    // The "D": the part of the penalty arc outside the box
    const r = 8
    const a = Math.acos((p.boxD - p.penSpot) / r)
    g.beginPath()
    if (dir > 0) g.arc(m(cx), m(spot), r * PX, Math.PI / 2 - a, Math.PI / 2 + a)
    else g.arc(m(cx), m(spot), r * PX, -Math.PI / 2 - a, -Math.PI / 2 + a)
    g.stroke()
  }
  for (const [x, y, a0] of [
    [0, 0, 0],
    [p.w, 0, Math.PI / 2],
    [p.w, p.h, Math.PI],
    [0, p.h, -Math.PI / 2],
  ]) {
    g.beginPath()
    g.arc(m(x), m(y), 1 * PX, a0, a0 + Math.PI / 2)
    g.stroke()
  }
  g.beginPath()
  g.arc(m(cx), m(cy), 0.25 * PX, 0, Math.PI * 2)
  g.fill()
}

function boardTexture() {
  const [c, g] = canvas(512, 64)
  g.fillStyle = '#05060f'
  g.fillRect(0, 0, 512, 64)
  g.font = '900 34px Orbitron, Arial Black, sans-serif'
  g.textBaseline = 'middle'
  g.fillStyle = '#22d3ee'
  g.shadowColor = '#22d3ee'
  g.shadowBlur = 12
  g.fillText('KITUMBA', 18, 34)
  g.fillStyle = '#e879f9'
  g.shadowColor = '#e879f9'
  g.fillText('GAMES', 230, 34)
  g.fillStyle = '#fde047'
  g.shadowColor = '#fde047'
  g.fillText('✦', 420, 34)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = RepeatWrapping
  return t
}

function crowdTexture() {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#0a0c16'
  g.fillRect(0, 0, 512, 512)
  const colours = ['#22d3ee', '#0891b2', '#e879f9', '#a21caf', '#f8fafc', '#fde047', '#f97316', '#334155', '#1e293b']
  const skins = ['#f1c27d', '#c68642', '#8d5524', '#5c3a21', '#ffdbac']
  // Rows of seated fans: a shirt and a head each, with a little jitter
  for (let row = 0; row < 16; row++) {
    const y = row * 32 + 20
    g.fillStyle = '#141826'
    g.fillRect(0, y + 8, 512, 6)
    for (let col = 0; col < 32; col++) {
      if (Math.random() < 0.08) continue
      const x = col * 16 + 8 + (Math.random() - 0.5) * 4
      g.fillStyle = colours[(Math.random() * colours.length) | 0]
      g.fillRect(x - 5, y - 2, 10, 11)
      g.fillStyle = skins[(Math.random() * skins.length) | 0]
      g.beginPath()
      g.arc(x, y - 7, 4, 0, Math.PI * 2)
      g.fill()
    }
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}

function netTexture() {
  const [c, g] = canvas(128, 128)
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  g.lineWidth = 3
  for (let i = 0; i <= 128; i += 16) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, 128)
    g.moveTo(0, i)
    g.lineTo(128, i)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}

function goal(p: PitchSpec, netTex: CanvasTexture, nets: Mesh[]) {
  const group = new Group()
  const white = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.1 })
  const r = 0.07
  const post = new CylinderGeometry(r, r, p.crossbar, 10).translate(0, p.crossbar / 2, 0)
  for (const side of [-1, 1]) {
    const m = new Mesh(post, white)
    m.position.x = (side * p.goalW) / 2
    m.castShadow = true
    group.add(m)
  }
  const bar = new Mesh(new CylinderGeometry(r, r, p.goalW + r * 2, 10).rotateZ(Math.PI / 2), white)
  bar.position.y = p.crossbar
  bar.castShadow = true
  group.add(bar)

  // Net: back, roof and sides, behind the line (local -z)
  const d = p.goalDepth
  const net = (w: number, h: number) => {
    const t = netTex.clone()
    t.repeat.set(w / 0.35, h / 0.35)
    t.needsUpdate = true
    return new MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false })
  }
  const back = new Mesh(new PlaneGeometry(p.goalW, p.crossbar), net(p.goalW, p.crossbar))
  back.position.set(0, p.crossbar / 2, -d)
  nets.push(back)
  const roof = new Mesh(new PlaneGeometry(p.goalW, d), net(p.goalW, d))
  roof.rotation.x = Math.PI / 2
  roof.position.set(0, p.crossbar, -d / 2)
  group.add(back, roof)
  for (const side of [-1, 1]) {
    const s = new Mesh(new PlaneGeometry(d, p.crossbar), net(d, p.crossbar))
    s.rotation.y = Math.PI / 2
    s.position.set((side * p.goalW) / 2, p.crossbar / 2, -d / 2)
    group.add(s)
  }
  return group
}

/** Builds the scenery. `nets` are the back nets, top goal first, so a goal can make them bulge. */
export function buildStadium(p: PitchSpec, aniso: number) {
  const group = new Group()
  const nets: Mesh[] = []

  const outer = new Mesh(
    new PlaneGeometry(240, 240).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({ color: 0x173f22, roughness: 1 }),
  )
  outer.position.y = -0.02
  outer.receiveShadow = true
  group.add(outer)

  const pitch = new Mesh(
    new PlaneGeometry(p.w + APRON * 2, p.h + APRON * 2).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({ map: pitchTexture(p, aniso), roughness: 0.95 }),
  )
  pitch.receiveShadow = true
  group.add(pitch)

  for (const [z, rot] of [
    [-p.h / 2, 0],
    [p.h / 2, Math.PI],
  ]) {
    const g = goal(p, netTexture(), nets)
    g.position.z = z
    g.rotation.y = rot
    group.add(g)
  }

  // Advertising boards around the pitch and stands behind them
  const boardTex = boardTexture()
  const crowdTex = crowdTexture()
  const sides: [number, number, number, number][] = [
    // length, centre x, centre z, rotation
    [p.h + APRON * 2, -(p.w / 2 + 3), 0, Math.PI / 2],
    [p.h + APRON * 2, p.w / 2 + 3, 0, -Math.PI / 2],
    [p.w + APRON * 2, 0, -(p.h / 2 + 3.6), 0],
    [p.w + APRON * 2, 0, p.h / 2 + 3.6, Math.PI],
  ]
  for (const [len, x, z, rot] of sides) {
    const t = boardTex.clone()
    t.repeat.set(len / 9, 1)
    t.needsUpdate = true
    const board = new Mesh(
      new BoxGeometry(len, 0.9, 0.12),
      new MeshBasicMaterial({ map: t, toneMapped: false }),
    )
    board.position.set(x, 0.45, z)
    board.rotation.y = rot
    group.add(board)

    const ct = crowdTex.clone()
    ct.repeat.set(len / 16, 2)
    ct.needsUpdate = true
    // Tilted back like a terrace, starting just behind the boards (local -z points away from the pitch)
    const side = new Group()
    side.position.set(x, 0, z)
    side.rotation.y = rot
    const stand = new Mesh(
      new PlaneGeometry(len + 16, 22),
      new MeshStandardMaterial({ map: ct, roughness: 1, side: DoubleSide }),
    )
    const tilt = 0.6
    stand.rotation.x = -(Math.PI / 2 - tilt)
    stand.position.set(0, 0.5 + 11 * Math.sin(tilt), -(1.5 + 11 * Math.cos(tilt)))
    side.add(stand)
    group.add(side)
  }

  // Floodlight towers in the corners
  const towerMat = new MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
  const lampMat = new MeshBasicMaterial({ color: 0xf8fafc, toneMapped: false })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (p.w / 2 + 16)
      const z = sz * (p.h / 2 + 16)
      const pole = new Mesh(new CylinderGeometry(0.4, 0.6, 30, 8).translate(0, 15, 0), towerMat)
      pole.position.set(x, 0, z)
      const lamp = new Mesh(new BoxGeometry(5, 2.4, 0.5), lampMat)
      lamp.position.set(x, 30, z)
      lamp.lookAt(0, 0, 0)
      group.add(pole, lamp)
    }
  }
  return { group, nets }
}
