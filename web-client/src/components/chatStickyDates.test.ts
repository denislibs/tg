// chatStickyDates — проводка Chat.tsx поверх StickyIntersector, вынесенная в
// отдельный модуль именно затем, чтобы её можно было покрыть тестами: Chat
// нигде не рендерится в vitest, так что логика внутри его useEffect иначе не
// ловится вообще никаким тестом.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDateGroupSection, observeNewSections, pickStickyDateKey, pruneEvictedSections } from './chatStickyDates'
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

// Бэклог этапа 2.1, п.5: StickyIntersector.unobserve() был портирован и покрыт
// (stickyIntersector.test.ts) но нигде не вызывался — stickyObservedRef/
// stuckSectionsRef и оба observer'а внутри StickyIntersector удерживали
// выселенные секции бессрочно. Обоснование «путей удаления секций нет до
// виртуализации» опровергнуто: useMessageWindow.jumpTo/reloadNewest подменяют
// win.msgs ПОЛНОСТЬЮ (не merge), а ChatFeed рендерит секции по key={sec.key} —
// день, которого нет в новом окне, размонтируется React'ом тем же коммитом.
describe('pruneEvictedSections', () => {
  it('секция, удалённая из DOM, снимается с обоих observer\'ов (unobserve) и вычищается из observed/stuck', () => {
    const container = document.createElement('div')
    const a = makeSection('day-1')
    const b = makeSection('day-2')
    container.append(a, b)

    const intersector = new StickyIntersector(container, vi.fn())
    const unobserveSpy = vi.spyOn(intersector, 'unobserve')
    const observed = new Set<HTMLElement>()
    observeNewSections(container, intersector, observed)
    expect(observed.size).toBe(2)
    const stuck = new Set<HTMLElement>([a]) // 'a' была застрявшей на момент подмены

    // Полная подмена окна (jumpTo/reloadNewest) убрала день 'a' из ленты —
    // ChatFeed её больше не рендерит, React снимает узел из DOM.
    a.remove()

    pruneEvictedSections(container, intersector, observed, stuck)

    expect(unobserveSpy).toHaveBeenCalledExactlyOnceWith(a)
    expect(observed.has(a)).toBe(false)
    expect(observed.has(b)).toBe(true) // живая секция не тронута
    expect(stuck.has(a)).toBe(false)
  })

  it('секция, оставшаяся в DOM, не трогается', () => {
    const container = document.createElement('div')
    const a = makeSection('day-1')
    container.append(a)

    const intersector = new StickyIntersector(container, vi.fn())
    const unobserveSpy = vi.spyOn(intersector, 'unobserve')
    const observed = new Set<HTMLElement>([a])
    const stuck = new Set<HTMLElement>([a])

    pruneEvictedSections(container, intersector, observed, stuck)

    expect(unobserveSpy).not.toHaveBeenCalled()
    expect(observed.has(a)).toBe(true)
    expect(stuck.has(a)).toBe(true)
  })

  it('реестр не растёт после серии подмен окна (несколько jumpTo подряд)', () => {
    const container = document.createElement('div')
    const intersector = new StickyIntersector(container, vi.fn())
    const observed = new Set<HTMLElement>()
    const stuck = new Set<HTMLElement>()

    let current = makeSection('day-0')
    container.append(current)
    pruneEvictedSections(container, intersector, observed, stuck)
    observeNewSections(container, intersector, observed)
    expect(observed.size).toBe(1)

    // Имитация 10 подряд полных подмен окна — старая секция каждый раз уходит
    // из DOM, приходит ровно одна новая (та же схема, что и в проде: секции
    // размонтируются/монтируются одним React-коммитом на смену win.msgs).
    for (let i = 1; i <= 10; i++) {
      current.remove()
      current = makeSection(`day-${i}`)
      container.append(current)

      pruneEvictedSections(container, intersector, observed, stuck)
      observeNewSections(container, intersector, observed)

      // Без pruneEvictedSections observed рос бы на 1 каждую итерацию (11 к
      // концу цикла) — с ним старая секция вычищается тем же проходом, что
      // видит новую, реестр держит ровно живые секции.
      expect(observed.size).toBe(1)
    }
  })
})

// Тот же приём, что и для observeNewSections ниже: Chat нигде не рендерится в
// vitest, поэтому единственный способ поймать «вызов тихо снят из useEffect» —
// прочитать исходник текстом.
describe('Chat.tsx: выселенные секции реально снимаются (pruneEvictedSections подключена)', () => {
  it('useEffect на [contentRef, feedMsgs, feedLoading] реально зовёт pruneEvictedSections ДО observeNewSections', () => {
    const src = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
    const depsIdx = src.indexOf('[contentRef, feedMsgs, feedLoading]')
    expect(depsIdx).toBeGreaterThan(-1)
    const effectBody = src.slice(Math.max(0, depsIdx - 600), depsIdx)
    expect(effectBody).toMatch(
      /pruneEvictedSections\(\s*inner\s*,\s*intersector\s*,\s*stickyObservedRef\.current\s*,\s*stuckSectionsRef\.current\s*\)\s*[\s\S]*?observeNewSections\(/,
    )
  })
})

// Финальное ревью ветки (I-5): всё выше тестирует ЛОГИКУ observeNewSections как
// чистую функцию — это не ловит регрессию в её ПРОВОДКЕ внутри Chat.tsx. Chat
// нигде не рендерится в vitest (см. шапку chatStickyDates.ts — тяжёлое дерево
// зависимостей), поэтому единственный способ поймать «вызов тихо снят из
// useEffect» — прочитать исходник текстом, тем же приёмом, что
// core/scrollWriters.test.ts/stores/noManualOrder.test.ts. Ревьюер проверил
// мутацией: снятие строки `observeNewSections(inner, intersector,
// stickyObservedRef.current)` из Chat.tsx переживает и npm test, и typecheck
// (TS6133 «unused var» гасится одним `void`) — без этого пина такая регрессия
// молча ломает липкие даты в реальном приложении.
describe('Chat.tsx: наблюдение новых секций реально подключено', () => {
  it('useEffect на [contentRef, feedMsgs, feedLoading] реально зовёт observeNewSections', () => {
    const src = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
    const depsIdx = src.indexOf('[contentRef, feedMsgs, feedLoading]')
    // Deps-массив переименовали/убрали — почини тест осознанно, а не подгоняй.
    expect(depsIdx).toBeGreaterThan(-1)
    const effectBody = src.slice(Math.max(0, depsIdx - 400), depsIdx)
    expect(effectBody).toMatch(/observeNewSections\(\s*inner\s*,\s*intersector\s*,\s*stickyObservedRef\.current\s*\)/)
  })
})
