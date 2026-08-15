// Ревью L3, Important 3: `StickersSearchTab.lazy.test.tsx` мокает StickerMedia
// целиком, поэтому не может поймать мутацию «убрать loadQueue={queue} у
// StickerMedia» — потолок ПРЕВЬЮ исчезает, а тот файл этого не заметит. Здесь
// StickerMedia НЕ мокаем — нужен настоящий `loadStickerContent`, чтобы
// поймать потолок на уровне самого fetch (обвязка мока — как в
// StickerMedia.test.tsx). Task 2 covered sets: превью (covers) едут вместе с
// самой выдачей (featuredSets), не отдельным setBySlug на набор.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// Все строки видимы сразу — тот же мок, что в .lazy.test.tsx: здесь важна
// только связь «видимость → очередь превью», а не сам IntersectionObserver.
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
const makeSticker = (setN: number, i: number) => ({
  id: setN * 100 + i, setId: setN, mediaId: setN * 1000 + i, emoji: '🦆',
  width: 512, height: 512, mime: 'image/webp', thumb: '',
})

/** setCount наборов по perSet превью каждый; covers приезжают сразу (одним
 * пакетом с самой выдачей, Task 2), без отдельного запроса на набор. */
function makeManagers(setCount: number, perSet: number) {
  const prefix = `qset_r${++runSeq}_`
  const makeSet = (n: number) => ({ id: n, slug: `${prefix}${n}`, title: `Set ${n}`, kind: 'sticker' as const, count: perSet })
  const sets = Array.from({ length: setCount }, (_, i) => makeSet(i + 1))
  const covers = new Map(sets.map((s) => [s.id, Array.from({ length: perSet }, (_, i) => makeSticker(s.id, i))]))
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue({ sets, covers }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, prefix }
}

describe('StickersSearchTab — очередь реально ограничивает превью-загрузки (Task 3, ревью L3 Important 3)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('пик одновременных fetch превью не больше 8, даже когда файлов сразу 20', async () => {
    // 4 набора × 5 превью = 20 файлов, все строки видимы сразу
    const { managers, prefix } = makeManagers(4, 5)
    currentVisible = new Set(Array.from({ length: 4 }, (_, i) => `${prefix}${i + 1}`))

    let inFlight = 0
    let peak = 0
    const fetchMock = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 4))
      inFlight--
      return {
        ok: true,
        headers: { get: () => 'image/webp' },
        blob: async () => new Blob(['x'], { type: 'image/webp' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    // мутация «убрать loadQueue={queue}» дала бы 20 сразу — эта проверка
    // никогда не стала бы true без потолка (waitFor уйдёт в свой таймаут)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(20), { timeout: 5000 })
    expect(peak).toBeLessThanOrEqual(8)
    // не деградировало в полностью последовательную загрузку — очередь
    // реально держит НЕСКОЛЬКО файлов одновременно, просто с потолком
    expect(peak).toBeGreaterThan(1)
  })
})
