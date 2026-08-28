// Порт tweb `helpers/number/getUnsafeRandomInt.ts` — 1:1.
// «Unsafe» — не криптостойкий: используется там, где случайность нужна только
// визуально (сдвиг окна выборки тайла частиц у каждого спойлера свой, чтобы
// соседние спойлеры не выглядели одинаково).
export default function getUnsafeRandomInt(min: number, max: number) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min
}
