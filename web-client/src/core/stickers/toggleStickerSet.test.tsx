// Установка/удаление набора объявляется каналом rootScope (порт tweb
// 'stickers_installed'/'stickers_deleted'), и обе витрины наборов пересчитываются:
// строка экрана «Поиск стикеров» и панель стикеров пикера. До этого канала
// каждая витрина правила только своё локальное состояние — набор, добавленный в
// попапе, оставался «Add» в строке под ним и не появлялся в панели.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import rootScope from '@lib/rootScope'
import { toggleStickerSet } from './toggleStickerSet'
import { useStickersPanel } from '../hooks/useStickers'
import { ManagersProvider } from '../hooks/useManagers'
import StickersSearchTab from '../../components/rightSidebar/StickersSearchTab'
import type { Managers } from '../../client/bootstrap'
import type { StickerSet } from '../managers/stickersManager'
import { makeSticker, makeStickerSet } from './testSticker'

const duck: StickerSet = makeStickerSet({ id: 1, shortName: 'utyaduck', title: 'Duck', count: 2 })
const croco: StickerSet = makeStickerSet({ id: 2, shortName: 'mrcroco', title: 'Croco', count: 2 })
const stickersOf = (setId: number) => [1, 2].map((i) => makeSticker({ id: setId * 100 + i, setId }))

// happy-dom не реализует IntersectionObserver — нужен ленивой сетке попапа.
beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

// Файл стикера в тестах не грузим (fetch к media) — StickerMedia покрыт своим тестом.
vi.mock('../../components/StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

function makeManagers(mine: StickerSet[] = []) {
  const fns = {
    mySets: vi.fn().mockResolvedValue(mine),
    recent: vi.fn().mockResolvedValue([]),
    faved: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue({ sets: [duck], covers: new Map() }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    getStickerSet: vi.fn(async (input: { shortName?: string }) => {
      const set = input.shortName === duck.short_name ? duck : croco
      return { set, stickers: stickersOf(set.id) }
    }),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns }
}

describe('toggleStickerSet — объявление установки набора', () => {
  afterEach(cleanup)

  it('install/uninstall объявляются событиями rootScope с самим набором', async () => {
    const { fns } = makeManagers()
    const installed = vi.fn()
    const deleted = vi.fn()
    rootScope.addEventListener('stickers_installed', installed)
    rootScope.addEventListener('stickers_deleted', deleted)
    try {
      await expect(toggleStickerSet(fns, duck, false)).resolves.toBe(true)
      expect(fns.install).toHaveBeenCalledWith(1)
      expect(installed).toHaveBeenCalledWith(duck)

      await expect(toggleStickerSet(fns, duck, true)).resolves.toBe(false)
      expect(fns.uninstall).toHaveBeenCalledWith(1)
      expect(deleted).toHaveBeenCalledWith(duck)
    } finally {
      rootScope.removeEventListener('stickers_installed', installed)
      rootScope.removeEventListener('stickers_deleted', deleted)
    }
  })

  // Регрессия: набор добавляли в попапе (или в другой вкладке), а строка того
  // же набора на экране поиска продолжала показывать «Add».
  it('строка экрана поиска переключается на Added по объявлению, а не по своему же ответу', async () => {
    const { managers } = makeManagers()
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={() => {}} />
      </ManagersProvider>,
    )
    const button = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('button.sticker-set-button')
      expect(b).not.toBeNull()
      return b!
    })
    expect(button.textContent).toBe('Add')

    act(() => { rootScope.dispatchEvent('stickers_installed', duck) })
    await waitFor(() => expect(button.textContent).toBe('Added'))

    act(() => { rootScope.dispatchEvent('stickers_deleted', duck) })
    await waitFor(() => expect(button.textContent).toBe('Add'))
  })

  // Регрессия: панель грузит наборы ровно один раз (startedRef), поэтому без
  // подписки новый набор появлялся в ней только после перезагрузки страницы.
  it('панель стикеров подхватывает установленный набор и убирает удалённый', async () => {
    const { managers } = makeManagers([duck])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ManagersProvider managers={managers}>{children}</ManagersProvider>
    )
    const { result } = renderHook(() => useStickersPanel(true), { wrapper })

    await waitFor(() => expect(result.current.sets.map((x) => x.set.id)).toEqual([1]))

    await act(async () => { rootScope.dispatchEvent('stickers_installed', croco) })
    await waitFor(() => expect(result.current.sets.map((x) => x.set.id)).toEqual([1, 2]))

    act(() => { rootScope.dispatchEvent('stickers_deleted', duck) })
    await waitFor(() => expect(result.current.sets.map((x) => x.set.id)).toEqual([2]))
  })
})

describe('витрины наборов — сквозной путь из попапа', () => {
  afterEach(cleanup)

  it('добавление набора в попапе переключает строку того же набора на Added', async () => {
    const { managers, fns } = makeManagers()
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={() => {}} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(document.querySelector('.sticker-set')).not.toBeNull())

    // клик по строке (не по кнопке/превью) открывает попап набора
    fireEvent.click(document.querySelector('.sticker-set')!)
    const addInPopup = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('.popup-stickers .popup-footer-button')
      expect(b?.textContent).toMatch(/Добавить/)
      return b!
    })

    fireEvent.click(addInPopup)
    await waitFor(() => expect(fns.install).toHaveBeenCalledWith(1))

    // строка под попапом узнала об установке
    await waitFor(() =>
      expect(document.querySelector('button.sticker-set-button')!.textContent).toBe('Added'),
    )
  })
})
