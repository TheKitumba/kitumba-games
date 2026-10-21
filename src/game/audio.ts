// Every sound is synthesized with the Web Audio API — no audio files needed.

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

// Am – F – C – G, bass roots relative to A4
const PROGRESSION = [-24, -28, -21, -26]
const ARP = [0, 3, 7, 12, 7, 3, 0, 7]

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private musicBus!: GainNode
  private noiseBuffer!: AudioBuffer
  private musicTimer: number | null = null
  private nextNoteTime = 0
  private step = 0

  muted = false
  bpm = 112

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

    // Music goes through a feedback delay for a spacey feel
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = 0.32
    const delay = ctx.createDelay()
    delay.delayTime.value = 0.27
    const feedback = ctx.createGain()
    feedback.gain.value = 0.3
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    this.musicBus.connect(this.master)
    this.musicBus.connect(delay)
    delay.connect(feedback).connect(delay)
    delay.connect(wet).connect(this.master)

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
      bus?: GainNode
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
    osc.connect(filter).connect(gain).connect(opts.bus ?? this.sfxBus)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private noise(dur: number, opts: { vol?: number; at?: number; hp?: number; bus?: GainNode } = {}) {
    const ctx = this.ensure()
    const t = opts.at ?? ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = opts.hp ?? 1000
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(opts.vol ?? 0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(gain).connect(opts.bus ?? this.sfxBus)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  turn() {
    this.tone(320, 0.04, { type: 'sine', vol: 0.06 })
  }

  eat(combo = 0) {
    const ctx = this.ensure()
    const t = ctx.currentTime
    const base = 660 * Math.pow(2, Math.min(combo, 12) / 24)
    this.tone(base, 0.09, { type: 'square', vol: 0.13, at: t, cutoff: 3500 })
    this.tone(base * 1.5, 0.12, { type: 'square', vol: 0.11, at: t + 0.05, cutoff: 3500 })
    this.tone(base * 2, 0.18, { type: 'sine', vol: 0.08, at: t + 0.05 })
  }

  bonus() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    ;[0, 4, 7, 12, 16].forEach((s, i) =>
      this.tone(NOTE(s + 3), 0.16, { type: 'triangle', vol: 0.16, at: t + i * 0.05 }),
    )
    this.noise(0.25, { vol: 0.05, hp: 6000, at: t })
  }

  bonusSpawn() {
    this.tone(1200, 0.25, { type: 'sine', vol: 0.07, slideTo: 2400 })
  }

  levelUp() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    ;[0, 3, 7, 10, 12, 15].forEach((s, i) =>
      this.tone(NOTE(s), 0.2, { type: 'sawtooth', vol: 0.09, at: t + i * 0.06, cutoff: 2600 }),
    )
  }

  start() {
    this.tone(110, 0.5, { type: 'sawtooth', vol: 0.14, slideTo: 880, cutoff: 3000 })
    this.noise(0.4, { vol: 0.06, hp: 3000 })
  }

  pause() {
    this.tone(520, 0.08, { type: 'sine', vol: 0.1 })
    this.tone(390, 0.12, { type: 'sine', vol: 0.1, at: (this.ctx?.currentTime ?? 0) + 0.08 })
  }

  die() {
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.tone(440, 0.8, { type: 'sawtooth', vol: 0.2, slideTo: 40, cutoff: 2200 })
    this.tone(220, 0.9, { type: 'square', vol: 0.12, slideTo: 30, at: t + 0.04, cutoff: 1200 })
    this.noise(0.6, { vol: 0.25, hp: 200 })
  }

  click() {
    this.tone(880, 0.05, { type: 'square', vol: 0.06, cutoff: 3000 })
  }

  // ---------- Music: a small look-ahead step sequencer ----------

  startMusic() {
    const ctx = this.ensure()
    if (this.musicTimer !== null) return
    this.nextNoteTime = ctx.currentTime + 0.06
    this.musicTimer = window.setInterval(() => this.schedule(), 25)
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer)
    this.musicTimer = null
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx) return
    const sixteenth = 60 / this.bpm / 4
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime)
      this.nextNoteTime += sixteenth
      this.step = (this.step + 1) % 64
    }
  }

  private playStep(step: number, at: number) {
    const bar = Math.floor(step / 16)
    const s = step % 16
    const root = PROGRESSION[bar]
    const bus = this.musicBus

    // Bass on 8ths with octave jumps
    if (s % 2 === 0) {
      const oct = s % 4 === 2 ? 12 : 0
      this.tone(NOTE(root + oct), 0.18, { type: 'sawtooth', vol: 0.22, at, bus, cutoff: 700 })
    }
    // Arp lead
    if (s % 2 === 1) {
      const n = ARP[(s >> 1) % ARP.length]
      this.tone(NOTE(root + 24 + n), 0.12, { type: 'square', vol: 0.06, at, bus, cutoff: 2400 })
    }
    // Kick
    if (s % 4 === 0) this.tone(140, 0.16, { type: 'sine', vol: 0.5, slideTo: 40, at, bus })
    // Hats
    if (s % 4 === 2) this.noise(0.05, { vol: 0.12, hp: 8000, at, bus })
    // Snare
    if (s === 4 || s === 12) this.noise(0.14, { vol: 0.16, hp: 1500, at, bus })
  }
}

export const audio = new AudioEngine()
