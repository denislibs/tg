// Порт tweb `src/helpers/easings.ts` — лист-модуль (без импортов тяжёлых
// цепочек), чтобы им мог пользоваться и воркер.
// BezierEasing уже есть в этом репозитории (`lib/spoiler/bezierEasing.ts`,
// порт того же вендорного алгоритма) — переиспользуем, второй реализации не заводим.
import BezierEasing from '@lib/spoiler/bezierEasing'

export const defaultEasing = BezierEasing(0.42, 0.0, 0.58, 1.0)
export const simpleEasing = BezierEasing(0.25, 0.1, 0.25, 1)
export const unwrapEasing = BezierEasing(0.45, 0.37, 0.29, 1)
