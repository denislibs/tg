// «N комментариев» проверяется через НАСТОЯЩЕЕ хранилище языка: форму числа теперь
// выбирает язык (`Intl.PluralRules` внутри `tArgs`), а не арифметика в этом файле —
// подставной `t` зеленел бы на любой ошибке выбора, потому что выбирать было бы нечему.
import { describe, it, expect, beforeEach } from 'vitest'

import { useI18nStore } from '../../i18n'
import { applyLang } from '@/test/lang'
import { commentsLabel } from './commentsLabel'

const label = (count: number) => {
  const { t, tArgs } = useI18nStore.getState()
  return commentsLabel(count, t, tArgs)
}

beforeEach(async () => {
  useI18nStore.setState({ lang: 'en' })
  await applyLang('en')
})

describe('commentsLabel', () => {
  it('ru: славянские формы 1 / 2-4 / 5+ и исключения 11/12', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await applyLang('ru')
    expect([0, 1, 2, 4, 5, 11, 15, 21, 22, 112].map(label)).toEqual([
      'Комментарии',
      '1 комментарий',
      '2 комментария',
      '4 комментария',
      '5 комментариев',
      '11 комментариев', // 11 — исключение, не «один»
      '15 комментариев',
      '21 комментарий',
      '22 комментария',
      '112 комментариев', // 12 — тоже исключение
    ])
  })

  it('en: единственное и множественное', () => {
    expect([0, 1, 5].map(label)).toEqual(['Comments', '1 Comment', '5 Comments'])
  })
})
