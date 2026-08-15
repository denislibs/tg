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

const makeSet = (n: number) => ({ id: n, slug: `set_${n}`, title: `Set ${n}`, kind: 'sticker' as const, count: 5 })
const makeSticker = (id: number) => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers() {
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue(Array.from({ length: 10 }, (_, i) => makeSet(i + 1))),
    searchSets: vi.fn().mockResolvedValue([]),
    setBySlug: vi.fn((slug: string) =>
      Promise.resolve({ set: makeSet(Number(slug.slice('set_'.length))), stickers: [1, 2].map(makeSticker) }),
    ),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns }
}

describe('StickersSearchTab — ленивость запроса состава набора (Task 3)', () => {
  afterEach(cleanup)

  it('setBySlug зовётся только для видимых строк; появление новой строки во вьюпорте порождает новый запрос', async () => {
    currentVisible = new Set(['set_1', 'set_2'])
    const { managers, fns } = makeManagers()
    const { rerender } = render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    // ровно 2 видимые строки — 2 запроса, не 10
    await waitFor(() => {
      expect(fns.setBySlug).toHaveBeenCalledWith('set_1')
      expect(fns.setBySlug).toHaveBeenCalledWith('set_2')
    })
    expect(fns.setBySlug).toHaveBeenCalledTimes(2)
    expect(fns.setBySlug).not.toHaveBeenCalledWith('set_3')

    // третья строка «появилась» во вьюпорте (скролл) — её собственный запрос,
    // остальные семь по-прежнему не тронуты
    currentVisible = new Set(['set_1', 'set_2', 'set_3'])
    rerender(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(fns.setBySlug).toHaveBeenCalledWith('set_3'))
    expect(fns.setBySlug).toHaveBeenCalledTimes(3)
  })
})
