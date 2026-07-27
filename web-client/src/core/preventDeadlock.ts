// Обходной путь под edge-case баг Chrome (порт из tweb
// src/helpers/preventDeadlock.ts). Сценарий:
//   1. Открыто несколько вкладок, но ни одна сразу не сфокусирована.
//   2. Фокусируем одну из них.
//   3. Тут же перезагружаем эту вкладку.
// В этот момент ВСЕ вкладки могут навсегда зависнуть: не сфокусированная вкладка
// стартует динамический import() модуля ещё до того, как её сфокусировали, что
// приводит к кросс-табовому deadlock загрузки модулей.
//
// Ожидание одного requestAnimationFrame (в tweb — fastRafPromise) откладывает
// последующие dynamic import на следующий кадр анимации — фактически до момента,
// когда пользователь сфокусирует вкладку, — и залипания не происходит.
export function preventCrossTabDynamicImportDeadlock(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return Promise.resolve()
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
