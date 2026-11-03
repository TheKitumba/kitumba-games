// Every gameplay tuning value in one place. Units: metres, seconds, m/s, m/s², radians.

export const GAMEPLAY_CONFIG = {
  pitch: {
    width: 52,
    length: 80,
    goalWidth: 7.6,
    goalDepth: 2,
    crossbar: 2.44,
    boxWidth: 30,
    boxDepth: 13,
    sixWidth: 14,
    sixDepth: 4.6,
    penaltySpot: 9,
    circleRadius: 7,
  },

  player: {
    radius: 0.45,
    run: 6.4,
    sprint: 8.6,
    /** Top speed multiplier with the ball at your feet */
    dribble: 0.9,
    /** How fast velocity closes the gap to the target velocity, per second */
    accel: 9,
    brake: 14,
    /** Used instead of accel when the new direction is more than ~70° off the current one */
    turn: 11,
    /** Turn rate of the facing, rad/s, without / with the ball */
    faceRate: 12,
    faceRateBall: 9,
    /** Run cycle radians per metre travelled: ~1.45 m per step at full stride */
    stride: 2.2,
  },

  stamina: {
    /** Per second while sprinting, and recovery per second otherwise */
    drain: 0.16,
    recover: 0.07,
    /** Below this the sprint fades back toward running speed */
    tired: 0.25,
  },

  ball: {
    radius: 0.16,
    /** Visual scale so it reads at broadcast distance */
    drawScale: 1.35,
    gravity: 9.8,
    /** Exponential speed decay per second, on the grass and in the air */
    rollFriction: 0.85,
    airDrag: 0.08,
    /** Vertical bounce: speed kept, and the impact speed below which it stops bouncing */
    restitution: 0.45,
    minBounce: 1.5,
  },

  control: {
    /** Distance at which a loose ball can be brought under control */
    radius: 0.8,
    /** Passes up to this speed are always controlled by their receiver */
    cleanSpeed: 14,
    /** A non-target player controls a ball faster than this only by chance */
    hotSpeed: 12,
    hotChance: 0.4,
    /** Possession can't change hands again within this long */
    lockout: 0.35,
    /** Ball offset ahead of the feet: base, extra at full sprint, stride nudge */
    touchBase: 0.08,
    touchSprint: 0.42,
    touchNudge: 0.2,
    /** Seconds a buffered pass/shoot press stays valid */
    inputBuffer: 0.18,
  },

  pass: {
    /** Speed the ground pass should still have on arrival */
    arrive: 4.5,
    throughArrive: 2.5,
    minSpeed: 7,
    maxSpeed: 28,
    /** Passes longer than this go in the air automatically */
    loftDistance: 26,
    /** Max angle off the stick (cos) for a teammate to be picked */
    cone: 0.6,
    throughLead: 7,
    throughMax: 22,
    cooldown: 0.3,
  },

  shot: {
    /** Seconds of holding for full power */
    charge: 0.85,
    /** Power = charge ^ curve: the bar fills quickly then slows near the top */
    curve: 0.8,
    /** Sweet spot of the bar: least spray */
    sweetMin: 0.55,
    sweetMax: 0.8,
    minSpeed: 18,
    maxSpeed: 32,
    /** Base angular error (rad) and what adds to it */
    error: 0.012,
    errorPerPower: 0.05,
    errorPerMetre: 0.0016,
    errorOverpower: 0.08,
    errorPressure: 0.04,
    errorRunning: 0.03,
    errorBody: 0.05,
    errorWeakFoot: 0.025,
  },

  tackle: {
    reach: 1.15,
    cooldown: 0.75,
    /** Success chance per attempt: you, your AI teammates; CPU is in `ai` */
    human: 0.5,
    mate: 0.3,
    fromBehind: 0.5,
    slideTime: 0.55,
    slideSpeed: 9.5,
    getUp: 0.45,
    victimDown: 0.9,
  },

  switching: {
    /** Auto-switch only if someone is this much closer, and not more often than this */
    hysteresis: 4,
    interval: 0.6,
    /** Holding pass longer than this while defending = contain the dribbler */
    containHold: 0.2,
    containGap: 1.7,
  },

  ai: {
    /** CPU per division: values at division 1, step per division, cap */
    pace: [0.95, 0.01, 1],
    tackle: [0.2, 0.045, 0.52],
    passError: [0.11, -0.015, 0.025],
    shotError: [1.4, -0.1, 0.75],
    /** Seconds between owner decisions, plus a random extra */
    think: 0.2,
    thinkJitter: 0.25,
    /** Second presser from this division on */
    coverFrom: 3,
  },

  keeper: {
    diveTime: 0.6,
    diveSpeed: 7.5,
    reach: 0.8,
    diveReach: 1.3,
    /** Seconds before a keeper reacts to a shot: home, CPU at division 1, CPU step, CPU best */
    reaction: [0.12, 0.26, -0.02, 0.12],
    save: [0.72, 0.42, 0.07, 0.88],
    holdTime: 1.1,
  },

  match: {
    /** Real seconds per match; shown as 90 minutes */
    time: 180,
    kickoffFreeze: 1.4,
    goalPause: 2.6,
    /** Fixed simulation step, and max steps per frame after a hitch */
    step: 1 / 120,
    maxSteps: 12,
  },

  camera: {
    height: 12.5,
    back: 14,
    lookAhead: 3.5,
    follow: 2.6,
    /** Share of the frame pulled toward the player you control */
    controlledPull: 0.3,
    /** Near the opponent's box the camera drops and closes in a bit */
    attackZoom: 0.85,
    fov: 46,
  },

  quality: {
    maxDpr: 2,
    mobileDpr: 1.5,
    /** Average frame time (ms) above which quality steps down */
    slowFrame: 24,
  },
} as const

/** Interpolates an [at division 1, step, cap] triple for a division */
export const byLevel = ([base, step, cap]: readonly [number, number, number], level: number) => {
  const v = base + step * (level - 1)
  return step >= 0 ? Math.min(cap, v) : Math.max(cap, v)
}
