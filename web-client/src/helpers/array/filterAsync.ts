// Порт tweb `helpers/array/filterAsync.ts` — 1:1.
//
// Асинхронный `Array.prototype.filter`: предикаты запускаются ВСЕ СРАЗУ
// (`arr.map` → один `Promise.all`), а не по очереди. Именно на этом стоит
// `ChatContextMenu.filterButtons`: `verify()` пунктов ходят в сеть/RPC
// параллельно, иначе меню открывалось бы за сумму их задержек.
//
// Правка под строгий tsconfig (в tweb `strict` выключен): оригинал возвращает
// из `map` сам элемент либо `undefined` и отсеивает результат `.filter(Boolean)`
// — под strict это `(T | undefined)[]`, а вместе с тем и молчаливая потеря
// прошедшего фильтр falsy-элемента (`0`, `''`, `null`): «не прошёл» и «falsy»
// там кодируются одним значением. Здесь `Promise.all` собирает МАССИВ ОТВЕТОВ
// предиката, а отбор идёт по индексу — параллельность та же, тип честный,
// falsy-элемент не теряется.
export default async function filterAsync<T>(
  arr: T[],
  callback: (item: T, idx: number, arr: T[]) => Promise<boolean> | boolean,
): Promise<T[]> {
  const verdicts = await Promise.all(arr.map((item, idx, a) => callback(item, idx, a)))
  return arr.filter((_, idx) => verdicts[idx])
}
