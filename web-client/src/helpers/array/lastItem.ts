// Порт tweb `src/helpers/array/lastItem.ts` (812502980) 1:1.
export default function lastItem<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1]
}
