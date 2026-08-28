// Task 2 covered sets поменяла источник превью строки: раньше состав набора
// (и тем самым — данные для ячеек) грузился отдельным setBySlug строго для
// ВИДИМЫХ строк (регрессия Task 3 — залповый setBySlug по всем строкам сразу
// клал бы бэк). Теперь covers приезжают ОДНИМ пакетом со всей выдачей — они
// есть у ВСЕХ строк сразу, видимых и нет. Но лениво по видимости обязана
// оставаться загрузка самих ФАЙЛОВ превью (.tgs/.webm/картинка) — иначе выдача
// из десятков наборов на маунте залпом бьёт fetch по каждому превью, хотя во
// вьюпорте видно 3-4 строки. Этот файл теперь пинит именно это: `visible`
// гейтит монтирование `StickerMedia` (см. StickersSearchTab.tsx), а тем самым —
// и вызов `loadStickerContent`/`fetch` внутри неё. Мокаем сам хук
// `useLazyVisibility`, а не IntersectionObserver: здесь важна связь
// «видимость строки → загрузка файла», а не работа наблюдателя (её проверяют
// StickersSearchTab.test.tsx/.placeholders.test.tsx и useLazyVisibility через
// соседние витрины). StickerMedia НЕ мокаем — нужен настоящий
// `loadStickerContent`, чтобы поймать факт (не)вызова fetch на уровне самого
// сетевого запроса, а не мока компонента.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Sticker } from '../../core/managers/stickersManager'
import { makeSticker as makeStickerDoc, makeStickerSet } from '../../core/stickers/testSticker'

const noop = () => {}

// Управляемое извне множество видимых ключей строк (ключ строки — set.slug,
// см. `rowRef` в StickersSearchTab.tsx). Меняется тестом между рендерами;
// `rerender()` заново вызывает useLazyVisibility и подхватывает новое значение.
let currentVisible = new Set<string>()
vi.mock('../useLazyVisibility', () => ({
  useLazyVisibility: () => ({ visible: currentVisible, register: () => {} }),
}))

vi.mock('../../lib/lottie/lottieLoader', () => ({
  default: {
    loadAnimationWorker: vi.fn(async () => ({
      canvas: [document.createElement('canvas')],
      onFirstFrame: vi.fn(),
      onComplete: vi.fn(),
      restart: vi.fn(),
      remove: vi.fn(),
    })),
  },
}))
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/api/media/${id}/content`,
  primeMediaToken: () => Promise.resolve(),
}))

let runSeq = 0
// mediaId несёт префикс прогона (runId) — StickerMedia кэширует загрузку по
// mediaId МОДУЛЬНЫМ кэшем (не сбрасывается между тестами этого файла), и
// пересекающиеся id между тестами тихо возвращали бы уже закэшированный с
// прошлого теста промис МИМО очереди — тест перестал бы вообще что-то мерить.
const makeSticker = (runId: number, setN: number, i: number): Sticker =>
  makeStickerDoc({ id: runId * 1_000_000 + setN * 1000 + i, setId: setN, emoji: '🦆' })

/** setCount наборов по perSet превью каждый; covers приезжают сразу для ВСЕХ
 * (в одном пакете с выдачей — Task 2), независимо от видимости строки. */
function makeManagers(setCount: number, perSet: number) {
  const runId = ++runSeq
  const prefix = `lset_r${runId}_`
  const makeSet = (n: number) => makeStickerSet({ id: n, shortName: `${prefix}${n}`, title: `Set ${n}`, count: perSet })
  const sets = Array.from({ length: setCount }, (_, i) => makeSet(i + 1))
  const covers = new Map(sets.map((s) => [s.id, Array.from({ length: perSet }, (_, i) => makeSticker(runId, s.id, i))]))
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue({ sets, covers }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns, prefix, runId }
}

/** fetch, который висит, пока тест сам не разрешит конкретный вызов (по индексу) — как
 * makeManagersWithControlledSetBySlug раньше, только теперь уровень ниже: сам fetch файла. */
function stubControlledFetch() {
  const resolvers: Array<() => void> = []
  const fetchMock = vi.fn(() => new Promise((resolve) => {
    resolvers.push(() => resolve({
      ok: true,
      headers: { get: () => 'image/webp' },
      blob: async () => new Blob(['x'], { type: 'image/webp' }),
    }))
  }))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, resolvers }
}

describe('StickersSearchTab — ленивость загрузки ФАЙЛОВ превью по видимости строки (Task 2)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('fetch файла уходит только для видимых строк; появление новой строки во вьюпорте порождает новую загрузку', async () => {
    const { managers, fns, prefix, runId } = makeManagers(10, 1)
    const mediaUrl = (setN: number) => `/api/media/${runId * 1_000_000 + setN * 1000}/content`
    const { fetchMock } = stubControlledFetch()
    currentVisible = new Set([`${prefix}1`, `${prefix}2`])
    const { rerender } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    // ровно 2 видимые строки (по 1 превью каждая) — 2 fetch'а, не 10: covers
    // на все 10 наборов уже есть в тот же момент, но файлы качают только видимые.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledWith(mediaUrl(1))
    expect(fetchMock).toHaveBeenCalledWith(mediaUrl(2))
    expect(fetchMock).not.toHaveBeenCalledWith(mediaUrl(3))

    // третья строка «появилась» во вьюпорте (скролл) — её собственная загрузка,
    // остальные семь по-прежнему не тронуты
    currentVisible = new Set([`${prefix}1`, `${prefix}2`, `${prefix}3`])
    rerender(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(mediaUrl(3)))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // Ревью C2, Important: `visible` из useLazyVisibility гаснет, как только
  // строка уходит из вьюпорта (useLazyVisibility.ts удаляет ключ на
  // `!isIntersecting`) — гейтить МОНТИРОВАНИЕ StickerMedia сырым `visible`
  // означало бы размонтировать её на каждом уходе строки из вида: убивался бы
  // lottie-плеер, из DOM пропадали бы canvas/SVG-силуэт/thumb, а при
  // возврате — новый маунт и (не будь кэша StickerMedia по mediaId) новая
  // загрузка. StickersSearchTab.tsx гейтит монтирование латчем `everVisible`
  // (once true — навсегда), а не `visible` — эта строка ловит именно это:
  // после однократного попадания во вьюпорт превью остаётся в DOM (тот же
  // узел, не пересозданный) и уход/возврат строки не порождает повторный fetch.
  it('переход «видима → ушла из вида» не размонтирует превью: узел StickerMedia не пересоздаётся, файл не грузится повторно', async () => {
    const { managers, fns, prefix } = makeManagers(1, 1)
    const { fetchMock } = stubControlledFetch()
    currentVisible = new Set([`${prefix}1`])
    const { rerender } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const cell = document.querySelector('[data-sticker-set="1"] [data-testid="sticker-set-cell"]')!
    // StickerMedia рендерит один div (её собственный boxRef) синхронно на
    // маунте, независимо от того, догрузился ли файл, — устойчивый маркер
    // «эта же React-нода жива», в отличие от содержимого файла (образ/canvas),
    // которое зависит от decode()/lottie-мока и не переживает мутацию надёжно.
    const mediaRoot = await waitFor(() => {
      const el = cell.firstElementChild
      expect(el).not.toBeNull()
      return el!
    })

    // строка ушла из вьюпорта — однажды показанное превью не обязано исчезать
    currentVisible = new Set()
    rerender(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    expect(cell.firstElementChild).toBe(mediaRoot) // тот же узел — StickerMedia не размонтирована
    expect(fetchMock).toHaveBeenCalledTimes(1) // и повторной загрузки на уход из вида не случилось

    // строка вернулась во вьюпорт
    currentVisible = new Set([`${prefix}1`])
    rerender(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    expect(cell.firstElementChild).toBe(mediaRoot) // по-прежнему тот же узел — без цикла unmount/remount
    expect(fetchMock).toHaveBeenCalledTimes(1) // и без повторного fetch при возврате
  })

  // Ревью L3, Important 3 (перенесено с уровня setBySlug на уровень файла):
  // пин на то, что загрузка файла реально идёт через `queue.push`
  // (StickerMedia → loadStickerContent), а не напрямую — без очереди все 20
  // видимых строк дёрнули бы fetch сразу, и `toHaveBeenCalledTimes(8)`
  // никогда не стал бы true — waitFor уйдёт в собственный таймаут.
  it('очередь держит не больше 8 одновременных загрузок файла, даже когда видимы сразу 20 строк', async () => {
    const { managers, fns, prefix } = makeManagers(20, 1)
    const { fetchMock, resolvers } = stubControlledFetch()
    currentVisible = new Set(Array.from({ length: 20 }, (_, i) => `${prefix}${i + 1}`))
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    // ровно PARALLEL_LIMIT=8 fetch'ей ушло сразу, остальные 12 ждут в очереди
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8))
    expect(resolvers).toHaveLength(8)

    // освобождаем все занятые слоты разом — очередь должна забрать следующую
    // партию из хвоста (а не остановиться на восьми навсегда)
    resolvers.splice(0).forEach((r) => r())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(16))

    resolvers.splice(0).forEach((r) => r())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(20))
  })

  // Ревью L3, Critical + Important 3 (перенесено с уровня setBySlug на файл):
  // пин на то, что `queue.clear()` реально вызывается при закрытии экрана
  // (StickersSearchTab.tsx, useEffect на unmount) И реально снимает ещё не
  // начатые задачи (core/lazyLoadQueue.ts). Без этого хвостовые 12 запросов
  // рано или поздно всё равно ушли бы в сеть уже ЗАКРЫТОЙ панели.
  it('закрытие экрана снимает ещё не начатые загрузки файлов — они не уходят в сеть после unmount', async () => {
    const { managers, fns, prefix } = makeManagers(20, 1)
    const { fetchMock, resolvers } = stubControlledFetch()
    currentVisible = new Set(Array.from({ length: 20 }, (_, i) => `${prefix}${i + 1}`))
    const { unmount } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8))

    unmount() // экран закрыт — оставшиеся 12 в очереди ещё не начинали грузить

    // «доигрываем» восемь уже стартовавших загрузок — без queue.clear() это
    // освободило бы слоты и очередь забрала бы хвостовые задачи из закрытой
    // уже панели
    resolvers.splice(0).forEach((r) => r())
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(8) // так и не выросло — хвост снят clear()
  })
})
