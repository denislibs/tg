// Выход из ⋮ корня настроек — `showLogOutPopup` (мост до 2C-13, tweb
// `popups/logOut.ts`). Пины переехали сюда из `useAuthGate.test.tsx` вместе с
// единственным входом (задача 2-2 волны 7: пункта «Выйти» в бургере у tweb нет,
// выход живёт в ⋮ настроек). Команда — только RPC воркеру: реакцию (экран
// входа, перезагрузку под оставшимся аккаунтом) исполняет обработчик
// `rt:logging_out` в `core/hooks/useAuthGate.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import { showLogOutPopup } from './settingsPopups'

afterEach(() => {
  vi.restoreAllMocks()
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('showLogOutPopup — команда выхода', () => {
  // Успешный логаут без остающихся аккаунтов обязан обойтись БЕЗ перезагрузки —
  // Shell снимается через authed=false от кадра. Поэтому здесь не общая точка
  // `commandThenReload` (она перезагружает при любом исходе).
  it('успех: RPC зовётся один раз, вкладка не перезагружается', async() => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const logout = vi.fn().mockResolvedValue({ switched: false })

    showLogOutPopup({ auth: { logout } } as unknown as Managers)
    await flush()

    expect(logout).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  // Отказ команды (сбой IndexedDB при работе с реестром аккаунтов): исход
  // неизвестен — токен мог быть снят, а мог и нет; reload выводит состояние с
  // диска заново, иначе вкладка осталась бы в интерфейсе вышедшего аккаунта.
  it('отказ: перезагрузка, без unhandled rejection', async() => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const logout = vi.fn().mockRejectedValue(new Error('idb'))

    showLogOutPopup({ auth: { logout } } as unknown as Managers)
    await flush()

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
