// Every sound is synthesized with the Web Audio API — no audio files needed.

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private noiseBuffer!: AudioBuffer

  // Continuous engine drone, alive only while driving
  private engine: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; pitch: number } | null = null

  muted = false

  private ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    }
    const ctx = new AudioContext()
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = 0.9
    this.sfxBus.connect(this.master)

    const len = ctx.sampleRate
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

    return ctx
  }

  /** Must be called from a user gesture to unlock audio. */
  unlock() {
    this.ensure()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (!this.ctx) return
    this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03)
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType
      vol?: number
      slideTo?: number
      at?: number
      cutoff?: number
    } = {},
  ) {
    const ctx = this.ensure()
    const t = opts.at ?? ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(freq, t)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur)
    filter.type = 'lowpass'
    filter.frequency.value = opts.cutoff ?? 6000
    const vol = opts.vol ?? 0.2
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(filter).connect(gain).connect(this.sfxBus)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /** Filtered noise burst; `sweepTo` glides a band-pass for whooshes. */
  private noise(
    dur: number,
    opts: { vol?: number; at?: number; hp?: number; band?: number; sweepTo?: number } = {},
  ) {
    const ctx = this.ensure()
    const t = opts.at ?? ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    if (opts.band) {
      filter.type = 'bandpass'
      filter.Q.value = 1.4
      filter.frequency.setValueAtTime(opts.band, t)
      if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur)
    } else {
      filter.type = 'highpass'
      filter.frequency.value = opts.hp ?? 1000
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(opts.vol ?? 0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(gain).connect(this.sfxBus)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  // ---------- Engine drone ----------

  /** `pitch` scales the drone: above 1 for a buzzy bike, below 1 for a heavy diesel. */
  startEngine(pitch = 1) {
    const ctx = this.ensure()
    if (this.engine) return
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    filter.Q.value = 4
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.3)
    const oscs = (['sawtooth', 'square'] as const).map((type, i) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = (i ? 30 : 60) * pitch
      osc.connect(filter)
      osc.start()
      return osc
    })
    filter.connect(gain).connect(this.sfxBus)
    this.engine = { oscs, filter, gain, pitch }
  }

  /** `rev` goes from 0 (idle) to 1 (top speed with boost). */
  setEngine(rev: number) {
    if (!this.ctx || !this.engine) return
    const t = this.ctx.currentTime
    const f = (55 + rev * 110) * this.engine.pitch
    this.engine.oscs[0].frequency.setTargetAtTime(f, t, 0.08)
    this.engine.oscs[1].frequency.setTargetAtTime(f / 2, t, 0.08)
    this.engine.filter.frequency.setTargetAtTime(500 + rev * 1800, t, 0.08)
  }

  stopEngine() {
    if (!this.ctx || !this.engine) return
    const { oscs, gain } = this.engine
    const t = this.ctx.currentTime
    gain.gain.setTargetAtTime(0.0001, t, 0.05)
    oscs.forEach((o) => o.stop(t + 0.3))
    this.engine = null
  }

  // ---------- Effects ----------

  start() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    // Ignition: starter crank, then a rev
    for (let i = 0; i < 3; i++) this.tone(70, 0.08, { type: 'square', vol: 0.12, at: t + i * 0.09, cutoff: 900 })
    this.tone(60, 0.6, { type: 'sawtooth', vol: 0.16, slideTo: 260, at: t + 0.27, cutoff: 1800 })
    this.noise(0.5, { vol: 0.05, hp: 2500, at: t + 0.27 })
  }

  laneChange() {
    this.noise(0.12, { vol: 0.12, band: 900, sweepTo: 2600 })
    this.tone(260, 0.05, { type: 'sine', vol: 0.04 })
  }

  boost() {
    this.tone(180, 0.35, { type: 'sawtooth', vol: 0.1, slideTo: 720, cutoff: 2400 })
    this.noise(0.35, { vol: 0.08, band: 600, sweepTo: 4000 })
  }

  coin() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.tone(NOTE(14), 0.08, { type: 'square', vol: 0.1, at: t, cutoff: 4000 })
    this.tone(NOTE(19), 0.2, { type: 'square', vol: 0.1, at: t + 0.06, cutoff: 4000 })
  }

  nearMiss() {
    // A car flashing past: band-passed noise sweeping down, Doppler-style
    this.noise(0.28, { vol: 0.22, band: 3000, sweepTo: 400 })
    this.tone(900, 0.25, { type: 'triangle', vol: 0.05, slideTo: 500 })
  }

  levelUp() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    ;[0, 4, 7, 12, 16].forEach((s, i) =>
      this.tone(NOTE(s), 0.18, { type: 'sawtooth', vol: 0.09, at: t + i * 0.06, cutoff: 2600 }),
    )
  }

  pause() {
    this.tone(520, 0.08, { type: 'sine', vol: 0.1 })
    this.tone(390, 0.12, { type: 'sine', vol: 0.1, at: (this.ctx?.currentTime ?? 0) + 0.08 })
  }

  crash() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    // Tyre screech, impact thud, metal clang, then debris
    this.noise(0.22, { vol: 0.18, band: 2200, sweepTo: 3200, at: t })
    this.tone(120, 0.5, { type: 'square', vol: 0.3, slideTo: 30, at: t + 0.12, cutoff: 600 })
    this.noise(0.9, { vol: 0.4, hp: 80, at: t + 0.12 })
    ;[1180, 1730, 2410].forEach((f, i) =>
      this.tone(f, 0.6, { type: 'triangle', vol: 0.07, slideTo: f * 0.8, at: t + 0.13 + i * 0.015 }),
    )
    this.noise(0.5, { vol: 0.08, hp: 5000, at: t + 0.35 })
  }

  click() {
    this.tone(880, 0.05, { type: 'square', vol: 0.06, cutoff: 3000 })
  }
}

export const audio = new AudioEngine()
