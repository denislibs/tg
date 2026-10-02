// Пины разметки владельца папок (`lib/appDialogsManager.ts`, порт tweb
// `src/lib/appDialogsManager.ts:577-727, :1249-1322`), задача 5 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
//
// Эталон — живой дамп `docs/tweb/dom/dumps/14-left-01-chatlist.json:29-76`
// (`docs/tweb/folders-tabs.md` § 1.2): `.connection-status-bottom` →
// `.chatlist-overlay` (плашка, градиент, ряд) + `#folders-container` →
// `.folders-scrollable[data-filter-id]` → `.chatlist-top` + `.chatlist-bottom`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, filterIds, frameEls, frameOf, installFrames, mountOwner, putFolders, raw, resetStores,
  settle, uninstallFrames, type Mounted,
} from './appDialogsManager.testkit'
import styles from './appDialogsManager.module.scss'
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

  it('в оверлее — плашка, градиент, ряд (дамп :30-48); одна папка — hide и у ряда, и у градиента', async () => {
    mounted = mountOwner()
    await settle()
    const overlay = mounted.host.querySelector('.chatlist-overlay')!
    const [suggestion, gradient, scrollable] = Array.from(overlay.children) as HTMLElement[]

    expect(overlay.children).toHaveLength(3)
    expect(suggestion).toBe(mounted.manager.suggestionContainer)
    expect(scrollable.className).toBe('menu-horizontal-scrollable folders-tabs-scrollable hide')
    // ОБЪЯВЛЕННОЕ РАСХОЖДЕНИЕ (стенд, задачи 4–9). У tweb `hide` из ref градиента
    // (`appDialogsManager.ts:678-681`) затирает class-эффект `Tabs.MenuGradient`
    // (пин в `foldersTabs.solid.test.tsx`), а `onFiltersLengthChange`
    // (`:1298-1322`) трогает градиент лишь при смене показа — одна папка на
    // холодном старте оставляет градиент без `hide`. Он растянут на оверлей
    // (`_leftSidebar.scss:315-325`, `inset: 0`) и под плашкой-подсказкой гасит
    // прокрученные строки в её полях. Видимый артефакт — не паритет: владелец
    // синхронизирует `hide` градиента с показом ряда на каждом проходе.
    expect(gradient.className).toBe('menu-horizontal-gradient-container folders-tabs-gradient-container hide')
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
    expect(Array.from(frame.children).filter((el) => !el.classList.contains('scrollable-thumb-container')).map((el) => el.classList[0]))
      .toEqual(['chatlist-top', 'chatlist-bottom'])
    expect(chatsContainer.classList.contains('has-filters')).toBe(false)
  })

  // Расхождение 19 шапки владельца: клиренс под compose-FAB и тонкий скроллбар —
  // наши классы на ЕГО узлах; при свёрнутой колонке (открыт форум) клиренса нет.
  it('наши классы: скроллбар на кадре, клиренс под FAB на .chatlist-bottom, setCollapsed — и на новых кадрах', async () => {
    mounted = mountOwner()
    await settle()
    const { folders, manager } = mounted
    const frame = folders.firstElementChild as HTMLElement

    expect(frame.classList.contains(styles.scroll)).toBe(true)
    expect(frame.querySelector('.chatlist-bottom')!.classList.contains(styles.bottom)).toBe(true)

    manager.setCollapsed(true)
    expect(frame.classList.contains(styles.collapsed)).toBe(true)

    // Мутация: не переносить флаг на новый кадр в `addFilter` — у папки,
    // пришедшей при открытом форуме, клиренс останется.
    putFolders(raw(3, 1, 'Работа'))
    await settle()
    expect(frameOf(folders, 3).classList.contains(styles.collapsed)).toBe(true)

    manager.setCollapsed(false)
    expect(frameEls(folders).some((el) => el.classList.contains(styles.collapsed))).toBe(false)
  })

  // Геометрию happy-dom не считает, поэтому это скан стиля, а не поведение.
  // Замер на стенде (задача 6): «Все чаты» прокручены на 272px → «Личные» →
  // обратно — scrollTop 84 с клиренсом и 0 с этим правилом. Браузер возвращает
  // скроллеру прежнюю позицию, зажатую содержимым, а у очищенной папки (`ul`
  // пуст) прокручивать должно быть нечего — как у tweb, где `.chatlist-bottom`
  // высоты не имеет. Мутация: снять правило — тест красный.
  it('клиренс под FAB гаснет, пока список папки очищен (пустой ul) — иначе папка вернётся не с начала', () => {
    const scss = readFileSync(resolve(__dirname, 'appDialogsManager.module.scss'), 'utf8')
    expect(scss).toMatch(/:global\(\.chatlist-top\):has\(> ul:empty\) \+ \.bottom \{\s*height: 0;/)
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
    // наблюдатели заводит и ядро виртуального списка папки — берём тот, что смотрит на оверлей
    const overlay = mounted.host.querySelector('.chatlist-overlay')!
    const observer = FakeResizeObserver.instances.find((instance) => instance.observed.includes(overlay))!

    expect(observer.observed).toEqual([overlay])
    observer.fire(96)
    expect(mounted.host.style.getPropertyValue('--chatlist-overlay-height')).toBe('96px')
  })

  it('destroy() снимает всё созданное: хост пуст, кадров в документе нет, наблюдатель и подписки сняты (DoD 5)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    const { manager, host, chatsContainer } = mounted
    const overlay = host.querySelector('.chatlist-overlay')!
    const observer = FakeResizeObserver.instances.find((instance) => instance.observed.includes(overlay))!

    manager.destroy()
    mounted = undefined

    expect(host.childNodes).toHaveLength(0)
    expect(document.querySelector('.folders-scrollable')).toBeNull()
    expect(document.querySelector('.chatlist-overlay')).toBeNull()
    expect(host.style.getPropertyValue('--chatlist-overlay-height')).toBe('')
    expect(chatsContainer.classList.contains('has-filters')).toBe(false)
    expect(observer.disconnected).toBe(true)
    expect(useFolders().onClick()).toBeUndefined()
    expect(manager.xds.size).toBe(0)

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
