// chatStickyDates — проводка Chat.tsx поверх StickyIntersector, вынесенная в
// отдельный модуль именно затем, чтобы её можно было покрыть тестами: Chat
// нигде не рендерится в vitest, так что логика внутри его useEffect иначе не
// ловится вообще никаким тестом.
import { describe, it, expect, vi } from 'vitest'
import { isDateGroupSection, observeNewSections, pickStickyDateKey } from './chatStickyDates'
import StickyIntersector from './stickyIntersector'

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

function makeSection(dateKey: string) {
  const section = document.createElement('section')
  section.className = 'bubbles-date-group'
  const pill = document.createElement('div')
  pill.className = 'bubble service is-date'
  pill.dataset.date = dateKey
  section.append(pill)
  return section
}

describe('isDateGroupSection', () => {
  it('узнаёт только секции дня, не сообщения/прочие узлы', () => {
    expect(isDateGroupSection(makeSection('day-1'))).toBe(true)
    expect(isDateGroupSection(document.createElement('div'))).toBe(false)
  })
})

describe('pickStickyDateKey', () => {
  it('без застрявших секций — null', () => {
    const a = makeSection('day-1')
    expect(pickStickyDateKey([a], new Set())).toBeNull()
  })

  it('одна застрявшая секция — её дата', () => {
    const a = makeSection('day-1')
    expect(pickStickyDateKey([a], new Set([a]))).toBe('day-1')
  })

  it('несколько застрявших — берёт последнюю в переданном (document) порядке', () => {
    const a = makeSection('day-1')
    const b = makeSection('day-2')
    const c = makeSection('day-3')
    // застряли первая и третья (день "day-2" ещё не дошёл до верха) —
    // "нижней" считается последняя в порядке обхода, day-3
    expect(pickStickyDateKey([a, b, c], new Set([a, c]))).toBe('day-3')
  })

  it('не-date-group узлы среди секций игнорируются', () => {
    const a = makeSection('day-1')
    const stray = document.createElement('div')
    stray.className = 'bubbles-group'
    expect(pickStickyDateKey([a, stray], new Set([a, stray as unknown as HTMLElement]))).toBe('day-1')
  })
})

describe('observeNewSections', () => {
  it('наблюдает каждую секцию РОВНО один раз — повторные вызовы не плодят sentinel-узлы', () => {
    // Ревью Critical 2: без обвязки повторный `observeStickyHeaderChanges` на
    // той же секции добавляет новый `.sticky_sentinel` при каждом вызове
    // (у StickyIntersector, как и в tweb, `observe` не идемпотентен —
    // `addSentinel` всегда делает `appendChild`). В Chat.tsx это воспроизвелось
    // бы как накопление мёртвых узлов на каждое входящее сообщение
    // (useEffect с зависимостью на feedMsgs/padTopPx/padBottomPx).
    const container = document.createElement('div')
    const section = makeSection('day-1')
    container.append(section)

    const intersector = new StickyIntersector(container, vi.fn())
    const observed = new Set<HTMLElement>()

    // Имитация 5 повторных срабатываний useEffect (пять «входящих сообщений»)
    // над ОДНОЙ и той же секцией — as if the day section already existed.
    for (let i = 0; i < 5; i++) {
      observeNewSections(container, intersector, observed)
    }

    expect(section.querySelectorAll('.sticky_sentinel').length).toBe(1)
    expect(observed.size).toBe(1)
  })

  it('новая секция, появившаяся после первого прохода, наблюдается — без пропусков', () => {
    const container = document.createElement('div')
    const first = makeSection('day-1')
    container.append(first)

    const intersector = new StickyIntersector(container, vi.fn())
    const observed = new Set<HTMLElement>()
    observeNewSections(container, intersector, observed)
    expect(observed.size).toBe(1)

    const second = makeSection('day-2')
    container.append(second)
    observeNewSections(container, intersector, observed)

    expect(observed.size).toBe(2)
    expect(first.querySelectorAll('.sticky_sentinel').length).toBe(1)
    expect(second.querySelectorAll('.sticky_sentinel').length).toBe(1)
  })

  it('игнорирует детей, не являющихся `.bubbles-date-group` (группы сообщений и т.п.)', () => {
    const container = document.createElement('div')
    const group = document.createElement('div')
    group.className = 'bubbles-group'
    container.append(group)

    const observeStickyHeaderChanges = vi.fn()
    observeNewSections(container, { observeStickyHeaderChanges }, new Set())

    expect(observeStickyHeaderChanges).not.toHaveBeenCalled()
  })
})
