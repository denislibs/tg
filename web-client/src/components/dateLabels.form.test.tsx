// ── ПИН: ФОРМА подписей дат на экранах, которые задача #121 переписала ───────
//
// Перевод подписей со строк на живые узлы менял форму МОЛЧА — ни тайпчек, ни
// сборка формы не видят, а тестов на дату у этих экранов не было вовсе. Ревью
// нашло три таких потери, и каждая закрыта пином здесь:
//
//  • `PremiumManage` и `Passkeys` — у `formatDate` оригинала год появляется
//    ТОЛЬКО у прошлых лет, а прежние подписи несли `year: 'numeric'` всегда.
//    «Подписка действует до 3 декабря» без года не отвечает на вопрос, ради
//    которого строку читают;
//  • `GiftInfoPopup` — разделитель ` · ` печатался только при непустой дате,
//    после перевода стал безусловным, и `date === 0` («даты нет») дал бы
//    «· 1 янв. 1970»;
//  • `ScheduledView` — подпись собиралась склейкой переведённого обрезка с
//    датой; приведена к оригиналу (`bubbles.ts::createDateBubble`), где дата
//    едет АРГУМЕНТОМ ключа.
//
// Экраны рендерятся НАСТОЯЩИЕ; подменены только источники данных (RPC-менеджеры),
// потому что предмет проверки — подпись, а не загрузка.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../test/lang'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import type { MyMessage } from '../core/models'
import type { AnyStarGift } from '../core/managers/starsManager'

import PremiumManage from './PremiumManage'
import Passkeys from './settings/Passkeys'
import GiftInfoPopup from './stars/GiftInfoPopup'
import { ScheduledLabel } from './ScheduledView'

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

describe('PremiumManage — дата окончания подписки', () => {
  const managers = (expiresAt: string) => ({
    premium: {
      getSubscription: async () => ({
        plan: 'monthly', priceCents: 499, startedAt: THIS_YEAR, expiresAt, autoRenew: true,
      }),
    },
  })

  it('несёт ГОД, даже когда он текущий', async () => {
    await act(async () => { withManagers(managers(THIS_YEAR), <PremiumManage onBack={() => {}} />) })

    // Без `ALWAYS_YEAR` здесь было бы «June 14» — формально верно, по смыслу нет.
    expect(screen.getByText('June 14, 2026')).toBeTruthy()
  })

  it('битую дату с провода показывает сырой, а не роняет экран', async () => {
    await act(async () => { withManagers(managers('не дата'), <PremiumManage onBack={() => {}} />) })

    expect(screen.getByText('не дата')).toBeTruthy()
  })
})

describe('Passkeys — дата создания/последнего использования', () => {
  const managers = (createdAt: string) => ({
    auth: { passkeysList: async () => [{ id: 1, name: 'ключ', createdAt, lastUsedAt: null }] },
  })

  it('несёт ГОД и сокращённый месяц', async () => {
    await act(async () => { withManagers(managers(THIS_YEAR), <Passkeys onBack={() => {}} />) })

    expect(document.body.textContent).toContain('Jun 14, 2026')
  })

  it('битую дату с провода показывает сырой, а не роняет экран', async () => {
    await act(async () => { withManagers(managers('не дата'), <Passkeys onBack={() => {}} />) })

    expect(document.body.textContent).toContain('не дата')
  })
})

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

describe('ScheduledView — подпись «Отправится …»', () => {
  const message = (over: Partial<Extract<MyMessage, { _: 'message' }>>) => ({
    _: 'message', id: 1, peerId: 1, date: 0, message: '', ...over,
  } as MyMessage)

  it('дата едет АРГУМЕНТОМ ключа, а не приклеена к переведённому обрезку', () => {
    const sendAt = Math.floor(Date.parse('2026-09-05T10:00:00Z') / 1000)
    const { container } = render(<ScheduledLabel message={message({ send_at: sendAt })} />)

    // Ключ оригинала — 'Scheduled for %@': подстановка стоит ВНУТРИ строки, и
    // её делает `superFormatter` ядра. Склейка «обрезок + дата» дала бы тот же
    // английский текст, поэтому проверяется и структура: дата — вложенный узел
    // ядра, а не соседний кусок текста.
    expect(container.textContent).toBe('Scheduled for September 5')
    expect(container.querySelector('.i18n .i18n')).not.toBeNull()
  })

  it('сегодня — отдельный ключ оригинала, без даты', () => {
    const sendAt = Math.floor(Date.parse(NOW).valueOf() / 1000) + 3600
    const { container } = render(<ScheduledLabel message={message({ send_at: sendAt })} />)

    expect(container.textContent).toBe('Scheduled for today')
  })

  it('«когда онлайн» — свой ключ вместо любой даты', () => {
    const { container } = render(<ScheduledLabel message={message({ when_online: true })} />)

    expect(container.textContent).toBe('Scheduled until online')
  })

  // Живой узел обновляет СЕБЯ САМ — пересобирать его нельзя (докблок `DomNode`).
  // Список отдаёт НОВЫЙ объект сообщения на каждое обновление, поэтому мемо по
  // объекту пересобирало бы узел там, где подпись не менялась; зависимости — два
  // числа. Тот же дефект чинился в `TopicsPanel`/`SharedMedia`.
  it('новый объект сообщения с той же датой узел НЕ пересобирает', () => {
    const sendAt = Math.floor(Date.parse('2026-09-05T10:00:00Z') / 1000)
    const { container, rerender } = render(<ScheduledLabel message={message({ send_at: sendAt })} />)

    const node = container.querySelector('.i18n')
    expect(node).not.toBeNull()

    // Другой объект, те же данные — ровно то, что приезжает из списка.
    rerender(<ScheduledLabel message={message({ send_at: sendAt })} />)
    expect(container.querySelector('.i18n')).toBe(node)

    // А вот смена САМОЙ даты узел обязана пересобрать.
    rerender(<ScheduledLabel message={message({ send_at: sendAt + 86400 })} />)
    expect(container.querySelector('.i18n')).not.toBe(node)
  })

  it('времени в подписи нет — у `formatDate(date, {today})` оригинала его нет', () => {
    const sendAt = Math.floor(Date.parse('2026-09-05T10:34:00Z') / 1000)
    const { container } = render(<ScheduledLabel message={message({ send_at: sendAt })} />)

    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })
})
