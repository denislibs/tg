/**
 * ПИН ЗАДАЧИ #112 (пункт 7): Esc над настройками закрывает НАСТРОЙКИ, а не чат.
 *
 * Экран настроек не заводил ни одного слоя навигации, тогда как соседи по
 * колонке заводят (`ContactsView.tsx:25`, `CallsView.tsx:83`). Следствие видел
 * пользователь: Esc проваливался в прежний фолбэк `escFallback` (снят задачей
 * chat-navigation-im-3, см. `core/hotkeys.ts`) и закрывал ЧАТ ПОД настройками —
 * сами настройки при этом оставались открыты.
 *
 * Проверяется через сам контроллер (`core/navigation/appNavigationController`), а не через
 * DOM: слой — это запись в стеке, и «кто снимется по Back» решает он. Тот же
 * приём, что у пинов навигации волны 1.
 *
 * Слоёв ДВА, и второй важен не меньше первого: пока открыт под-экран, Back
 * обязан снять сначала его. Без этого один Esc закрывал бы настройки целиком
 * из любой их глубины.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { ReactNode } from 'react'

import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import appNavigationController from '@core/navigation/appNavigationController'
import SettingsView from './SettingsView'

const makeManagers = (sessions: unknown[] = []) => ({
  peers: { fillMirror: async () => {} },
  media: { downloadMediaURL: async () => undefined },
  sessions: { list: async () => sessions },
} as unknown as Managers)

const managers = makeManagers()

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

const wrapperWith = (m: Managers) => ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={m}>{children}</ManagersProvider>
)

/** Нажатие Back/Esc, дошедшее до стека, — это popstate: его и шлём. */
const pressBack = () => act(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
})

afterEach(() => {
  cleanup()
  // Контроллер — модульный синглтон: недоснятые записи достались бы соседу.
  appNavigationController.spliceItems(0, Infinity)
})

describe('SettingsView — слой навигации', () => {
  it('Back закрывает настройки, а не проваливается в базовый слой (чат)', () => {
    // Запись «чат под экраном» — то, куда Back провалится, если настройки
    // своей записи не завели. Ровно тот отказ, что пин стережёт.
    const base = vi.fn()
    appNavigationController.pushItem({ type: 'chat', onPop: base })
    const onBack = vi.fn()

    render(<SettingsView onBack={onBack} onToggleMode={() => {}} />, { wrapper })

    pressBack()

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(base).not.toHaveBeenCalled()
  })

  it('при открытом под-экране первый Back снимает ЕГО, а настройки остаются', () => {
    const base = vi.fn()
    appNavigationController.pushItem({ type: 'chat', onPop: base })
    const onBack = vi.fn()

    render(<SettingsView onBack={onBack} onToggleMode={() => {}} />, { wrapper })

    // Первая строка списка, у которой есть под-экран (ключ
    // `AccountSettings.Notifications`; язык прогона — английский источник).
    fireEvent.click(screen.getByText('Notifications and Sounds'))

    pressBack()

    // Под-экран закрыт, сами настройки — нет.
    expect(onBack).not.toHaveBeenCalled()
    expect(base).not.toHaveBeenCalled()

    // Второй Back закрывает уже настройки.
    pressBack()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

// ── ПИН ЗАДАЧИ #112 (пункт 5): счётчик устройств ────────────────────────────
//
// Строка «Devices» у оригинала подписана числом активных сессий
// (`sidebarLeft/tabs/settings.tsx:151`, :172-176, показ :248 — `titleRight`);
// у нас подписи не было вовсе. Запрос идёт fire-and-forget: открытие настроек
// его не ждёт, число доезжает следом — поэтому проверяется ОБА состояния, до
// ответа и после.
describe('SettingsView — счётчик устройств', () => {
  it('до ответа подписи нет, после — число сессий', async () => {
    const m = makeManagers([{ hash: 1 }, { hash: 2 }, { hash: 3 }])
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper: wrapperWith(m) })

    // Строка целиком: у неё есть ещё иконка-глиф, поэтому сверяем ПОСЛЕДНИЙ
    // блок (правый слот), а не весь `textContent`.
    const row = screen.getByText('Devices').parentElement!
    const rightSlot = () => row.children[row.children.length - 1].textContent

    // До ответа правым блоком остаётся сама подпись — числа ещё нет.
    expect(rightSlot()).toBe('Devices')

    // Промис менеджера разрешается микрозадачей — даём ей пройти.
    await act(async () => {})

    expect(rightSlot()).toBe('3')
  })

  it('отказ ручки гасится молча — строка просто остаётся без числа', async () => {
    const m = {
      peers: { fillMirror: async () => {} },
      media: { downloadMediaURL: async () => undefined },
      sessions: { list: async () => { throw new Error('нет сети') } },
    } as unknown as Managers

    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper: wrapperWith(m) })
    await act(async () => {})

    const row = screen.getByText('Devices').parentElement!
    expect(row.children[row.children.length - 1].textContent).toBe('Devices')
  })
})

// ── ПИН: один запрос на два входа (порт `getAuthorizationsPromise`) ─────────
//
// Счётчик в строке и открытие вкладки — ДВА потребителя одного списка. У
// оригинала промис мемоизирован (`settings.tsx:150`, :153-165), и клик раньше
// ответа стартового запроса ждёт ТОТ ЖЕ промис, а не шлёт второй. Проверяется
// именно число вызовов ручки: текст на экране от лишнего запроса не меняется,
// поэтому увидеть его можно только так.
describe('SettingsView — список сессий берётся один раз', () => {
  it('стартовый запрос и клик по строке «Devices» делят один вызов ручки', async () => {
    const list = vi.fn(async () => [{ hash: 1 }, { hash: 2 }])
    const m = {
      peers: { fillMirror: async () => {} },
      media: { downloadMediaURL: async () => undefined },
      sessions: { list },
    } as unknown as Managers

    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper: wrapperWith(m) })

    // Клик ДО того, как стартовый запрос успел ответить.
    fireEvent.click(screen.getByText('Devices'))
    await act(async () => {})

    expect(list).toHaveBeenCalledTimes(1)
  })
})
