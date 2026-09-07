// Порт tweb `src/helpers/array/findAndSpliceAll.ts` — 1:1.
//
// Как `findAndSplice`, но вынимает ВСЕ подходящие элементы и отдаёт их массивом.
// Первый потребитель — `AppSearchSuper.load` (tweb `:2554`): у чата из списка
// вкладок на загрузку выбрасываются «общие группы».
export default function findAndSpliceAll<T>(array: T[], verify: (value: T, index: number, arr: T[]) => boolean) {
  const out: T[] = []
  let idx = -1
  while((idx = array.findIndex(verify)) !== -1) {
    out.push(array.splice(idx, 1)[0])
  }

  return out
}
