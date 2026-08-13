// Порт tweb `src/helpers/easings.ts:5-7` — лист-модуль (без импортов тяжёлых
// цепочек), чтобы им мог пользоваться и воркер.
// BezierEasing уже есть в этом репозитории (`lib/spoiler/bezierEasing.ts`,
// порт того же вендорного алгоритма) — переиспользуем, второй реализации не заводим.
import BezierEasing from '@lib/spoiler/bezierEasing'

export const simpleEasing = BezierEasing(0.25, 0.1, 0.25, 1)
