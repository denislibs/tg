// Порт tweb `src/helpers/array/accumulate.ts` 1:1.
export default function accumulate(arr: number[], initialValue: number) {
  return arr.reduce((acc, value) => acc + value, initialValue)
}
