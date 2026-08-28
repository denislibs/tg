// Порт tweb `helpers/array/flatten.ts` — 1:1. Явный `<T[]>` на `reduce` —
// только под наш строгий tsconfig (в tweb `strict` выключен и пустой литерал
// выводится как `never[]`).
export default function flatten<T>(arr: T[][]): T[] {
  return arr.reduce<T[]>((acc, val) => (acc.push(...val), acc), [])
}
