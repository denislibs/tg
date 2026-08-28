// Порт tweb `helpers/callbackifyAll.ts` — 1:1; правки только под формат
// `.oxlintrc.json` (без `;`).
//
// Тот же смысл, что у `callbackify`, но на наборе значений: если НИ ОДНО не
// промис — коллбэк зовётся синхронно и вызывающий получает результат в том же
// тике. На этом держится `DotRendererCore.compileShaders()`: тексты шейдеров
// кэшируются после первой загрузки, и вторая симуляция компилируется синхронно.
export default function callbackifyAll<T extends readonly unknown[] | [], R>(
  values: T,
  callback: (result: { -readonly [P in keyof T]: Awaited<T[P]> }) => R,
): Promise<Awaited<R>> | R {
  if (values.some((value) => value instanceof Promise)) {
    return Promise.all(values).then(callback as never) as Promise<Awaited<R>>
  } else {
    return callback(values as never)
  }
}
