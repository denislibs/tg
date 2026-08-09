// BezierEasing — порт tweb `vendor/bezierEasing.ts` (https://github.com/gre/bezier-easing,
// Gaëtan Renaudeau, MIT). Нужен воркеру: анимация раскрытия спойлера считается
// там же, где рисуется, и должна идти по тем же кривым, что у tweb
// (`helpers/easings.ts`).
//
// отступление от tweb: var → const/let и типы под strict, алгоритм не тронут.

const NEWTON_ITERATIONS = 4
const NEWTON_MIN_SLOPE = 0.001
const SUBDIVISION_PRECISION = 0.0000001
const SUBDIVISION_MAX_ITERATIONS = 10

const kSplineTableSize = 11
const kSampleStepSize = 1.0 / (kSplineTableSize - 1.0)

export type EasingFunction = (input: number) => number

const A = (aA1: number, aA2: number) => 1.0 - 3.0 * aA2 + 3.0 * aA1
const B = (aA1: number, aA2: number) => 3.0 * aA2 - 6.0 * aA1
const C = (aA1: number) => 3.0 * aA1

/** x(t) по t, x1, x2 (или y(t) по t, y1, y2). */
const calcBezier = (aT: number, aA1: number, aA2: number) =>
  ((A(aA1, aA2) * aT + B(aA1, aA2)) * aT + C(aA1)) * aT

/** dx/dt по t, x1, x2 (или dy/dt по t, y1, y2). */
const getSlope = (aT: number, aA1: number, aA2: number) =>
  3.0 * A(aA1, aA2) * aT * aT + 2.0 * B(aA1, aA2) * aT + C(aA1)

function binarySubdivide(aX: number, aA: number, aB: number, mX1: number, mX2: number) {
  let currentX = 0
  let currentT = 0
  let i = 0
  do {
    currentT = aA + (aB - aA) / 2.0
    currentX = calcBezier(currentT, mX1, mX2) - aX
    if (currentX > 0.0) aB = currentT
    else aA = currentT
  } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS)
  return currentT
}

function newtonRaphsonIterate(aX: number, aGuessT: number, mX1: number, mX2: number) {
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const currentSlope = getSlope(aGuessT, mX1, mX2)
    if (currentSlope === 0.0) return aGuessT
    aGuessT -= (calcBezier(aGuessT, mX1, mX2) - aX) / currentSlope
  }
  return aGuessT
}

export default function BezierEasing(
  mX1: number,
  mY1: number,
  mX2: number,
  mY2: number,
): EasingFunction {
  if (!(mX1 >= 0 && mX1 <= 1 && mX2 >= 0 && mX2 <= 1)) {
    throw new Error('bezier x values must be in [0, 1] range')
  }
  if (mX1 === mY1 && mX2 === mY2) return (x: number) => x

  const sampleValues = new Float32Array(kSplineTableSize)
  for (let i = 0; i < kSplineTableSize; ++i) {
    sampleValues[i] = calcBezier(i * kSampleStepSize, mX1, mX2)
  }

  const getTForX = (aX: number) => {
    let intervalStart = 0.0
    let currentSample = 1
    const lastSample = kSplineTableSize - 1

    for (; currentSample !== lastSample && sampleValues[currentSample] <= aX; ++currentSample) {
      intervalStart += kSampleStepSize
    }
    --currentSample

    const dist =
      (aX - sampleValues[currentSample]) /
      (sampleValues[currentSample + 1] - sampleValues[currentSample])
    const guessForT = intervalStart + dist * kSampleStepSize

    const initialSlope = getSlope(guessForT, mX1, mX2)
    if (initialSlope >= NEWTON_MIN_SLOPE) return newtonRaphsonIterate(aX, guessForT, mX1, mX2)
    if (initialSlope === 0.0) return guessForT
    return binarySubdivide(aX, intervalStart, intervalStart + kSampleStepSize, mX1, mX2)
  }

  return (x: number) => (x === 0 || x === 1 ? x : calcBezier(getTForX(x), mY1, mY2))
}

// tweb helpers/easings.ts
export const defaultEasing = BezierEasing(0.42, 0.0, 0.58, 1.0)
export const unwrapEasing = BezierEasing(0.45, 0.37, 0.29, 1)
