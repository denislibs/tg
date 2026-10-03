// Пины режима показа папок — порт tweb `stores/foldersSidebar.ts:90-112` (задача 8
// плана `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`).
//
// Ряд вкладок владелец держит в DOM всегда (задача 6), поэтому его видимость
// решает ТОЛЬКО `body.has-horizontal-folders` (`_leftSidebar.scss:304-313`).
// Пины — на классы `<body>` и на вычисленный `display` ряда под настоящим CSS:
//   (1) формула эффекта по трём сигналам и активному экрану;
//   (2) `hasFolders` пишет владелец папок (`onFiltersLengthChange`,
//       `appDialogsManager.ts:1315-1316`), `destroy()` его снимает;
//   (3) статического класса в `index.html` нет;
//   (4) при «папки слева» ряд под настоящими стилями не виден.
// (5) `body.has-folders-sidebar` и место колонки — настройка и ширина экрана;
// колонка папок — `sidebarLeft/foldersSidebarContent/index.solid.test.tsx`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sass from 'sass'
import '@/test/lang'
import useHasFoldersSidebar, { useFoldersSidebarShown, useHasFolders, useIsSidebarCollapsed } from './foldersSidebar.solid'
import { useSettingsStore } from '@/settings'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import {
  FakeResizeObserver, installFrames, mountOwner, putFolders, raw, resetStores, settle,
  uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { resetPeerMirror } from '@core/peerCache'
import { applyFolderUpdate } from './foldersStore'

const [, setHasFolders] = useHasFolders()
/** Настройка «Расположение папок → Слева от чатов» (`settings.tabsInSidebar`). */
const setShown = (tabsInSidebar: boolean) => useSettingsStore.getState().update({ tabsInSidebar })
const [, setCollapsed] = useIsSidebarCollapsed()

const bodyClasses = () => ['has-horizontal-folders', 'has-vertical-folders']
  .filter((name) => document.body.classList.contains(name))

/** Смена активного экрана — тем же событием, что шлёт `mediaSizes.handleResize`. */
function changeScreen(to: ScreenSize) {
  const from = mediaSizes.activeScreen
  mediaSizes.activeScreen = to
  mediaSizes.dispatchEvent('changeScreen', from, to)
}

const initialScreen = mediaSizes.activeScreen

/** Сужение/расширение окна — тем же событием `resize`, что шлёт `mediaSizes.handleResize`. */
function setLessThanFloating(value: boolean) {
  mediaSizes.isLessThanFloatingLeftSidebar = value
  mediaSizes.dispatchEvent('resize')
}

function resetMode() {
  setHasFolders(false)
  setShown(false)
  setCollapsed(false)
  setLessThanFloating(false)
  changeScreen(initialScreen)
}

describe('foldersSidebar: body-классы режима (foldersSidebar.ts:90-112)', () => {
  beforeEach(() => {
    resetMode()
    changeScreen(ScreenSize.large)
  })
  afterEach(resetMode)

  it('папок нет (одна «Все чаты») — ни одного класса, в каком бы режиме ни была колонка', () => {
    expect(bodyClasses()).toEqual([])
    setShown(true)
    expect(bodyClasses()).toEqual([])
    setCollapsed(true)
    expect(bodyClasses()).toEqual([])
  })

  it('есть папки, колонки нет — горизонтальный ряд', () => {
    setHasFolders(true)
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])
  })

  it('«папки слева» показаны — вертикальный, горизонтальный снят; колонку убрали — снова горизонтальный', () => {
    setHasFolders(true)
    setShown(true)
    expect(bodyClasses()).toEqual(['has-vertical-folders'])

    // так колонка сообщает о сужении экрана: она перестала рисовать себя
    setShown(false)
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])
  })

  it('свёрнутая колонка на широком экране — вертикальный; на мобильном — горизонтальный (activeScreen < medium)', () => {
    setHasFolders(true)
    setCollapsed(true)
    expect(bodyClasses()).toEqual(['has-vertical-folders'])

    changeScreen(ScreenSize.medium)
    expect(bodyClasses()).toEqual(['has-vertical-folders'])

    changeScreen(ScreenSize.mobile)
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])
  })

  it('body.has-folders-sidebar = настройка ∧ экран шире 925px (:25-34)', () => {
    const [hasFoldersSidebar] = useHasFoldersSidebar()
    const [shown] = useFoldersSidebarShown()
    const hasClass = () => document.body.classList.contains('has-folders-sidebar')
    expect(hasClass()).toBe(false)

    setShown(true)
    expect(hasFoldersSidebar()).toBe(true)
    expect(shown()).toBe(true)
    expect(hasClass()).toBe(true)

    // ≤ 925px колонку прячет SCSS — класс снят, сырая настройка осталась
    setLessThanFloating(true)
    expect(hasFoldersSidebar()).toBe(true)
    expect(shown()).toBe(false)
    expect(hasClass()).toBe(false)

    setLessThanFloating(false)
    expect(hasClass()).toBe(true)

    setShown(false)
    expect(hasClass()).toBe(false)
  })

  it('показ колонки резервирует ей место в раскладке (setFoldersSidebarShown, :30-34)', () => {
    const offset = () => document.documentElement.style.getPropertyValue('--folders-sidebar-offset')
    setShown(true)
    const shownOffset = offset()
    setShown(false)
    expect(offset()).toBe('0px')
    expect(shownOffset).not.toBe('0px')
    expect(shownOffset).not.toBe('')
  })
})

describe('foldersSidebar: hasFolders пишет владелец папок (appDialogsManager.ts:1315-1316)', () => {
  let mounted: Mounted | undefined

  beforeEach(() => {
    resetMode()
    resetStores()
    resetPeerMirror()
    expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
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
    resetMode()
  })

  it('одна папка — классов нет; появилась вторая — горизонтальный; снова одна — снят', async () => {
    mounted = mountOwner()
    await settle()
    expect(bodyClasses()).toEqual([])

    putFolders(raw(3, 1, 'Работа'))
    await settle()
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])

    applyFolderUpdate({ folder_id: 3, deleted: true })
    await settle()
    expect(bodyClasses()).toEqual([])
  })

  it('destroy() снимает свой след на body (DoD 5)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    await settle()
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])

    mounted.manager.destroy()
    mounted = undefined
    expect(bodyClasses()).toEqual([])
  })
})

describe('index.html', () => {
  it('на <body> нет статического has-horizontal-folders — класс ставит только эффект режима', () => {
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf-8')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    expect(body.classList.contains('has-horizontal-folders')).toBe(false)
    expect(body.classList.contains('has-vertical-folders')).toBe(false)
    // соседние статические классы tweb на месте — парсер прочитал именно наш <body>
    expect(body.classList.contains('has-auth-pages')).toBe(true)
  })
})

describe('foldersSidebar: видимость ряда под настоящим CSS (_leftSidebar.scss:304-313)', () => {
  let css: string
  let mounted: Mounted | undefined

  beforeAll(() => {
    const stylesDir = join(__dirname, '..', 'styles')
    css = sass.compile(join(stylesDir, 'index.scss'), {
      loadPaths: [stylesDir, join(__dirname, '..', '..', 'node_modules')],
      silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
      quietDeps: true,
    }).css
  })

  beforeEach(() => {
    resetMode()
    resetStores()
    resetPeerMirror()
    expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
  })

  afterEach(() => {
    mounted?.manager.destroy()
    mounted = undefined
    uninstallFrames()
    vi.unstubAllGlobals()
    document.head.replaceChildren()
    document.body.replaceChildren()
    resetStores()
    resetPeerMirror()
    resetMode()
  })

  /** Владелец в `#column-left`, как его кладёт колонка. */
  async function mountInColumn() {
    putFolders(raw(3, 1, 'Работа'))
    mounted = mountOwner()
    const column = document.createElement('div')
    column.id = 'column-left'
    document.body.append(column)
    column.append(mounted.chatsContainer)
    await settle()
    return mounted.host.querySelector<HTMLElement>('.chatlist-overlay > .folders-tabs-scrollable')!
  }

  it('горизонтальный режим — ряд виден; «папки слева» — ряд в DOM, но не виден', async () => {
    const row = await mountInColumn()
    expect(getComputedStyle(row).display).toBe('block')

    setShown(true)
    expect(row.isConnected).toBe(true)
    expect(getComputedStyle(row).display).toBe('none')
  })
})
