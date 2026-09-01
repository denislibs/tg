// ── ПИН: хост чужого узла переживает ПОВТОРНЫЙ прогон эффекта ────────────────
//
// Дефект, ради которого пин заведён. `DocumentFragment` — РАСХОДУЕМЫЙ
// контейнер: вставка переносит его детей в хост и оставляет фрагмент пустым.
// `replaceChildren(node)` поэтому работает ровно один раз, а второй прогон
// эффекта вставляет пустоту и СТИРАЕТ уже показанную подпись. В dev эффекты
// зовутся дважды (`React.StrictMode`, `main.tsx:33`), и шесть экранов, где дату
// собирает `formatFullSentTime` (он отдаёт фрагмент), рисовали пустое место:
// `ChannelStats`, `ScheduledView`, `SuggestedPostsView`, `GiftInfoPopup`,
// `InviteLinkScreens`, `StoryViewer`. Прод-сборка молчала — там `StrictMode`
// no-op.
//
// ── Почему прежние пины задачи #121 этого не увидели ─────────────────────────
// Оба промаха структурные, и закрываются они здесь оба:
//  1. пин смотрел на `ChatListItem`, а его подпись — УЗЕЛ-ЭЛЕМЕНТ
//     (`IntlDateElement`), который расходуемым не бывает. Класс дефекта живёт
//     у ФРАГМЕНТОВ, и ни один пин фрагмент не рендерил;
//  2. тесты рендерили без `StrictMode`, то есть в единственном режиме, где
//     эффект зовётся один раз, — а продукт живёт в dev именно с двойным.
//
// Поэтому здесь: (а) хост проверяется с ФРАГМЕНТОМ, (б) под `StrictMode`,
// (в) отдельно — на честном ПОВТОРНОМ монтировании того же узла, чтобы пин не
// зависел от того, останется ли `StrictMode` в `main.tsx`, и (г) через все три
// обёртки дат разом — это и есть те шесть экранов.
import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import I18n from '@lib/langPack'
import { formatFullSentTime } from '@helpers/date'
import '../../test/lang'

import DomNode from './DomNode'
import { DayDate, SentTime, Time } from './dateNodes'

/** 14 июня 2026, 10:00 UTC — «тот же год, не эта неделя». */
const TS = Math.floor(Date.parse('2026-06-14T10:00:00Z') / 1000)

afterEach(cleanup)

describe('DomNode с фрагментом', () => {
  it('под StrictMode (эффект дважды) подпись на месте, а не стёрта', () => {
    const node = formatFullSentTime(TS)
    // Фрагмент несёт несколько детей: дата, пробел, «в», пробел, время.
    expect(node.childNodes.length).toBeGreaterThan(1)

    const { container } = render(
      <StrictMode>
        <DomNode node={node} className="host" />
      </StrictMode>,
    )

    const host = container.querySelector('.host')!
    expect(host.textContent).not.toBe('')
    expect(host.querySelectorAll('.i18n').length).toBeGreaterThan(1)
  })

  it('повторное монтирование ТОГО ЖЕ узла его не теряет', () => {
    const node = formatFullSentTime(TS)

    const first = render(<DomNode node={node} className="host" />)
    const text = first.container.querySelector('.host')!.textContent
    expect(text).not.toBe('')
    first.unmount()

    // Фрагмент к этому моменту уже опустошён вставкой — и это ровно та
    // ситуация, в которой наивный `replaceChildren(node)` рисует пустоту.
    expect(node.childNodes.length).toBe(0)

    const second = render(<DomNode node={node} className="host" />)
    expect(second.container.querySelector('.host')!.textContent).toBe(text)
  })

  it('узлы фрагмента остаются ЖИВЫМИ: запись в `I18n.weakMap` не потеряна', () => {
    const node = formatFullSentTime(TS)
    const { container } = render(
      <StrictMode>
        <DomNode node={node} className="host" />
      </StrictMode>,
    )

    const parts = Array.from(container.querySelectorAll<HTMLElement>('.host > .i18n'))
    expect(parts.length).toBeGreaterThan(1)
    // Живой узел — тот, что ядро найдёт обходом `.i18n` и сможет обновить.
    for (const part of parts) expect(I18n.weakMap.get(part)).toBeDefined()
  })
})

// Три обёртки — это и есть все виды подписи, которыми пользуются экраны.
// `SentTime` отдаёт фрагмент, `Time`/`DayDate` — элемент; под StrictMode обязаны
// работать одинаково, иначе дефект вернётся ровно тем же способом.
describe('обёртки дат под StrictMode', () => {
  const cases = [
    ['SentTime', <SentTime key="s" timestamp={TS} />],
    ['Time', <Time key="t" timestamp={TS} />],
    ['DayDate', <DayDate key="d" date={TS} />],
  ] as const

  for (const [name, element] of cases) {
    it(`${name} рисует непустую подпись`, () => {
      const { container } = render(<StrictMode>{element}</StrictMode>)
      expect(container.textContent).not.toBe('')
      expect(container.querySelector('.i18n')).not.toBeNull()
    })
  }
})
