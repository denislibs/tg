// Порт tweb `src/helpers/array/findAndSplice.ts`.
//
// Почему не `find` + отдельный `splice`: вызывающему нужны ОБА исхода одним
// действием — сам элемент И его изъятие из массива. Вкладка «Устройства»
// (`sidebarLeft/tabs/activeSessions.solid.tsx`) на этом стоит: текущая сессия
// вынимается из общего списка, а всё, что осталось в массиве после вызова, —
// это ровно «прочие сессии», без второго прохода фильтром.
//
// Единственное отличие от оригинала — тип возврата предиката: там объявлен
// `boolean`, но вызывающий передаёт флаг вида `true | undefined`
// (`auth.pFlags.current`), и это проходит только потому, что tweb собирается
// без `strictNullChecks`. У нас strict включён, поэтому объявлено то, чем
// предикат является на деле, — проверка на истинность (её и делает
// `Array.findIndex`). Иначе пришлось бы уродовать дословный вызов.
export default function findAndSplice<T>(array: Array<T>, verify: (value: T, index?: number, array?: Array<T>) => unknown) {
  const index = array.findIndex(verify)
  return index !== -1 ? array.splice(index, 1)[0] : undefined
}
