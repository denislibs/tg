import { beforeEach, describe, expect, it } from 'vitest'
import { useSearchStore } from './searchStore'

// Порт tweb `Chat.initSearch` (chat.ts:1312) + `searchSignal(undefined)` (:792).
// Затравка (`seed`) — это сигналы chat.ts:763-765, из которых панель засевает своё
// состояние (topbarSearch.tsx:403-407). Ключевая тонкость: сигналы созданы с
// `{equals: false}`, поэтому повтор с тем же значением обязан будить эффект — у нас
// за это отвечает `nonce`.
const CHAT = 42

describe('searchStore: initSearch / closeSearch', () => {
  beforeEach(() => useSearchStore.setState({ byChat: {} }))

  const seedOf = (chatId: number) => useSearchStore.getState().byChat[chatId]?.seed

  it('открывает поиск пустым, когда параметров нет', () => {
    useSearchStore.getState().initSearch(CHAT)
    const st = useSearchStore.getState().byChat[CHAT]
    expect(st.open).toBe(true)
    expect(st.seed.query).toBe('')
    expect(st.seed.filterPeerId).toBeUndefined()
    expect(st.seed.reaction).toBeUndefined()
  })

  it('открывает поиск предзаполненным (query / filterPeerId / reaction)', () => {
    useSearchStore.getState().initSearch(CHAT, { query: '#tag ' })
    expect(seedOf(CHAT)).toMatchObject({ query: '#tag ' })

    useSearchStore.getState().initSearch(CHAT, { filterPeerId: 7 })
    expect(seedOf(CHAT)).toMatchObject({ filterPeerId: 7, query: '' })

    useSearchStore.getState().initSearch(CHAT, { reaction: '👍' })
    expect(seedOf(CHAT)).toMatchObject({ reaction: '👍' })
  })

  it('не переданные поля обнуляются, а не залипают от прошлого открытия', () => {
    useSearchStore.getState().initSearch(CHAT, { query: 'abc', filterPeerId: 7, reaction: '👍' })
    useSearchStore.getState().initSearch(CHAT)
    expect(seedOf(CHAT)).toMatchObject({ query: '', filterPeerId: undefined, reaction: undefined })
  })

  it('повтор с тем же значением всё равно двигает nonce (tweb {equals:false})', () => {
    useSearchStore.getState().initSearch(CHAT, { filterPeerId: 7 })
    const first = seedOf(CHAT).nonce
    useSearchStore.getState().initSearch(CHAT, { filterPeerId: 7 })
    expect(seedOf(CHAT).nonce).toBe(first + 1)
  })

  it('closeSearch гасит open и reactionsShown', () => {
    useSearchStore.getState().initSearch(CHAT)
    useSearchStore.getState().setReactionsShown(CHAT, true)
    useSearchStore.getState().closeSearch(CHAT)
    const st = useSearchStore.getState().byChat[CHAT]
    expect(st.open).toBe(false)
    expect(st.reactionsShown).toBe(false)
  })

  it('closeSearch НЕ трогает затравку: панель ещё доигрывает анимацию ухода', () => {
    useSearchStore.getState().initSearch(CHAT, { query: 'abc' })
    const before = seedOf(CHAT)
    useSearchStore.getState().closeSearch(CHAT)
    // та же ссылка — эффект-засев в живой панели не должен перезапуститься
    expect(seedOf(CHAT)).toBe(before)
  })

  it('setReactionsShown сохраняет ссылку на затравку (не будит эффект-засев)', () => {
    useSearchStore.getState().initSearch(CHAT, { query: 'abc' })
    const before = seedOf(CHAT)
    useSearchStore.getState().setReactionsShown(CHAT, true)
    expect(seedOf(CHAT)).toBe(before)
  })

  it('состояние поиска у чатов независимое', () => {
    useSearchStore.getState().initSearch(CHAT, { query: 'abc' })
    useSearchStore.getState().initSearch(99, { query: 'xyz' })
    expect(seedOf(CHAT).query).toBe('abc')
    expect(seedOf(99).query).toBe('xyz')
    useSearchStore.getState().closeSearch(99)
    expect(useSearchStore.getState().byChat[CHAT].open).toBe(true)
  })
})
