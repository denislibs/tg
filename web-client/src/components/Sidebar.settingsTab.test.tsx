// Корень настроек — вкладка КОЛОНОЧНОГО слайдера (задача 28 плана 2D, tweb
// `sidebarLeft/index.ts:759-767` — `closeTabsBefore(() =>
// this.createTab(AppSettingsTab).open())`). Пины на то, что видит пользователь:
//  • пункт «Settings» бургера кладёт вкладку `AppSettingsTab` соседом
//    `.item-main` в тот же `#column-left > .sidebar-slider`, что и список чатов
//    (своего слоя над колонкой больше нет);
//  • `has-open-tabs` у колонки — отражение вкладок слайдера, ОДИН писатель:
//    вкладку закрыли Esc или стрелкой — признак снят, хотя React о закрытии не
//    узнавал ничего, кроме `onTabsCountChange` слайдера;
//  • «назад» возвращает в чатлист: `.item-main` снова активна, узел вкладки
//    разобран.
// Содержимое корня — заглушка: его собственные пины — `tabs/settings.solid.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { applyLang } from '@/test/lang'
import type { Managers } from '../client/bootstrap'

// Solid-компонент содержимого — функция, отдающая DOM-узел (Solid принимает
// узел как JSX.Element): JSX здесь React'овский, Solid-разметку писать нечем.
vi.mock('./sidebarLeft/tabs/settings.solid', () => ({
  default: () => {
    const el = document.createElement('div')
    el.className = 'settings-root-stub'
    return el
  },
}))

// Слой менеджеров — рекурсивный Proxy: любой вызов отдаёт промис (шов с воркером);
// список аккаунтов бургер читает массивом.
const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: (_, method) => method === 'listAccounts' ? async () => [] : async () => undefined }),
}) as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => act(async () => { await pause(400) })

const column = () => document.getElementById('column-left')!
const sliderEl = () => column().querySelector<HTMLElement>(':scope > .sidebar-slider')!
const mainTab = () => sliderEl().querySelector<HTMLElement>(':scope > .item-main')!
const settingsTab = () => sliderEl().querySelector<HTMLElement>(':scope > .tabs-tab.item-secondary')

async function renderSidebar() {
  await applyLang('en')
  useChatsStore.setState({ me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags: {} } } as never })
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

async function openSettings() {
  fireEvent.click(document.querySelector('.sidebar-tools-button')!)
  await act(async () => {})
  fireEvent.click(screen.getByText('Settings'))
  // `closeTabsBefore` — синхронно, если закрывать нечего; дальше — чанк вкладки
  await act(async () => { await pause(50) })
}

afterEach(async () => {
  cleanup()
  await pause(400)
  useChatsStore.setState({ me: null })
  document.body.replaceChildren()
})

describe('Sidebar — корень настроек на колоночном слайдере', () => {
  it('«Settings» кладёт AppSettingsTab соседом .item-main в колоночный слайдер, has-open-tabs взведён', async () => {
    await renderSidebar()
    expect(settingsTab()).toBeNull()
    expect(column().classList.contains('has-open-tabs')).toBe(false)

    await openSettings()

    const tab = settingsTab()!
    expect(tab).not.toBeNull()
    expect(tab.previousElementSibling).toBe(mainTab())
    expect(tab.querySelector('.sidebar-header__title')!.textContent).toBe('Settings')
    expect(tab.querySelector('.settings-root-stub')).not.toBeNull()
    expect(tab.classList.contains('active')).toBe(true)
    // своего слоя над колонкой (прежний хост шва) нет: слайдер у колонки один
    expect(column().querySelectorAll('.sidebar-slider')).toHaveLength(1)
    expect(column().classList.contains('has-open-tabs')).toBe(true)
  })

  it('Esc закрывает вкладку и снимает has-open-tabs: признак пишет слайдер, а не экран React', async () => {
    await renderSidebar()
    await openSettings()
    const tab = settingsTab()!

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    await settle()

    expect(tab.isConnected).toBe(false)
    expect(mainTab().classList.contains('active')).toBe(true)
    expect(column().classList.contains('has-open-tabs')).toBe(false)
  })

  it('стрелка «назад» вкладки возвращает в чатлист с переходом', async () => {
    await renderSidebar()
    await openSettings()
    await settle()
    const tab = settingsTab()!

    await act(async () => { tab.querySelector<HTMLElement>('.sidebar-close-button')!.click() })
    // переход назад: `.animating.backwards` у колоночного слайдера (tweb `transition.ts:23-42`)
    expect(sliderEl().classList.contains('animating')).toBe(true)
    expect(sliderEl().classList.contains('backwards')).toBe(true)
    await settle()

    expect(tab.isConnected).toBe(false)
    expect(mainTab().classList.contains('active')).toBe(true)
    expect(column().classList.contains('has-open-tabs')).toBe(false)
  })

  it('размонтирование колонки уносит открытую вкладку вместе со слайдером', async () => {
    await renderSidebar()
    await openSettings()
    const tab = settingsTab()!
    expect(tab).not.toBeNull()

    cleanup()
    await settle()

    // вкладку разобрал слайдер (`destroyColumnSlider` → `closeAllTabs`), а не
    // выбросило поддерево: Esc больше некому гасить
    expect(tab.isConnected).toBe(false)
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(false)
  })
})
