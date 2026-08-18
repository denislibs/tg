// Порт tweb `helpers/callbackify.ts` — 1:1; правки только под формат
// `.oxlintrc.json` (без `;`).
//
// Смысл: значение может быть готовым либо промисом. Если готово — коллбэк
// зовётся СИНХРОННО, и вызывающий получает результат в том же тике. Именно на
// этом держится `DotRenderer.init()`: у нас шейдеры вкомпилены (`?raw`), init
// синхронен, и первый кадр рисуется до возврата управления.
export default function callbackify<T extends Awaited<unknown>, R>(
  smth: T,
  callback: (result: Awaited<T>) => R,
): T extends Promise<unknown> ? Promise<Awaited<R>> : R {
  if (smth instanceof Promise) {
    return smth.then(callback) as T extends Promise<unknown> ? Promise<Awaited<R>> : R
  } else {
    return callback(smth as Awaited<T>) as T extends Promise<unknown> ? Promise<Awaited<R>> : R
  }
}
