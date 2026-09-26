// Пины разметки владельца папок (`lib/appDialogsManager.ts`, порт tweb
// `src/lib/appDialogsManager.ts:577-727, :1249-1322`), задача 5 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
//
// Эталон — живой дамп `docs/tweb/dom/dumps/14-left-01-chatlist.json:29-76`
// (`docs/tweb/folders-tabs.md` § 1.2): `.connection-status-bottom` →
// `.chatlist-overlay` (плашка, градиент, ряд) + `#folders-container` →
// `.folders-scrollable[data-filter-id]` → `.chatlist-top` + `.chatlist-bottom`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, filterIds, installFrames, mountOwner, putFolders, raw, resetStores,
  settle, uninstallFrames, type Mounted,
} from './appDialogsManager.testkit'
import { resetPeerMirror } from '@core/peerCache'
import useFolders from '@stores/folders.solid'

let mounted: Mounted | undefined

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной — её держит другой файл прогона').toBe(true)
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
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

describe('appDialogsManager: разметка после start()', () => {
  it('в хосте — оверлей первым и #folders-container последним (:587-597)', async () => {
    mounted = mountOwner()
    await settle()
    const { host } = mounted

    expect(Array.from(host.children).map((el) => el.className || el.id)).toEqual([
      'chatlist-overlay',
      'tabs-container',
    ])
    expect(host.lastElementChild!.id).toBe('folders-container')
  })

  it('в оверлее — плашка, градиент, ряд (дамп :30-48); hide у ряда, но НЕ у градиента — как у tweb', async () => {
    mounted = mountOwner()
    await settle()
    const overlay = mounted.host.querySelector('.chatlist-overlay')!
    const [suggestion, gradient, scrollable] = Array.from(overlay.children) as HTMLElement[]

    expect(overlay.children).toHaveLength(3)
    expect(suggestion).toBe(mounted.manager.suggestionContainer)
    expect(gradient.className).toBe('menu-horizontal-gradient-container folders-tabs-gradient-container')
    expect(scrollable.className).toBe('menu-horizontal-scrollable folders-tabs-scrollable hide')
    // `hide`, который tweb ставит градиенту в ref (`appDialogsManager.ts:678-681`),
    // затирает class-эффект `Tabs.MenuGradient` (тот же JSX и тот же Solid 1.9.9 —
    // пин задачи 4 в `foldersTabs.solid.test.tsx`), а `onFiltersLengthChange`
    // (`:1298-1322`) трогает градиент лишь при смене показа. План (шаг 2) ждал
    // здесь `.hide` — это расхождение плана с оригиналом, порт держит оригинал.
    expect(gradient.classList.contains('hide')).toBe(false)
  })

  it('«Все чаты» — один кадр .folders-scrollable[data-filter-id=0].active с .chatlist-top и .chatlist-bottom (дамп :74-76)', async () => {
    mounted = mountOwner()
    await settle()
    const { folders, chatsContainer } = mounted
    const frame = folders.firstElementChild as HTMLElement

    expect(folders.children).toHaveLength(1)
    expect(frame.dataset.filterId).toBe('0')
    for(const cls of ['scrollable', 'scrollable-y', 'tabs-tab', 'chatlist-parts', 'folders-scrollable', 'scrollable-y-bordered', 'active', 'scrolled-start']) {
      expect(frame.classList.contains(cls)).toBe(true)
    }
    expect(Array.from(frame.children).filter((el) => !el.classList.contains('scrollable-thumb-container')).map((el) => el.className))
      .toEqual(['chatlist-top', 'chatlist-bottom'])
    expect(chatsContainer.classList.contains('has-filters')).toBe(false)
  })

  it('три папки — четыре кадра в порядке localId, ряд показан, у колонки has-filters (:1298-1322)', async () => {
    putFolders(raw(3, 1, 'Работа'), raw(4, 2, 'Шум'), raw(5, 3, 'Учёба'))
    mounted = mountOwner()
    await settle()
    const overlay = mounted.host.querySelector('.chatlist-overlay')!

    expect(filterIds(mounted.folders)).toEqual(['0', '3', '4', '5'])
    expect(overlay.querySelector('.folders-tabs-scrollable')!.classList.contains('hide')).toBe(false)
    expect(overlay.querySelector('.folders-tabs-gradient-container')!.classList.contains('hide')).toBe(false)
    expect(mounted.chatsContainer.classList.contains('has-filters')).toBe(true)
    // вкладки ряда и кадры — один порядок (`horizontalMenu.ts:56`, `content.children[id]`)
    expect(Array.from(overlay.querySelectorAll<HTMLElement>('.menu-horizontal-div-item')).map((el) => el.dataset.filterId))
      .toEqual(['0', '3', '4', '5'])
  })

  it('ResizeObserver оверлея пишет --chatlist-overlay-height на хост (:601-604)', async () => {
    mounted = mountOwner()
    await settle()
    const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]

    expect(observer.observed).toEqual([mounted.host.querySelector('.chatlist-overlay')])
    observer.fire(96)
    expect(mounted.host.style.getPropertyValue('--chatlist-overlay-height')).toBe('96px')
  })

  it('destroy() снимает всё созданное: хост пуст, кадров в документе нет, наблюдатель и подписки сняты (DoD 5)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    const { manager, host, chatsContainer } = mounted
    const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]

    manager.destroy()
    mounted = undefined

    expect(host.childNodes).toHaveLength(0)
    expect(document.querySelector('.folders-scrollable')).toBeNull()
    expect(document.querySelector('.chatlist-overlay')).toBeNull()
    expect(host.style.getPropertyValue('--chatlist-overlay-height')).toBe('')
    expect(chatsContainer.classList.contains('has-filters')).toBe(false)
    expect(observer.disconnected).toBe(true)
    expect(useFolders().onClick()).toBeUndefined()
    expect(manager.getRendered()).toEqual([])

    // подписка на папки снята: новая папка кадра не рождает
    putFolders(raw(4, 2, 'Шум'))
    await settle()
    expect(document.querySelector('.folders-scrollable')).toBeNull()
  })

  it('destroy() сразу после start(): асинхронный первый onClick(0) не лезет в снятые списки (расхождение 18)', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => { rejections.push(reason) }
    process.on('unhandledRejection', onRejection)
    try {
      mounted = mountOwner()
      mounted.manager.destroy()
      mounted = undefined
      await settle()
    } finally {
      process.off('unhandledRejection', onRejection)
    }

    expect(rejections).toEqual([])
    expect(useFolders().onClick()).toBeUndefined()
  })

  it('отложенный показ ряда (pause(0)) после destroy() ничего не трогает', async () => {
    mounted = mountOwner()
    const { manager, chatsContainer } = mounted
    putFolders(raw(3, 1, 'Работа'))

    manager.destroy()
    mounted = undefined
    await settle()

    expect(chatsContainer.classList.contains('has-filters')).toBe(false)
  })
})
