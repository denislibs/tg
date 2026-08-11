// src/core/hooks/useAuthGate.test.tsx
//
// Фикс ревью (Stage 1C.2, Task 1): воркер теперь рассылает rt:me:null всем
// вкладкам сессии на логаут (authManager.logout → onMeChanged), не только
// вкладке-инициатору. Без синхронизации authed соседняя вкладка осталась бы
// authed=true с meId уже null — свои сообщения перестают быть «своими»,
// ломаются send-as и «мои» реакции (хуже, чем раньше, когда вкладка просто
// ничего не знала о чужом логауте). Этот тест пинит точку подключения:
// rt:me:null → setAuthed(false), тем же приёмом, что useChatScroll.test.tsx
// (рендерим настоящий хук через ManagersProvider, шлём событие через
// rootScope.dispatchEventSingle, как это делает реальный насос
// realtimeBridge.ts — см. его докблок про dispatchEventSingle).
import type { ReactNode } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useAuthGate } from './useAuthGate'
import { ManagersProvider } from './useManagers'
import type { Managers } from '../../client/bootstrap'
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'
import type { User } from '../managers/authManager'

// auth.me() зависает нарочно: эффект useAuthGate дёргает его при монтировании
// (confirm()), а этот файл управляет authed вручную через login()/rt:me — не
// хотим, чтобы фоновый confirm() резолвился и переписал состояние теста.
function pendingManagers(): Managers {
  return { auth: { me: () => new Promise<null>(() => {}) } } as unknown as Managers
}

function withManagers(managers: Managers) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers}>{children}</ManagersProvider>
  )
}

describe('useAuthGate: кросс-табовый логаут (rt:me:null → authed=false)', () => {
  afterEach(cleanup)

  it('rt:me:null от воркера сбрасывает authed, даже если эта вкладка не звала logout()', () => {
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(pendingManagers()) })

    act(() => { result.current.login() })
    expect(result.current.authed).toBe(true)

    act(() => { rootScope.dispatchEventSingle(RT.me, null) })
    expect(result.current.authed).toBe(false)
  })

  it('rt:me с пользователем (не логаут) authed не трогает', () => {
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(pendingManagers()) })
    const me: User = {
      id: 1, phone: '+7', username: null, firstName: 'Д', lastName: '', displayName: 'Д',
      bio: '', birthday: null, avatarUrl: '', phoneVisibility: 'contacts', premium: false, emojiStatus: '',
    }

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, me) })
    expect(result.current.authed).toBe(true)
  })

  it('размонтирование снимает подписку — последующий rt:me:null не падает и никого не трогает', () => {
    const { result, unmount } = renderHook(() => useAuthGate(), { wrapper: withManagers(pendingManagers()) })
    act(() => { result.current.login() })
    unmount()
    expect(() => rootScope.dispatchEventSingle(RT.me, null)).not.toThrow()
  })
})
