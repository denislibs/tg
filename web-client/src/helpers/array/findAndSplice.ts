// Порт tweb `src/helpers/array/findAndSplice.ts` — 1:1.
//
// Почему не `find` + отдельный `splice`: вызывающему нужны ОБА исхода одним
// действием — сам элемент И его изъятие из массива. Вкладка «Устройства»
// (`sidebarLeft/tabs/activeSessions.solid.tsx`) на этом стоит: текущая сессия
// вынимается из общего списка, а всё, что осталось в массиве после вызова, —
// это ровно «прочие сессии», без второго прохода фильтром.
export default function findAndSplice<T>(array: Array<T>, verify: (value: T, index?: number, array?: Array<T>) => boolean) {
  const index = array.findIndex(verify)
  return index !== -1 ? array.splice(index, 1)[0] : undefined
}
