// ЗАДАЧА 7 — склейка с УЗЛОМ-АРГУМЕНТОМ.
//
// Пустая выдача поиска собиралась в JSX из половинок вокруг `<b>`: «There were no
// results for» + запрос + «. Try a new search.». Половинки НЕЛЬЗЯ перевести — в
// языках с другим порядком слов запрос стоит не там, а кавычки и точка у каждого
// языка свои. Строковый `t()` этого не чинит: он не умеет ни разметки, ни
// аргументов-узлов. У оригинала это одна строка, где жирным становится сам аргумент
// (`Search.Empty` = 'There were no results for "**%@**". Try a new search.',
// tweb lang.ts:652-653), и собирает её `i18n()` ядра.
//
// Проверяется ВЫДАЧА и на русском тоже: у русского перевода порядок слов и кавычки
// свои, и половинками он был бы собран неверно.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { loadLang, useI18nStore } from '@/i18n'
import { EmptyResults } from './TopbarSearch'

afterEach(cleanup)

beforeAll(async () => {
  useI18nStore.setState({ lang: 'en' })
  await loadLang('en')
})

const empty = () => document.querySelector('.topbar-search-left-results-empty')!

describe('пустая выдача поиска — одна строка словаря, аргумент внутри неё', () => {
  it('запрос: фраза целиком, запрос жирным ВНУТРИ неё', () => {
    render(<EmptyResults isHashtag={false} count={0} filterPeerId={null} filterPeerName={undefined} query="кабачок" />)

    expect(empty().textContent).toBe('There were no results for "кабачок". Try a new search.')
    // Жирным — именно аргумент, а не половина фразы (`**%@**` в строке словаря).
    expect(empty().querySelector('b')!.textContent).toBe('кабачок')
  })

  it('фильтр по отправителю: своя строка, имя жирным', () => {
    render(<EmptyResults isHashtag={false} count={0} filterPeerId={7} filterPeerName="Алиса" query="" />)

    expect(empty().textContent).toBe('There were no messages from Алиса.')
    expect(empty().querySelector('b')!.textContent).toBe('Алиса')
  })

  it('хэштег без счётчика: подсказка, а не «ничего не найдено»', () => {
    render(<EmptyResults isHashtag count={undefined} filterPeerId={null} filterPeerName={undefined} query="#tag" />)

    expect(empty().textContent).toContain('hashtag')
  })

  it('русский: порядок слов и кавычки — из СТРОКИ, а не из вёрстки', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    try {
      render(<EmptyResults isHashtag={false} count={0} filterPeerId={null} filterPeerName={undefined} query="кабачок" />)
      expect(empty().textContent).toBe('Ничего не найдено по запросу «кабачок». Попробуйте другой запрос.')

      cleanup()
      render(<EmptyResults isHashtag={false} count={0} filterPeerId={7} filterPeerName="Алиса" query="" />)
      expect(empty().textContent).toBe('Нет сообщений от Алиса.')
    } finally {
      useI18nStore.setState({ lang: 'en' })
      await loadLang('en')
    }
  })

  // Узел ядра ЖИВОЙ: смена языка перерисовывает уже показанную фразу на месте.
  it('смена языка перерисовывает уже показанную фразу', async () => {
    render(<EmptyResults isHashtag={false} count={0} filterPeerId={null} filterPeerName={undefined} query="кабачок" />)
    expect(empty().textContent).toBe('There were no results for "кабачок". Try a new search.')

    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    try {
      expect(empty().textContent).toBe('Ничего не найдено по запросу «кабачок». Попробуйте другой запрос.')
    } finally {
      useI18nStore.setState({ lang: 'en' })
      await loadLang('en')
    }
  })
})
