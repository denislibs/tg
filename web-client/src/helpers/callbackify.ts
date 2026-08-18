// Порт tweb `helpers/callbackify.ts` — 1:1; правки только под формат
// `.oxlintrc.json` (без `;`).
//
// Смысл: значение может быть готовым либо промисом. Если готово — коллбэк
// зовётся СИНХРОННО, и вызывающий получает результат в том же тике. Именно на
// этом держится `DotRendererCore.init()`: первый вызов ждёт загрузку шейдеров
// (промис), а все следующие берут их из кэша и инициализируются синхронно.
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
