// Every sound is synthesized with the Web Audio API — no audio files needed.

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private noiseBuffer!: AudioBuffer
  // Rapid fire would stack dozens of voices; shots closer than this share one
  private lastShot = 0

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

  // ---------- Effects ----------

  start() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    // Power-up charge, then a rising chord
    this.tone(80, 0.5, { type: 'sawtooth', vol: 0.12, slideTo: 640, at: t, cutoff: 2000 })
    ;[0, 7, 12].forEach((s, i) => this.tone(NOTE(s), 0.25, { type: 'square', vol: 0.07, at: t + 0.45 + i * 0.07 }))
  }

  shoot() {
    const ctx = this.ensure()
    if (ctx.currentTime - this.lastShot < 0.05) return
    this.lastShot = ctx.currentTime
    this.tone(1400, 0.07, { type: 'square', vol: 0.035, slideTo: 380, cutoff: 3500 })
  }

  enemyShot() {
    this.tone(320, 0.18, { type: 'triangle', vol: 0.07, slideTo: 140 })
  }

  hit() {
    this.noise(0.05, { vol: 0.06, hp: 3000 })
  }

  explode(big = false) {
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.noise(big ? 0.7 : 0.3, { vol: big ? 0.35 : 0.16, band: 1400, sweepTo: 120, at: t })
    this.tone(big ? 110 : 180, big ? 0.5 : 0.2, { type: 'square', vol: big ? 0.2 : 0.09, slideTo: 40, cutoff: 900 })
  }

  dash() {
    this.noise(0.18, { vol: 0.14, band: 500, sweepTo: 3500 })
  }

  powerUp() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    ;[0, 4, 7, 12].forEach((s, i) =>
      this.tone(NOTE(s + 7), 0.12, { type: 'square', vol: 0.08, at: t + i * 0.05, cutoff: 4000 }),
    )
  }

  hurt() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.tone(220, 0.4, { type: 'sawtooth', vol: 0.22, slideTo: 55, at: t, cutoff: 1200 })
    this.noise(0.4, { vol: 0.25, hp: 200, at: t })
  }

  waveStart() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    ;[0, 3, 7, 10].forEach((s, i) =>
      this.tone(NOTE(s - 12), 0.2, { type: 'sawtooth', vol: 0.09, at: t + i * 0.08, cutoff: 2200 }),
    )
  }

  pause() {
    this.tone(520, 0.08, { type: 'sine', vol: 0.1 })
    this.tone(390, 0.12, { type: 'sine', vol: 0.1, at: (this.ctx?.currentTime ?? 0) + 0.08 })
  }

  gameOver() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.noise(1.2, { vol: 0.4, band: 900, sweepTo: 60, at: t })
    ;[7, 3, 0, -5].forEach((s, i) =>
      this.tone(NOTE(s - 12), 0.35, { type: 'triangle', vol: 0.14, at: t + 0.3 + i * 0.18 }),
    )
  }

  click() {
    this.tone(880, 0.05, { type: 'square', vol: 0.06, cutoff: 3000 })
  }
}

export const audio = new AudioEngine()
