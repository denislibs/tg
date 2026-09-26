/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

// Порт tweb `src/lib/searchIndex.ts:1-124` — локальный полнотекстовый индекс
// имён. Живёт в воркере рядом с данными: индекс контактов —
// `core/managers/contactsManager.ts` (у tweb `appUsersManager.ts:52,509`),
// индекс диалогов — `core/managers/dialogsManager.ts` (у tweb
// `storages/dialogs.ts:84,342`). Поиск по имени не ходит в сеть и не
// фильтрует в главном потоке.
//
// Расхождения с оригиналом:
//  1. Закомментированные в оригинале ветки (`shortIndexes`, `totalChars`,
//     `badCharsRe` в проверке начала слова) не перенесены — это мёртвый код и
//     там.
//  2. Типы под наш strict (у tweb `strict` выключен): `minChars` после
//     конструктора — число, а не `number | undefined`.
import { processSearchText, type ProcessSearchTextOptions } from '@helpers/cleanSearchText'
import flatten from '@helpers/array/flatten'

type SearchIndexOptions = ProcessSearchTextOptions & {
  minChars?: number
  fullWords?: boolean
}

type FoundObject<SearchWhat> = { fullText: string; fullTextLength: number; what: SearchWhat; foundChars: number }

export default class SearchIndex<SearchWhat> {
  private fullTexts: Map<SearchWhat, string> = new Map()
  private minChars: number

  // minChars can be 0 because it requires at least one word (one symbol) to be found
  constructor(private options: SearchIndexOptions = {}) {
    this.minChars = options.minChars ?? 0
  }

  /** Пустой (после нормализации) текст снимает объект с индекса — так у
   *  оригинала выбрасываются контакт и диалог (`indexObject(id, '')`). */
  public indexObject(id: SearchWhat, searchText: string): boolean | void {
    if(searchText.trim()) {
      searchText = this.processSearchText(searchText)
    }

    if(!searchText) {
      this.fullTexts.delete(id)
      return false
    }

    this.fullTexts.set(id, searchText)
  }

  public indexObjectArray(id: SearchWhat, searchText: string[]): boolean | void {
    return this.indexObject(id, searchText.join(' '))
  }

  private _search(
    query: string,
    queryWords = query.split(' ').filter((word) => word.trim()),
    minChars = this.minChars,
  ): FoundObject<SearchWhat>[] {
    const newFoundObjs: FoundObject<SearchWhat>[] = []
    const fullTexts = this.fullTexts
    const queryWordsLength = queryWords.length
    fullTexts.forEach((fullText, what) => {
      let found = true
      let foundChars = 0
      for(let i = 0; i < queryWordsLength; ++i) { // * verify that all words are found
        const word = queryWords[i]
        const idx = fullText.indexOf(word)
        const isLastWord = i === (queryWordsLength - 1)
        if(
          idx === -1 || // * if not found at all
          (this.options.fullWords && !isLastWord && fullText[idx + word.length] !== ' ') || // * if not last word, then next char must be space
          (idx !== 0 && fullText[idx - 1] !== ' ') // * search only from word beginning
        ) {
          found = false
          break
        }

        foundChars += word.length
      }

      if(found) {
        foundChars += queryWordsLength - 1
        const fullTextLength = fullText.length
        if(minChars <= foundChars || fullTextLength <= foundChars) {
          newFoundObjs.push({ fullText, fullTextLength, what, foundChars })
        }
      }
    })

    return newFoundObjs
  }

  /** Найденные объекты в порядке «меньше недобранных символов — выше, затем
   *  короче». Запрос режется по `\x01` на две ветки (см. `processSearchText`). */
  public search(query: string, minChars?: number): Set<SearchWhat> {
    query = this.processSearchText(query)

    const queries = query.split('\x01')
    const results = queries.map((query) => this._search(query, undefined, minChars))
    const newFoundObjs = flatten(results)

    newFoundObjs.sort((a, b) => {
      const aLeftChars = a.fullTextLength - a.foundChars
      const bLeftChars = b.fullTextLength - b.foundChars
      return aLeftChars - bLeftChars || a.fullTextLength - b.fullTextLength
    })

    const newFoundObjs2: Set<SearchWhat> = new Set(newFoundObjs.map((o) => o.what))
    return newFoundObjs2
  }

  public processSearchText(query: string): string {
    return this.options ? processSearchText(query, this.options) : query
  }
}
