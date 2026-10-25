// Every sound is synthesized with the Web Audio API — no audio files needed.

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private noiseBuffer!: AudioBuffer

  // Stadium crowd murmur, alive only while the ball is in play
  private crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null

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

    const len = ctx.sampleRate * 2
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
    opts: { vol?: number; at?: number; hp?: number; band?: number; sweepTo?: number; attack?: number } = {},
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
    const vol = opts.vol ?? 0.2
    if (opts.attack) {
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(vol, t + opts.attack)
    } else gain.gain.setValueAtTime(vol, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(gain).connect(this.sfxBus)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  /** Referee's pea whistle: a high sine with a fast trill. */
  private blow(dur: number, at: number) {
    const ctx = this.ensure()
    const osc = ctx.createOscillator()
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 2900
    lfo.frequency.value = 28
    depth.gain.value = 140
    lfo.connect(depth).connect(osc.frequency)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02)
    gain.gain.setValueAtTime(0.09, at + dur - 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(gain).connect(this.sfxBus)
    osc.start(at)
    lfo.start(at)
    osc.stop(at + dur + 0.02)
    lfo.stop(at + dur + 0.02)
  }

  // ---------- Crowd ----------

  startCrowd() {
    const ctx = this.ensure()
    if (this.crowd) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 500
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.6)
    src.connect(filter).connect(gain).connect(this.sfxBus)
    src.start()
    this.crowd = { src, gain }
  }

  stopCrowd() {
    if (!this.ctx || !this.crowd) return
    const { src, gain } = this.crowd
    const t = this.ctx.currentTime
    gain.gain.setTargetAtTime(0.0001, t, 0.1)
    src.stop(t + 0.6)
    this.crowd = null
  }

  // ---------- Effects ----------

  whistle() {
    this.blow(0.35, this.ensure().currentTime)
  }

  fullTime() {
    const t = this.ensure().currentTime
    this.blow(0.25, t)
    this.blow(0.25, t + 0.35)
    this.blow(0.7, t + 0.7)
  }

  /** `power` goes from 0 (tap) to 1 (full shot). */
  kick(power: number) {
    this.tone(140, 0.12, { type: 'sine', vol: 0.18 + power * 0.12, slideTo: 60, cutoff: 900 })
    this.noise(0.05, { vol: 0.08 + power * 0.06, band: 1800 })
  }

  whiff() {
    this.noise(0.12, { vol: 0.06, band: 700, sweepTo: 1800 })
  }

  bounce() {
    this.tone(220, 0.06, { type: 'sine', vol: 0.07, slideTo: 120, cutoff: 1200 })
  }

  post() {
    // Metal ring off the woodwork
    const t = this.ensure().currentTime
    ;[880, 1320, 1975].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', vol: 0.08, at: t + i * 0.01 }))
    this.noise(0.4, { vol: 0.08, band: 500, attack: 0.1, at: t + 0.05 })
  }

  goal() {
    const t = this.ensure().currentTime
    // Crowd roar swelling up, then a fanfare on top
    this.noise(2.2, { vol: 0.32, band: 700, sweepTo: 1200, attack: 0.25, at: t })
    ;[0, 4, 7, 12, 16, 19].forEach((s, i) =>
      this.tone(NOTE(s), 0.22, { type: 'sawtooth', vol: 0.09, at: t + i * 0.08, cutoff: 2800 }),
    )
    this.tone(NOTE(24), 0.6, { type: 'square', vol: 0.07, at: t + 0.5, cutoff: 3000 })
  }

  conceded() {
    const t = this.ensure().currentTime
    // Disappointed groan from the stands and a falling line
    this.noise(1.2, { vol: 0.18, band: 400, sweepTo: 200, attack: 0.15, at: t })
    ;[7, 3, 0, -5].forEach((s, i) =>
      this.tone(NOTE(s - 12), 0.25, { type: 'triangle', vol: 0.12, at: t + i * 0.14 }),
    )
  }

  win() {
    const t = this.ensure().currentTime
    ;[0, 4, 7, 12, 7, 12, 16].forEach((s, i) =>
      this.tone(NOTE(s), 0.2, { type: 'square', vol: 0.08, at: t + 1.5 + i * 0.12, cutoff: 3200 }),
    )
  }

  pause() {
    this.tone(520, 0.08, { type: 'sine', vol: 0.1 })
    this.tone(390, 0.12, { type: 'sine', vol: 0.1, at: (this.ctx?.currentTime ?? 0) + 0.08 })
  }

  click() {
    this.tone(880, 0.05, { type: 'square', vol: 0.06, cutoff: 3000 })
  }
}

export const audio = new AudioEngine()
