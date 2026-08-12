// Порт tweb `src/helpers/array/forEachReverse.ts` — 1:1 (обход с конца:
// splice по ходу не сбивает индексы); правки только под формат
// `.oxlintrc.json` (без `;`). Локальная копия в `animationIntersector.ts`
// предшествует этому файлу — сведение на общий хелпер вне периметра задачи.
export default function forEachReverse<T>(array: Array<T>, callback: (value: T, index?: number, array?: Array<T>) => void) {
  for (let length = array.length, i = length - 1; i >= 0; --i) {
    callback(array[i], i, array)
  }
}
