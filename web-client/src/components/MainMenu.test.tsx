// Бургер-меню обязано совпадать с tweb по дереву, а не «примерно выглядеть»:
// портированный `_button.scss` стилизует ровно те узлы, что рождает
// `ButtonMenuSync` (buttonMenu.ts:230-278) и `createSubmenuTrigger.ts`.
//
// Что держит этот файл (всё — реальные расхождения, найденные сверкой с живым
// дампом `docs/tweb/dom/dumps/18-burger-menu-full.json`):
//   1. разделители групп — элемент <hr>, а не div с инлайн-фоном: правило
//      `_button.scss:633` (`margin: var(--btn-menu-padding) 0`) написано на тег;
//   2. пункт «More» — `submenu-trigger`, подменю раскрывается ПО НАВЕДЕНИЮ
//      (tweb `triggerEvent: 'mouseenter'`), а не по клику;
//   3. панель подменю несёт `btn-menu-submenu` + `sidebar-tools-submenu`;
//   4. у подменю есть футер `a.btn-menu-footer > span.btn-menu-footer-text`
//      (tweb getVersionLink) — узла такого класса у нас не было вовсе.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import MainMenu from './MainMenu'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import { useSettingsStore } from '../settings'
import { applyLang } from '@/test/lang'

// Меню читает реестр аккаунтов при открытии — больше от менеджеров ему ничего не нужно.
const fakeManagers = { auth: { listAccounts: vi.fn(async () => []) } } as unknown as Managers

function mount() {
  return render(
    <ManagersProvider managers={fakeManagers}>
      <MainMenu open onClose={() => {}} onOpenSettings={() => {}} />
    </ManagersProvider>,
  )
}

afterEach(cleanup)

describe('MainMenu — дерево бургер-меню 1:1 с tweb', () => {
  it('разделители групп — <hr>, а не div', () => {
    mount()
    const menu = document.querySelector('.btn-menu')!

    expect(menu.querySelectorAll('hr').length).toBeGreaterThan(0)
  })

  it('пункт «More» — submenu-trigger', () => {
    mount()
    const trigger = document.querySelector('.btn-menu-item.submenu-trigger')

    expect(trigger).not.toBeNull()
    expect(trigger!.querySelector('.submenu-label-text')).not.toBeNull()
  })

  it('подменю раскрывается по наведению и несёт классы tweb', async () => {
    mount()
    const trigger = document.querySelector('.btn-menu-item.submenu-trigger')!

    // Подменю, как и в tweb, собирается по требованию — `createSubmenuTrigger.ts`
    // отдаёт `createMenu` в `floatingButtonMenu.ts`, тот вставляет панель на
    // наведении (:66) и снимает после закрытия (:73). До наведения его нет.
    expect(document.querySelector('.btn-menu-submenu')).toBeNull()

    act(() => { fireEvent.mouseEnter(trigger) })
    const sub = document.querySelector('.btn-menu-submenu')!
    expect(sub).not.toBeNull()
    expect(sub.classList.contains('sidebar-tools-submenu')).toBe(true)
    // `.active` вешается кадром позже (requestAnimationFrame в Menu.tsx)
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })

    expect(document.querySelector('.btn-menu-submenu')!.classList.contains('active')).toBe(true)
  })

  it('у подменю есть футер с версией сборки', () => {
    mount()
    act(() => { fireEvent.mouseEnter(document.querySelector('.btn-menu-item.submenu-trigger')!) })

    const footer = document.querySelector('a.btn-menu-footer')!
    expect(footer).not.toBeNull()
    expect(footer.querySelector('.btn-menu-footer-text')!.textContent).toMatch(/Telegram Web/)
  })
})

// Ночной режим живёт здесь, а не строкой в корне настроек: tweb
// `sidebarLeft/index.ts` `createMoreSubmenu` — ПЕРВЫЙ пункт подменю «Ещё»,
// иконка `darkmode`, подпись по текущей теме (`EnableDarkMode`/`DisableDarkMode`),
// круг перехода темы — из центра иконки пункта (`toggleTheme`).
describe('MainMenu — пункт тёмного режима (tweb createMoreSubmenu)', () => {
  const openMore = () => {
    act(() => { fireEvent.mouseEnter(document.querySelector('.btn-menu-item.submenu-trigger')!) })
    return document.querySelector('.btn-menu-submenu')!.querySelector('.btn-menu-item')!
  }
  const mountWith = (onToggleMode: (c?: { x: number; y: number }) => void) => render(
    <ManagersProvider managers={fakeManagers}>
      <MainMenu open onClose={() => {}} onOpenSettings={() => {}} onToggleMode={onToggleMode} />
    </ManagersProvider>,
  )

  afterEach(() => { useSettingsStore.setState({ themeChoice: 'system' }) })

  it('в светлой теме первый пункт подменю — «Enable Dark Mode»', async () => {
    await applyLang('en')
    useSettingsStore.setState({ themeChoice: 'day' })
    mountWith(() => {})
    expect(openMore().querySelector('.btn-menu-item-text')!.textContent).toBe('Enable Dark Mode')
  })

  it('в тёмной — «Disable Dark Mode»', async () => {
    await applyLang('en')
    useSettingsStore.setState({ themeChoice: 'night' })
    mountWith(() => {})
    expect(openMore().querySelector('.btn-menu-item-text')!.textContent).toBe('Disable Dark Mode')
  })

  it('клик переключает тему с координатами центра иконки пункта', async () => {
    await applyLang('en')
    const toggle = vi.fn()
    mountWith(toggle)
    const item = openMore()
    const icon = item.querySelector<HTMLElement>('.btn-menu-item-icon')!
    icon.getBoundingClientRect = () => ({ left: 10, top: 20, width: 24, height: 30 }) as DOMRect
    fireEvent.click(item)
    expect(toggle).toHaveBeenCalledWith({ x: 22, y: 35 })
  })
})
