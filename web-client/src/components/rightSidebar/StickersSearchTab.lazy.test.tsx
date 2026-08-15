// Регрессия Task 3: строка набора запрашивала состав (setBySlug) на маунте
// БЕЗУСЛОВНО — выдача из десятков наборов залпом била по бэку столько же раз,
// хотя во вьюпорте видно 3-4 строки. Теперь запрос уходит только для строк,
// попавших в множество `visible` (useLazyVisibility, тот же механизм, что
// уже гейтит сетку StickerSetModal). Мокаем сам хук, а не IntersectionObserver:
// здесь важна связь «видимость → сетевой запрос», а не работа наблюдателя
// (её проверяют StickersSearchTab.test.tsx/.placeholders.test.tsx и
// useLazyVisibility через соседние витрины).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// Управляемое извне множество видимых ключей строк (ключ строки — set.slug,
// см. `rowRef` в StickersSearchTab.tsx). Меняется тестом между рендерами;
// `rerender()` заново вызывает useLazyVisibility и подхватывает новое значение.
let currentVisible = new Set<string>()
vi.mock('../useLazyVisibility', () => ({
  useLazyVisibility: () => ({ visible: currentVisible, register: () => {} }),
}))

// Файл стикера в тестах не грузим — превью пинится по обёртке ячейки, сам
// StickerMedia покрыт своим StickerMedia.test.tsx.
vi.mock('../StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

// setStickersCache в StickersSearchTab.tsx — модульный, по slug, и живёт
// между тестами ЭТОГО файла (не сбрасывается). Каждый вызов makeManagers*
// работает со СВОИМ префиксом слага — иначе второй тест, использующий
// «set_1», получил бы закэшированный с первого теста результат мимо
// свежего мока setBySlug (и, главное, мимо очереди — искажая именно то,
// что эти тесты проверяют).
let runSeq = 0
const makeSticker = (id: number) => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers(setCount = 10) {
  const prefix = `set_r${++runSeq}_`
  const makeSet = (n: number) => ({ id: n, slug: `${prefix}${n}`, title: `Set ${n}`, kind: 'sticker' as const, count: 5 })
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue(Array.from({ length: setCount }, (_, i) => makeSet(i + 1))),
    searchSets: vi.fn().mockResolvedValue([]),
    setBySlug: vi.fn((slug: string) =>
      Promise.resolve({ set: makeSet(Number(slug.slice(prefix.length))), stickers: [1, 2].map(makeSticker) }),
    ),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns, prefix }
}

/** setBySlug, который висит, пока тест сам не разрешит конкретный вызов (по индексу). */
function makeManagersWithControlledSetBySlug(setCount: number) {
  const prefix = `set_r${++runSeq}_`
  const makeSet = (n: number) => ({ id: n, slug: `${prefix}${n}`, title: `Set ${n}`, kind: 'sticker' as const, count: 5 })
  const resolvers: Array<() => void> = []
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue(Array.from({ length: setCount }, (_, i) => makeSet(i + 1))),
    searchSets: vi.fn().mockResolvedValue([]),
    setBySlug: vi.fn((slug: string) => new Promise((resolve) => {
      resolvers.push(() => resolve({ set: makeSet(Number(slug.slice(prefix.length))), stickers: [1, 2].map(makeSticker) }))
    })),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns, resolvers, prefix }
}

describe('StickersSearchTab — ленивость запроса состава набора (Task 3)', () => {
  afterEach(cleanup)

  it('setBySlug зовётся только для видимых строк; появление новой строки во вьюпорте порождает новый запрос', async () => {
    const { managers, fns, prefix } = makeManagers()
    currentVisible = new Set([`${prefix}1`, `${prefix}2`])
    const { rerender } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    // ровно 2 видимые строки — 2 запроса, не 10
    await waitFor(() => {
      expect(fns.setBySlug).toHaveBeenCalledWith(`${prefix}1`)
      expect(fns.setBySlug).toHaveBeenCalledWith(`${prefix}2`)
    })
    expect(fns.setBySlug).toHaveBeenCalledTimes(2)
    expect(fns.setBySlug).not.toHaveBeenCalledWith(`${prefix}3`)

    // третья строка «появилась» во вьюпорте (скролл) — её собственный запрос,
    // остальные семь по-прежнему не тронуты
    currentVisible = new Set([`${prefix}1`, `${prefix}2`, `${prefix}3`])
    rerender(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledWith(`${prefix}3`))
    expect(fns.setBySlug).toHaveBeenCalledTimes(3)
  })

  // Ревью L3, Important 3 + Important 1: пин на то, что setBySlug реально
  // идёт через `queue.push` (StickersSearchTab.tsx), а не зовётся напрямую —
  // мутация «убрать queue.push вокруг setBySlug» красит именно этот тест
  // (без очереди все 20 видимых строк дёрнули бы setBySlug сразу, и
  // `toHaveBeenCalledTimes(8)` никогда не стал бы true — waitFor уйдёт в
  // собственный таймаут).
  it('очередь держит не больше 8 одновременных setBySlug, даже когда видимы сразу 20 строк', async () => {
    const { managers, fns, resolvers, prefix } = makeManagersWithControlledSetBySlug(20)
    currentVisible = new Set(Array.from({ length: 20 }, (_, i) => `${prefix}${i + 1}`))
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    // ровно PARALLEL_LIMIT=8 запросов ушло сразу, остальные 12 ждут в очереди
    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledTimes(8))
    expect(resolvers).toHaveLength(8)

    // освобождаем все занятые слоты разом — очередь должна забрать следующую
    // партию из хвоста (а не остановиться на восьми навсегда)
    resolvers.splice(0).forEach((r) => r())
    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledTimes(16))

    resolvers.splice(0).forEach((r) => r())
    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledTimes(20))
  })

  // Ревью L3, Critical + Important 3: пин на то, что `queue.clear()` реально
  // вызывается при закрытии экрана (StickersSearchTab.tsx, useEffect на
  // unmount) И реально снимает ещё не начатые задачи (core/lazyLoadQueue.ts).
  // Любая из трёх мутаций — «убрать вызов queue.clear() на unmount»,
  // «опустошить тело clear()», «вернуть push без реджекта снятых» — красит
  // этот тест: без них хвостовые 12 запросов рано или поздно всё равно
  // ушли бы в сеть уже ЗАКРЫТОЙ панели, и totalCalls перевалил бы за 8.
  it('закрытие экрана снимает ещё не начатые запросы состава — они не уходят в сеть после unmount', async () => {
    const { managers, fns, resolvers, prefix } = makeManagersWithControlledSetBySlug(20)
    currentVisible = new Set(Array.from({ length: 20 }, (_, i) => `${prefix}${i + 1}`))
    const { unmount } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledTimes(8))

    unmount() // экран закрыт — оставшиеся 12 в очереди ещё не начинали грузить

    // «доигрываем» восемь уже стартовавших запросов — без queue.clear() это
    // освободило бы слоты и очередь забрала бы хвостовые задачи из закрытой
    // уже панели
    resolvers.splice(0).forEach((r) => r())
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()
    await Promise.resolve()

    expect(fns.setBySlug).toHaveBeenCalledTimes(8) // так и не выросло — хвост снят clear()
  })
})
