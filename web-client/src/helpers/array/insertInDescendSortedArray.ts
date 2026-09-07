// Порт tweb `src/helpers/array/insertInDescendSortedArray.ts` — 1:1.
//
// Вставка элемента в массив, отсортированный ПО УБЫВАНИЮ числового свойства,
// с возвратом индекса. Если элемент уже в массиве и его соседи по-прежнему
// удовлетворяют порядку — остаётся на месте (это и есть «переставлять только
// когда надо», на чём стоит `SortedList.update`).
//
// Правки под строгий tsconfig (в tweb `strict` выключен): вместо перегрузок с
// `K extends keyof T` — один генерик, где свойство задаётся именем ключа или
// функцией; форма вызова у потребителей та же (`(array, element, 'index')`).
// `console.error('wtf')` оригинала на недостижимой ветке сохранён — это его
// способ сказать, что массив был не отсортирован.
export default function insertInDescendSortedArray<T>(
  array: T[],
  element: T,
  getProperty: keyof T | ((element: T) => number),
  pos?: number,
  cmp: (val1: number, val2: number) => number = (val1, val2) => val1 - val2,
): number {
  const get = typeof getProperty === 'function' ?
    getProperty :
    (item: T) => item[getProperty] as unknown as number

  const sortProperty = get(element)

  pos ??= array.indexOf(element)
  if(pos !== -1) {
    const prev = array[pos - 1]
    const next = array[pos + 1]
    if((!prev || cmp(get(prev), sortProperty) >= 0) && (!next || cmp(get(next), sortProperty) <= 0)) {
      return pos
    }

    array.splice(pos, 1)
  }

  const len = array.length
  if(!len || cmp(sortProperty, get(array[len - 1])) <= 0) {
    return array.push(element) - 1
  } else if(cmp(sortProperty, get(array[0])) >= 0) {
    array.unshift(element)
    return 0
  } else {
    for(let i = 0; i < len; i++) {
      if(cmp(sortProperty, get(array[i])) > 0) {
        array.splice(i, 0, element)
        return i
      }
    }
  }

  console.error('wtf', array, element)
  return array.indexOf(element)
}
