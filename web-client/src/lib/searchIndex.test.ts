// Пины порта tweb `src/lib/searchIndex.ts` — ровно те случаи, которые
// покрывают опции потребителей оригинала (`SEARCH_OPTIONS`,
// `appUsersManager.ts:35-40`, и `dialogs.ts:341-348` — набор один и тот же):
// начало слова, несколько слов, регистр, транслитерация, раскладка, тег.
import { describe, expect, it } from 'vitest'
import SearchIndex from './searchIndex'

const OPTIONS = { clearBadChars: true, ignoreCase: true, latinize: true, includeTag: true }

const indexOf = (entries: [number, string][]) => {
  const index = new SearchIndex<number>(OPTIONS)
  for (const [id, text] of entries) index.indexObject(id, text)
  return index
}

describe('SearchIndex', () => {
  it('находит по началу любого слова, но не с середины слова', () => {
    const index = indexOf([[1, 'John Smith'], [2, 'Bob Johnson']])
    expect([...index.search('jo')]).toEqual([1, 2])
    expect([...index.search('smi')]).toEqual([1])
    expect([...index.search('ohn')]).toEqual([])
  })

  it('несколько слов: каждое обязано найтись в начале какого-то слова, порядок не важен', () => {
    const index = indexOf([[1, 'John Smith'], [2, 'John Doe']])
    expect([...index.search('smi jo')]).toEqual([1])
    expect([...index.search('jo xx')]).toEqual([])
  })

  it('регистр и спецсимволы запроса не влияют', () => {
    const index = indexOf([[1, 'John Smith']])
    expect([...index.search('JOHN')]).toEqual([1])
    expect([...index.search('@john!')]).toEqual([1])
  })

  it('транслитерация в обе стороны: диакритика и кириллица сводятся к латинице', () => {
    const index = indexOf([[1, 'Денис'], [2, 'José']])
    expect([...index.search('denis')]).toEqual([1])
    expect([...index.search('Дени')]).toEqual([1])
    expect([...index.search('jose')]).toEqual([2])
  })

  it('запрос в «не той» раскладке находит латинское имя', () => {
    const index = indexOf([[1, 'Search Bot']])
    // «ыуфкср» — «search» на русской раскладке
    expect([...index.search('ыуфкср')]).toEqual([1])
  })

  it('тег «%…» фильтрует по виду пира (getPeerSearchText кладёт %pu/%pg)', () => {
    const index = indexOf([[1, '%pu John'], [-2, '%pg John Fans']])
    expect([...index.search('%pg jo')]).toEqual([-2])
    expect([...index.search('jo')].sort((a, b) => a - b)).toEqual([-2, 1])
  })

  it('сортировка: меньше «недобранных» символов — выше, затем короче', () => {
    const index = indexOf([[1, 'Alexander Great'], [2, 'Alex'], [3, 'Alexandra']])
    expect([...index.search('alex')]).toEqual([2, 3, 1])
  })

  it('пустой текст снимает объект с индекса (tweb popContact / dropDialog)', () => {
    const index = indexOf([[1, 'John']])
    index.indexObject(1, '')
    expect([...index.search('john')]).toEqual([])
  })

  it('повторная индексация перезаписывает текст объекта', () => {
    const index = indexOf([[1, 'John']])
    index.indexObject(1, 'Mike')
    expect([...index.search('john')]).toEqual([])
    expect([...index.search('mike')]).toEqual([1])
  })

  it('indexObjectArray склеивает части пробелом', () => {
    const index = new SearchIndex<number>(OPTIONS)
    index.indexObjectArray(1, ['John', 'Smith'])
    expect([...index.search('smith')]).toEqual([1])
  })
})
