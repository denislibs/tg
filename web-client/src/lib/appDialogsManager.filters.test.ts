// Пины реакции владельца папок на добавление/удаление/перестановку папок
// (`lib/appDialogsManager.ts`; у tweb — события `filter_update`/`filter_delete`/
// `filter_order`, `src/lib/appDialogsManager.ts:924-968`, и `addFilter` `:1249-1290`,
// `onFiltersLengthChange` `:1298-1322`), плюс логаут и свайп (`:617-634`).
//
// Поток «добавили/удалили/переставили» у нас один — проекция `folders.solid`
// поверх `appState.folders`; папки кладутся тем же путём, что пуш сервера
// (`applyFolderUpdate`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, expectActiveOnly, filterIds, finishTransition, frameOf, installFrames,
  filterIdOf, installListProbes, mountOwner, putFolders, raw, resetStores, settle, stubGeometry, uninstallFrames,
  type Mounted,
} from './appDialogsManager.testkit'
import { resetPeerMirror } from '@core/peerCache'
import { applyFolderUpdate, useFoldersStore } from '@stores/foldersStore'
import useFolders from '@stores/folders.solid'
import type { SwipeEvent, SwipeHandlerHorizontalOptions } from '@helpers/dom/handleHorizontalSwipe'
import type { ForumTab } from '@components/forumTab/forumTab'

// Тач-устройство: свайп между папками заводится только при нём (`:617`).
vi.mock('@environment/touchSupport', () => ({ default: true }))
// Распознаватель жеста — не предмет: ловим опции, с которыми владелец его завёл,
// и отдаём ему уже распознанный свайп (`handleTabSwipe` портирован 1:1 и
// проверен отдельно). Проверяем, КУДА владелец переключает.
const swipes: SwipeHandlerHorizontalOptions[] = []
const swipeRemoved = vi.fn()
vi.mock('@helpers/dom/handleTabSwipe', () => ({
  default: (options: SwipeHandlerHorizontalOptions) => {
    swipes.push(options)
    return { removeListeners: swipeRemoved }
  },
}))

let mounted: Mounted | undefined

const overlay = () => mounted!.host.querySelector('.chatlist-overlay')!
const rowHidden = () => overlay().querySelector('.folders-tabs-scrollable')!.classList.contains('hide')
const gradientHidden = () => overlay().querySelector('.folders-tabs-gradient-container')!.classList.contains('hide')

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной — её держит другой файл прогона').toBe(true)
  swipes.length = 0
  swipeRemoved.mockClear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('appDialogsManager: папки добавляются, удаляются, переставляются', () => {
  it('новая папка — новый кадр на позиции localId, ряд показан (filter_update → addFilter)', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(5, 3, 'Учёба'))
    mounted = mountOwner()
    await settle()
    const before = frameOf(mounted.folders, 3)

    putFolders(raw(4, 2, 'Шум'))
    await settle()

    expect(filterIds(mounted.folders)).toEqual(['0', '3', '4', '5'])
    // кадр создаётся один раз и живёт — соседей не пересоздали
    expect(frameOf(mounted.folders, 3)).toBe(before)
    expect(rowHidden()).toBe(false)
    expect(Array.from(mounted.manager.xds.keys()).sort((a, b) => a - b)).toEqual([0, 3, 4, 5])
  })

  it('переименование папки список не пересоздаёт (xds держит список на папку, tweb :1474)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    const before = mounted.manager.xds.get(3)

    putFolders(raw(3, 1, 'Работа и дом'))
    await settle()
    expect(mounted.manager.xds.get(3)).toBe(before)

    putFolders(raw(4, 2, 'Шум'))
    applyFolderUpdate({ folder_id: 3, deleted: true })
    await settle()

    expect(Array.from(mounted.manager.xds.keys()).sort((a, b) => a - b)).toEqual([0, 4])
  })

  it('удалённая неактивная папка — её кадр снят, Scrollable погашен, выбор не тронут (filter_delete)', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
    const probeOf = installListProbes()
    mounted = mountOwner()
    await settle()
    const list = mounted.manager.xds.get(4)!
    const destroy = vi.spyOn(list.scrollable, 'destroy')
    const probe = probeOf(list)
    probe.calls.clear = 0

    applyFolderUpdate({ folder_id: 4, deleted: true })
    await settle()

    expect(filterIds(mounted.folders)).toEqual(['0', '3'])
    expect(list.scrollable.container.isConnected).toBe(false)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(probe.calls.clear).toBe(1)
    expectActiveOnly(mounted.folders, 0)
    expect(mounted.manager.xds.has(4)).toBe(false)
  })

  it('удалённая АКТИВНАЯ папка — активной стала «Все чаты» через selectTab(0), выбор в сторе сброшен', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
    mounted = mountOwner()
    await settle()
    useFolders().onClick()!(2)
    await settle()
    finishTransition(mounted.folders)
    expect(useFoldersStore.getState().selectedId).toBe(4)

    applyFolderUpdate({ folder_id: 4, deleted: true })
    await settle()

    expectActiveOnly(mounted.folders, 0)
    expect(useFoldersStore.getState().selectedId).toBe(0)
    expect(filterIdOf(mounted.manager.xd!)).toBe(0)
    // Уходящего кадра уже нет в DOM — слайдеру не от чего ехать, переключение
    // мгновенное (`transition.ts`: `prevId === -1` → без анимации). У tweb так
    // же: контейнер снимает `filter_delete` раньше, чем `selectTab` доходит до
    // слайдера (шапка владельца, расхождение 6).
    expect(mounted.folders.classList.contains('animating')).toBe(false)
    expect(mounted.host.querySelector('#folders-tabs > .menu-horizontal-div-item.active')!.getAttribute('data-filter-id')).toBe('0')
  })

  // Второй путь удаления — своё действие (`foldersStore.remove`, оптимистичное
  // удаление из меню папки). Писатель выбора один — владелец; у стора своего
  // сброса нет (снят задачей 6, пин переехал сюда из `foldersStore.test.ts`).
  it('локальное удаление АКТИВНОЙ папки (foldersStore.remove) — выбор сбрасывает владелец', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
    mounted = mountOwner()
    await settle()
    useFolders().onClick()!(2)
    await settle()
    finishTransition(mounted.folders)

    useFoldersStore.getState().remove(4)
    await settle()

    // Мутация: снять `untrack(onClick)?.(0)` в `initListeners` — выбор
    // останется на удалённой папке 4, активного кадра не будет вовсе.
    expectActiveOnly(mounted.folders, 0)
    expect(useFoldersStore.getState().selectedId).toBe(0)
  })

  it('переупорядочивание — порядок детей #folders-container = порядок folderItems (filter_order)', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'), raw(5, 3, 'Учёба'))
    mounted = mountOwner()
    await settle()

    putFolders(raw(3, 9, 'Работа'))
    await settle()

    expect(filterIds(mounted.folders)).toEqual(['0', '4', '5', '3'])
    expect(useFolders().folderItems.map((item) => '' + item.id)).toEqual(filterIds(mounted.folders))
  })

  it('после перестановки клик по вкладке открывает кадр с тем же data-filter-id', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
    mounted = mountOwner()
    await settle()

    putFolders(raw(3, 9, 'Работа'))
    await settle()
    stubGeometry(mounted.folders)
    useFolders().onClick()!(1)
    await settle()
    finishTransition(mounted.folders)

    expectActiveOnly(mounted.folders, 4)
  })

  it('осталась одна папка — ряд и градиент hide, has-filters снят (:1308-1312)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    expect(rowHidden()).toBe(false)

    applyFolderUpdate({ folder_id: 3, deleted: true })
    await settle()

    expect(rowHidden()).toBe(true)
    expect(gradientHidden()).toBe(true)
    expect(mounted.chatsContainer.classList.contains('has-filters')).toBe(false)
  })
})

describe('appDialogsManager: свайп — это клик по соседней вкладке (поправка 3, :617-634)', () => {
  async function setupSwipe() {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
    mounted = mountOwner()
    await settle()
    expect(swipes).toHaveLength(1)
    expect(swipes[0].element).toBe(mounted.folders)
    return swipes[0]
  }

  const swipe = async (options: SwipeHandlerHorizontalOptions, xDiff: number) => {
    options.onSwipe(xDiff, 0, new TouchEvent('touchmove') as unknown as SwipeEvent)
    await settle()
    finishTransition(mounted!.folders)
  }

  it('xDiff < 0 — следующая папка, xDiff > 0 — предыдущая', async () => {
    const options = await setupSwipe()

    await swipe(options, -100)
    expectActiveOnly(mounted!.folders, 3)
    await swipe(options, -100)
    expectActiveOnly(mounted!.folders, 4)
    await swipe(options, 100)
    expectActiveOnly(mounted!.folders, 3)
  })

  it('на краях не выходит за пределы (clamp)', async () => {
    const options = await setupSwipe()

    await swipe(options, 100)
    expectActiveOnly(mounted!.folders, 0)
    await swipe(options, -100)
    await swipe(options, -100)
    await swipe(options, -100)
    expectActiveOnly(mounted!.folders, 4)
  })

  it('открытый форум-таб гасит жест (`verifyTouchTarget`, :900-902); destroy снимает распознаватель', async () => {
    const options = await setupSwipe()

    expect(options.verifyTouchTarget!(new TouchEvent('touchstart') as unknown as SwipeEvent)).toBe(true)
    mounted!.manager.forumTab = {} as ForumTab
    expect(options.verifyTouchTarget!(new TouchEvent('touchstart') as unknown as SwipeEvent)).toBe(false)
    mounted!.manager.forumTab = undefined
    mounted!.manager.destroy()
    mounted = undefined
    expect(swipeRemoved).toHaveBeenCalledTimes(1)
  })
})
