// НАХОДКА РЕВЬЮ (Minor, финальное ревью п.6): `clearDeepLinkAddress`
// (`useDeepLinks.ts`) сносит адрес ЦЕЛИКОМ (`overrideAddress(new URL('/', …))`)
// — в том числе хэш уже открытого чата, если диплинк-оверлей (qr/addlist)
// рендерился ПОВЕРХ него. `overrideAddress` синхронизирует ТОЛЬКО внутреннее
// состояние контроллера (`currentHash`/`overriddenHash`), но сам хэш активного
// чата назад в адрес не возвращает — это обязана сделать отдельная
// синхронизация (`syncChatHash()`), которую до фикса никто не звал: хэш
// пропадал из адреса до следующей мутации стека, хотя чат оставался открытым
// (сценарий, который постулирует докблок `overrideAddress` в контроллере).
//
// Пин — сквозной, через реальный хук: рендерим `useDeepLinks`, открываем чат
// (тот же путь, что `App.tsx`: `startChatHistory()` + `selectChat`), зовём
// `cancelQr()` (простейший путь через `clearDeepLinkAddress`, не требующий
// managers) и проверяем, что хэш открытого чата вернулся в адрес.
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ManagersProvider } from './useManagers'
import { useDeepLinks } from './useDeepLinks'
import { startChatHistory } from '../navigation/chatHistory'
import { useChatStackStore } from '../../stores/chatStackStore'
import { useNavigationStore } from '../../stores/navigationStore'
import appNavigationController from '../navigation/appNavigationController'

const flush = async (times = 4) => {
  for (let i = 0; i < times; ++i) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={{} as never}>{children}</ManagersProvider>
)

beforeEach(() => {
  useChatStackStore.getState().clear()
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  location.hash = ''
})

afterEach(() => {
  useChatStackStore.getState().clear()
  appNavigationController.removeByType('im')
  appNavigationController.removeByType('chat')
})

describe('useDeepLinks: clearDeepLinkAddress восстанавливает хэш открытого чата', () => {
  it('cancelQr() (диплинк-оверлей поверх открытого чата) не съедает хэш насовсем', async () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      await flush()
      expect(location.hash).toBe('#42')

      const { result } = renderHook(() => useDeepLinks(() => {}), { wrapper })

      act(() => { result.current.cancelQr() })
      await flush()

      // Без syncChatHash() внутри clearDeepLinkAddress здесь осталось бы ''
      // (адрес зачищен целиком) до следующей мутации стека чатов.
      expect(location.hash).toBe('#42')
    } finally {
      stop()
    }
  })
})
