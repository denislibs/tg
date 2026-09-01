// ── ПИН ЗАДАЧИ #121: дата в строке списка чатов следует за языком ────────────
//
// Дефект, который эти пины закрывают, был двойным и оба раза НЕВИДИМЫМ для
// сборки и тайпчека:
//
//  1. подпись форматировала ПРОЕКЦИЯ (`core/dialogToChat.ts::fmtWhen` →
//     `toLocaleDateString([], …)`), то есть в локали БРАУЗЕРА и один раз
//     навсегда. Английский интерфейс показывал «30 авг.»;
//  2. в разметке стоял `<span className="i18n">` со строкой внутри. Класс есть,
//     узла в `I18n.weakMap` нет — `applyLangPack` (`lib/langPack.ts:568-572`,
//     порт tweb `langPack.ts:328-335`) обходит `.i18n`, зовёт
//     `weakMap.get(el)?.update()` и на поддельном узле молча ничего не делает.
//     Разметка выглядела локализованной, поведения за ней не стояло.
//
// Проверяется поэтому не текст сам по себе, а ПРИРОДА узла: тот же самый
// элемент (сверяется по ссылке) обязан переписать себя на смену языка. Если
// подпись вернуть строкой — хоть в проекцию, хоть в JSX — тест краснеет, потому
// что React отдаст НОВЫЙ узел со старым текстом.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import I18n from '@lib/langPack'
import { ManagersProvider } from '../core/hooks/useManagers'
import { applyLang } from '../test/lang'
import type { Chat } from '../data'
import ChatListItem from './ChatListItem'

// 14 июня 2026, 10:00 — «тот же год, но не эта неделя», ветка `month: 'short',
// day: 'numeric'`: самая наглядная для сверки языков («Jun 14» / «14 июн.»).
const DATE = new Date('2026-06-14T10:00:00Z')
const TS = Math.floor(DATE.getTime() / 1000)

const chat: Chat = {
  id: '1',
  name: 'Пир',
  avatar: '',
  preview: 'привет',
  type: 'private',
  date: TS,
}

// Строке нужны только менеджеры (`useManagers`); данные она берёт из пропа.
const managers = { peers: { fillMirror: async () => {} } } as never

function renderRow(over: Partial<Chat> = {}) {
  return render(
    <ManagersProvider managers={managers}>
      <ChatListItem chat={{ ...chat, ...over }} selected={false} onSelect={() => {}} />
    </ManagersProvider>,
  )
}

/** Узел подписи — `span.i18n` ВНУТРИ `span.message-time`, как в tweb
 *  (`appDialogsManager.ts:360-365` создаёт `.message-time`, :2242 кладёт в него
 *  узел `formatDateAccordingToTodayNew`). */
const label = () => document.querySelector<HTMLElement>('.message-time > .i18n')

beforeEach(async () => {
  await applyLang('en')
})

afterEach(async () => {
  cleanup()
  await applyLang('en')
})

describe('дата в строке списка чатов', () => {
  it('рисуется живым узлом ядра, а не строкой: он записан в `I18n.weakMap`', () => {
    renderRow()

    const el = label()
    expect(el).not.toBeNull()
    // Ровно то, чего не хватало поддельному `<span className="i18n">`: запись в
    // карте. Без неё `applyLangPack` пропускает узел молча.
    expect(I18n.weakMap.get(el!)).toBeInstanceOf(I18n.IntlDateElement)
  })

  it('следует за языком: ТОТ ЖЕ узел переписывает себя, React его не пересобирает', async () => {
    renderRow()

    const el = label()!
    expect(el.textContent).toBe('Jun 14')

    await act(async () => { await applyLang('ru') })

    // Ссылка та же — значит подпись обновило ЯДРО (обход `.i18n` в
    // `applyLangPack`), а не перерисовка React с новым `IntlDateElement`.
    expect(label()).toBe(el)
    expect(el.textContent).toBe('14 июн.')
  })

  it('без последнего сообщения и черновика подписи нет вовсе (tweb :2064)', () => {
    renderRow({ date: undefined })

    expect(label()).toBeNull()
    expect(document.querySelector('.message-time')).not.toBeNull()
  })
})
