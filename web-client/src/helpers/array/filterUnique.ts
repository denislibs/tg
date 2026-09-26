// Порт tweb `src/helpers/array/filterUnique.ts` (812502980) — 1:1.
export default function filterUnique<T extends Array<unknown>>(arr: T): T {
  return [...new Set(arr)] as T
}
