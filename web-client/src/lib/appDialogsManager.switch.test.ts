// ГЛАВНЫЙ ПИН ЗАДАЧИ 5: переключение папок владельцем (`lib/appDialogsManager.ts`,
// порт tweb `src/lib/appDialogsManager.ts:729-822, :851-858, :1092-1101`).
//
// Последовательность клика (`docs/tweb/folders-tabs.md` § 1.6, «для пинов»):
// полоса → `selectFolderByIndex` (выбор в стор, `clear()` цели, `reset()` +
// `onChatsScroll()` через `onTabChange`) → `TransitionSlider.slideTabs` (`from`/
// `to`/`animating`/`backwards`, инлайновые сдвиги ±width) → по `transitionend`
// уходящий теряет `active from` и сдвиг, а `onTransitionEnd` полосы чистит все
// неактивные списки. Памяти `scrollTop` у папок в tweb НЕТ (поправка 1 плана):
// открытая папка всегда показывается с начала.
//
// Живые `horizontalMenu` + `TransitionSlider`, конец перехода — НАСТОЯЩЕЕ событие
// `transitionend` (образец — `components/appSearchSuper.scroll.test.ts`);
// геометрия — стабом (`appDialogsManager.testkit.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, PAGE, WIDTH, expectActiveOnly, finishTransition, frameOf, installFrames,
  mountList, mountOwner, putFolders, raw, resetStores, settle, tabEls, transformAtReflow,
  uninstallFrames, type ListProbe, type Mounted,
} from './appDialogsManager.testkit'
import { resetPeerMirror } from '@core/peerCache'
import { useFoldersStore } from '@stores/foldersStore'
import useFolders from '@stores/folders.solid'
import appNavigationController from '@core/navigation/appNavigationController'
import { fastSmoothScrollToStart } from '@helpers/fastSmoothScroll'

// Плавная прокрутка к началу считает путь по настоящим прямоугольникам, которых
// в happy-dom нет; проверяем ФАКТ и АРГУМЕНТЫ вызова (`:779-782`). Остальной
// модуль — настоящий: им пользуется полоса (`horizontalMenu.ts`).
vi.mock('@helpers/fastSmoothScroll', async (importOriginal) => ({
  ...await importOriginal<typeof import('@helpers/fastSmoothScroll')>(),
  fastSmoothScrollToStart: vi.fn(() => Promise.resolve()),
}))

let mounted: Mounted | undefined
let lists: Map<number, ListProbe>
const fetchSpy = vi.fn()

/** три папки: «Все чаты» (0), «Работа» (3), «Шум» (4) — индексы вкладок 0, 1, 2 */
async function setup(options?: Parameters<typeof mountOwner>[0]) {
  putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'))
  mounted = mountOwner(options)
  await settle()
  lists = new Map(mounted.manager.getRendered().map((list) => [list.id, mountList(list)]))
  return mounted
}

const clickTab = (index: number) => {
  tabEls(mounted!.host)[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

const resetCalls = () => lists.forEach((probe) => {
  probe.calls.clear = probe.calls.reset = probe.calls.onChatsScroll = 0
})

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной — её держит другой файл прогона').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  vi.mocked(fastSmoothScrollToStart).mockClear()
})

afterEach(() => {
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('appDialogsManager: первый показ', () => {
  it('«Все чаты» активна без перехода, её список попросил первую страницу ровно один раз (late binding, :1064-1065)', async () => {
    const { folders } = await setup()

    expectActiveOnly(folders, 0)
    expect(folders.classList.contains('animating')).toBe(false)
    expect(lists.get(0)!.calls.onChatsScroll).toBe(1)
    expect(lists.get(3)!.calls.onChatsScroll).toBe(0)
    expect(lists.get(0)!.ul.children).toHaveLength(PAGE)
    expect(tabEls(mounted!.host)[0].classList.contains('active')).toBe(true)
    expect(mounted!.manager.xd).toBe(mounted!.manager.getRendered().find((list) => list.id === 0))
  })
})

describe('appDialogsManager: клик по вкладке', () => {
  it('клик по вкладке 1 — onClick с индексом 1, закрытие всего в колонке, from/to/animating и сдвиги ±width (transition.ts:102-116)', async () => {
    const { folders, hooks } = await setup()
    const closeBefore = hooks.closeCalls
    const [all, work] = [frameOf(folders, 0), frameOf(folders, 3)]

    clickTab(1)
    await settle()

    expect(hooks.closeCalls).toBe(closeBefore + 1)
    expect(work.classList.contains('active')).toBe(true)
    expect(work.classList.contains('to')).toBe(true)
    expect(all.classList.contains('from')).toBe(true)
    expect(folders.classList.contains('animating')).toBe(true)
    expect(folders.classList.contains('backwards')).toBe(false)
    // в момент reflow приходящий стоит справа (+width), уходящий уехал влево (-width);
    // после reflow сдвиг приходящего снят — он едет к 0 по CSS-переходу
    expect(transformAtReflow.get(work)).toBe(`translate3d(${WIDTH}px, 0px, 0)`)
    expect(all.style.transform).toBe(`translate3d(${-WIDTH}px, 0px, 0)`)
    expect(work.style.transform).toBe('')
    expect(useFoldersStore.getState().selectedId).toBe(3)
    expect(tabEls(mounted!.host)[1].classList.contains('active')).toBe(true)
  })

  it('по transitionend: уходящий теряет active/from и сдвиг, неактивный список очищен ровно раз, у активного reset + onChatsScroll', async () => {
    const { folders } = await setup()
    const [all, work] = [frameOf(folders, 0), frameOf(folders, 3)]
    resetCalls()

    clickTab(1)
    await settle()
    finishTransition(folders)

    expectActiveOnly(folders, 3)
    expect(all.classList.contains('from')).toBe(false)
    expect(all.style.transform).toBe('')
    expect(work.classList.contains('to')).toBe(false)
    expect(folders.classList.contains('animating')).toBe(false)

    expect(lists.get(0)!.calls.clear).toBe(1)
    expect(lists.get(4)!.calls.clear).toBe(1)
    // у активной — `clear()` перед переключением (:786) и `onTabChange` (:1092-1101)
    expect(lists.get(3)!.calls).toEqual({ clear: 1, reset: 1, onChatsScroll: 1 })
    expect(lists.get(0)!.ul.children).toHaveLength(0)
    expect(lists.get(3)!.ul.children).toHaveLength(PAGE)
    expect(mounted!.manager.xd!.id).toBe(3)
  })

  it('клик обратно на меньший индекс добавляет backwards; сдвиги зеркальные', async () => {
    const { folders } = await setup()
    clickTab(2)
    await settle()
    finishTransition(folders)
    const [work, noise] = [frameOf(folders, 3), frameOf(folders, 4)]

    clickTab(1)
    await settle()

    expect(folders.classList.contains('backwards')).toBe(true)
    expect(noise.classList.contains('from')).toBe(true)
    expect(transformAtReflow.get(work)).toBe(`translate3d(${-WIDTH}px, 0px, 0)`)
    expect(noise.style.transform).toBe(`translate3d(${WIDTH}px, 0px, 0)`)
  })

  it('клик по i-й вкладке активирует кадр с тем же data-filter-id (порядок кадров = порядок вкладок)', async () => {
    const { folders } = await setup()

    for(const index of [2, 1, 0, 2]) {
      clickTab(index)
      await settle()
      finishTransition(folders)
      expectActiveOnly(folders, +tabEls(mounted!.host)[index].dataset.filterId!)
    }
  })

  it('после перехода у неактивных ul пуст, а вернувшаяся папка — с начала: памяти scrollTop нет (поправка 1)', async () => {
    const { folders } = await setup()
    clickTab(1)
    await settle()
    finishTransition(folders)
    const workScroller = frameOf(folders, 3)
    workScroller.scrollTop = 500
    expect(workScroller.scrollTop).toBe(500)

    clickTab(0)
    await settle()
    finishTransition(folders)
    expect(lists.get(3)!.ul.children).toHaveLength(0)
    expect(lists.get(4)!.ul.children).toHaveLength(0)

    clickTab(1)
    await settle()
    finishTransition(folders)
    expect(workScroller.scrollTop).toBe(0)
    expect(lists.get(3)!.ul.children).toHaveLength(PAGE)
  })

  it('возврат ДО конца перехода — папка всё равно с начала: цель чистится перед показом (:786)', async () => {
    const { folders } = await setup()
    clickTab(1)
    await settle()
    finishTransition(folders)
    const workScroller = frameOf(folders, 3)
    workScroller.scrollTop = 500

    // ушли и сразу вернулись, `transitionend` ещё не пришёл — уборка неактивных не сыграла
    clickTab(0)
    await settle()
    clickTab(1)
    await settle()

    expect(workScroller.scrollTop).toBe(0)
  })

  it('переключение не ходит в сеть: первая страница — через список (кэш воркера в задаче 6)', async () => {
    const { folders } = await setup()
    fetchSpy.mockClear()

    clickTab(1)
    await settle()
    finishTransition(folders)
    clickTab(2)
    await settle()
    finishTransition(folders)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('навигационная запись filters: есть на не-первой папке, снимается на «Всех чатах» (:760-777)', async () => {
    const { folders } = await setup()

    clickTab(1)
    await settle()
    expect(appNavigationController.findItemByType('filters')).toBeTruthy()

    clickTab(2)
    await settle()
    finishTransition(folders)
    clickTab(0)
    await settle()
    expect(appNavigationController.findItemByType('filters')).toBeUndefined()
  })
})

describe('appDialogsManager: особые ветки selectFolderByIndex', () => {
  it('повторный клик по активной — плавная прокрутка её скроллера к началу, выбор не меняется (:779-782)', async () => {
    const { folders } = await setup()
    clickTab(1)
    await settle()
    finishTransition(folders)
    resetCalls()

    clickTab(1)
    await settle()

    expect(fastSmoothScrollToStart).toHaveBeenCalledTimes(1)
    expect(fastSmoothScrollToStart).toHaveBeenCalledWith(frameOf(folders, 3), 'y')
    expect(useFoldersStore.getState().selectedId).toBe(3)
    expect(folders.classList.contains('animating')).toBe(false)
    expect(lists.get(3)!.calls).toEqual({ clear: 0, reset: 0, onChatsScroll: 0 })
  })

  it('closeEverythingInsideNaturally ответил false — вкладка не переключилась (selectTarget, horizontalMenu.ts:55-62)', async () => {
    let allow = true
    const { folders } = await setup({ close: () => allow })
    allow = false
    resetCalls()

    clickTab(1)
    await settle()

    expectActiveOnly(folders, 0)
    expect(folders.classList.contains('animating')).toBe(false)
    expect(useFoldersStore.getState().selectedId).toBe(0)
    expect(tabEls(mounted!.host)[0].classList.contains('active')).toBe(true)
    expect(lists.get(3)!.calls.clear).toBe(0)
  })

  it('onClick стора — та же точка переключения (:812): вызов с индексом ведёт себя как клик', async () => {
    const { folders } = await setup()

    useFolders().onClick()!(2)
    await settle()
    finishTransition(folders)

    expectActiveOnly(folders, 4)
    expect(tabEls(mounted!.host)[2].classList.contains('active')).toBe(true)
  })
})

describe('appDialogsManager: список папки регистрируется позже первого запроса (FolderList)', () => {
  it('onChatsScroll до регистрации хэндла выполняется один раз при register, после — сразу', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    const list = mounted.manager.xd!
    const onChatsScroll = vi.fn()

    const unregister = list.register({ clear: vi.fn(), reset: vi.fn(), onChatsScroll })
    expect(onChatsScroll).toHaveBeenCalledTimes(1)

    list.onChatsScroll()
    expect(onChatsScroll).toHaveBeenCalledTimes(2)
    unregister()
  })

  it('clear() до регистрации снимает отложенный запрос — как отмена загрузки у tweb (base.ts:353-362)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    const list = mounted.manager.xd!
    const onChatsScroll = vi.fn()

    list.clear()
    list.register({ clear: vi.fn(), reset: vi.fn(), onChatsScroll })

    expect(onChatsScroll).not.toHaveBeenCalled()
  })
})
