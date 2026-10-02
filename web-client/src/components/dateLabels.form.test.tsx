// ── ПИН: ФОРМА подписей дат на экранах, которые задача #121 переписала ───────
//
// Перевод подписей со строк на живые узлы менял форму МОЛЧА — ни тайпчек, ни
// сборка формы не видят, а тестов на дату у этих экранов не было вовсе. Ревью
// нашло три таких потери, и каждая закрыта пином здесь (две сняты вместе с
// экранами: год в подписи React-«Passkeys» — задачей 21 плана 2D, Solid-вкладка
// зовёт `formatDate`, как оригинал, `passkeys.solid.test.tsx`; подпись
// `ScheduledView` — шагом К-3, отложенные ушли в бэклог Б-25):
//
//  • `GiftInfoPopup` — разделитель ` · ` печатался только при непустой дате,
//    после перевода стал безусловным, и `date === 0` («даты нет») дал бы
//    «· 1 янв. 1970»;
//
// Экраны рендерятся НАСТОЯЩИЕ; подменены только источники данных (RPC-менеджеры),
// потому что предмет проверки — подпись, а не загрузка.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../test/lang'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import type { AnyStarGift } from '../core/managers/starsManager'

import GiftInfoPopup from './stars/GiftInfoPopup'

/** «Сегодня» у всех тестов файла — 29 августа 2026, чтобы ветки «текущий год»
 *  и «сегодня/не сегодня» были воспроизводимы. */
const NOW = '2026-08-29T18:00:00'
/** 14 июня ТОГО ЖЕ года: без `overrideIntlOptions` год бы отсюда пропал. */
const THIS_YEAR = '2026-06-14T10:00:00Z'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const withManagers = (managers: unknown, ui: React.ReactNode) => render(
  <ManagersProvider managers={managers as Managers}>{ui}</ManagersProvider>,
)

describe('GiftInfoPopup — разделитель перед датой', () => {
  const gift: AnyStarGift = {
    _: 'savedStarGift',
    date: 0,
    gift: { _: 'starGift', id: 1, stars: 10, convert_stars: 5, title: 'Мишка', emoji: '🧸' },
  }
  const managers = { peers: { fillMirror: async () => {} } }

  it('даты нет (`date === 0`) — нет ни подписи, ни разделителя', () => {
    withManagers(managers, <GiftInfoPopup gift={gift} date={0} isOwner={false} onClose={() => {}} />)

    expect(document.body.textContent).not.toContain('·')
    expect(document.body.textContent).not.toContain('1970')
  })

  it('дата есть — она и разделитель на месте', () => {
    const date = Math.floor(Date.parse(THIS_YEAR) / 1000)
    withManagers(managers, <GiftInfoPopup gift={gift} date={date} isOwner={false} onClose={() => {}} />)

    expect(document.body.textContent).toContain('·')
    expect(document.body.textContent).toContain('Jun 14')
  })
})
