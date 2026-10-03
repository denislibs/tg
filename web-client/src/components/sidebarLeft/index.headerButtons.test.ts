// Кнопки шапки левой колонки — порт tweb `sidebarLeft/index.ts:211-227`
// (`updateBtn`), `:237-361` (статус-эмодзи, замок, `toggleRightButtons`),
// `:367-384` (проверка новой сборки), `:392-421` (поиск свёрнутой колонки) и
// колонка папок `renderFoldersSidebarContent` (`:174-184`). Пины — на то, что
// видит пользователь: какие кнопки стоят справа от поля поиска и когда поле —
// последний ребёнок шапки (`is-input-the-last-child`), появление «Обновить».
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import appImManager from '@lib/appImManager'
import { useChatsStore } from '@stores/chatsStore'
import { useHasOpenLeftTabs, useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'
import { useSettingsStore } from '@/settings'
import { APP_VERSION_FULL } from '@/config/app'
import type { Managers } from '@/client/bootstrap'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { applyLang } from '@/test/lang'
import type { AppDialogsManager } from '@lib/appDialogsManager'

const picker = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('./emojiStatusPicker.solid', () => ({ openEmojiStatusPicker: picker.open }))

const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async() => undefined }),
}) as unknown as Managers

const ME = { _: 'user', id: 1, first_name: 'Denis', pFlags: {} }

let installed: InstalledSidebarLeft
let header: HTMLElement
const fetchMock = vi.fn()

beforeAll(async() => {
  await applyLang('en')
  useChatsStore.setState({ me: { user: ME } } as never)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.stubGlobal('fetch', fetchMock)
  installed = installSidebarLeft(managers, undefined, { full: true })
  // синглтон вечен (К-2): `construct` — один раз на прогон, как в приложении
  installed.sidebar.construct(managers, { xd: undefined } as unknown as AppDialogsManager)
  header = installed.header
})

afterAll(() => {
  installed.destroy()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

afterEach(() => {
  appImManager.dispatchEvent('premium_toggle', false)
  useSettingsStore.getState().update({ passcodeEnabled: false, tabsInSidebar: false })
  useChatsStore.setState({ me: { user: ME } } as never)
  picker.open.mockClear()
})

const statusBtn = () => header.querySelector<HTMLElement>(':scope > .sidebar-emoji-status')
const lockBtn = () => header.querySelector<HTMLElement>(':scope > .sidebar-lock-button')
const isInputLast = () => header.classList.contains('is-input-the-last-child')

describe('toggleRightButtons (:345-352)', () => {
  it('ни Premium, ни код-пароля — кнопок нет, поле поиска последнее', () => {
    expect(statusBtn()).toBeNull()
    expect(lockBtn()).toBeNull()
    expect(isInputLast()).toBe(true)
  })

  it('Premium — кнопка статуса справа от поля: звезда без статуса, эмодзи со статусом', () => {
    appImManager.dispatchEvent('premium_toggle', true)
    const btn = statusBtn()!
    expect(btn).not.toBeNull()
    expect(btn.previousElementSibling).toBe(header.querySelector('.input-search'))
    expect(btn.className).toBe('btn-icon sidebar-emoji-status')
    expect(btn.getAttribute('aria-label')).toBe('Set as Status')
    expect(btn.querySelector('.button-icon.tgico')).not.toBeNull()
    expect(isInputLast()).toBe(false)

    // `emoji_status_change` — пришёл новый `me`
    useChatsStore.setState({ me: { user: { ...ME, emoji_status_emoticon: '🔥' } } } as never)
    expect(btn.querySelector('.sidebar-emoji-status-emoji > .emoji')?.getAttribute('alt')).toBe('🔥')
    expect(btn.querySelector('.button-icon')).toBeNull()

    btn.click()
    expect(picker.open).toHaveBeenCalledTimes(1)
    expect(picker.open.mock.calls[0][0].anchorElement).toBe(btn)
    expect(picker.open.mock.calls[0][0].managers).toBe(managers)

    appImManager.dispatchEvent('premium_toggle', false)
    expect(statusBtn()).toBeNull()
    expect(isInputLast()).toBe(true)
  })

  it('код-пароль включён — замок справа; выключен — замка нет', () => {
    useSettingsStore.getState().update({ passcodeEnabled: true })
    expect(lockBtn()).not.toBeNull()
    expect(isInputLast()).toBe(false)

    useSettingsStore.getState().update({ passcodeEnabled: false })
    expect(lockBtn()).toBeNull()
    expect(isInputLast()).toBe(true)
  })

  it('Premium и код-пароль — статус, затем замок', () => {
    appImManager.dispatchEvent('premium_toggle', true)
    useSettingsStore.getState().update({ passcodeEnabled: true })
    expect(statusBtn()!.nextElementSibling).toBe(lockBtn())
    expect(header.lastElementChild).toBe(lockBtn())
    expect(isInputLast()).toBe(false)
  })
})

describe('кнопка «Обновить» (:211-227, :367-384)', () => {
  it('скрыта; на расхождении версии через 30 мин показывается рядом с #new-menu', async() => {
    const updateBtn = installed.column.querySelector<HTMLElement>('.btn-update')!
    expect(updateBtn.className).toBe('btn-circle rp btn-corner z-depth-1 btn-update is-hidden')
    expect(updateBtn.previousElementSibling!.id).toBe('new-menu')
    expect(updateBtn.textContent).toBe('UPDATE')

    fetchMock.mockResolvedValueOnce(new Response(APP_VERSION_FULL, { status: 200 }))
    await vi.advanceTimersByTimeAsync(1800e3)
    expect(fetchMock).toHaveBeenCalledWith('version', { cache: 'no-cache' })
    expect(updateBtn.classList.contains('is-hidden')).toBe(true)

    fetchMock.mockResolvedValueOnce(new Response('999.0.0 (999)', { status: 200 }))
    await vi.advanceTimersByTimeAsync(1800e3)
    expect(updateBtn.classList.contains('is-hidden')).toBe(false)

    // опрос остановлен
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(1800e3)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('поиск свёрнутой колонки (:392-421)', () => {
  it('виден только при «папки слева» ∧ свёрнутой колонке ∧ без открытых вкладок', () => {
    const trigger = installed.column.querySelector<HTMLElement>('.sidebar-header-search-trigger')!
    expect(trigger.parentElement).toBe(header)
    expect(trigger.querySelector('.btn-icon')).not.toBeNull()
    const visible = () => trigger.classList.contains('is-visible')
    expect(visible()).toBe(false)

    useSettingsStore.getState().update({ tabsInSidebar: true })
    expect(visible()).toBe(false)
    useIsSidebarCollapsed()[1](true)
    expect(visible()).toBe(true)
    useHasOpenLeftTabs()[1](true)
    expect(visible()).toBe(false)

    useHasOpenLeftTabs()[1](false)
    useIsSidebarCollapsed()[1](false)
  })
})

describe('колонка папок (:174-184)', () => {
  it('#folders-sidebar — первый ребёнок #main-columns, пуст без настройки', () => {
    const mainColumns = document.getElementById('main-columns')!
    const foldersSidebar = mainColumns.firstElementChild as HTMLElement
    expect(foldersSidebar.id).toBe('folders-sidebar')
    expect(foldersSidebar.className).toBe('folders-sidebar sidebar-left-common')
    expect(foldersSidebar.childElementCount).toBe(0)

    useSettingsStore.getState().update({ tabsInSidebar: true })
    expect(foldersSidebar.querySelector('.folders-sidebar__menu-button.is-first')).not.toBeNull()
  })
})
