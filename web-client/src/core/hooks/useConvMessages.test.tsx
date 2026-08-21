// src/core/hooks/useConvMessages.test.tsx
//
// Read-model РЕАКТИВНОЙ ленты (живой при выключенном `VITE_VANILLA_FEED`, то
// есть в сегодняшней сборке — основной). Под нормой покрытия здесь одна строка
// проводки: `isMegagroup: isGroup` в вызове `messageToConvMsg`. Её удаление не
// красит ни одного другого теста, но ломает приложение — сообщение от лица
// канала (send-as) в группе уезжает НЕ НА ТУ сторону: `isOurMessage` в
// мегагруппе берёт сырой `pFlags.out` (порт `Chat.isOurMessage`,
// tweb chat.ts:1375-1377), а без объявленного вида чата работает вторая ветка
// (`fromId === myId`), для которой автор-канал зрителем не является.
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ManagersProvider } from './useManagers'
import { useConvMessages } from './useConvMessages'
import type { MessageWindow } from './useMessageWindow'
import type { Managers } from '../../client/bootstrap'
import { makeMessage } from '../messages/testMessage'
import type { MyMessage } from '../models'

const GROUP = -10
const ME = 7

const managers = { peers: { fillMirror: vi.fn(async () => {}) } } as unknown as Managers
const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

const windowOf = (msgs: MyMessage[]) => ({ msgs }) as unknown as MessageWindow

/** Отправка от лица канала: автор на проводе — САМ КАНАЛ, `out` ставит сервер
 *  (`MessageContext.Out`, backend/internal/domain/messagewire.go). */
const sendAs = makeMessage({ id: 1, peerId: GROUP, fromId: -9, out: true, text: 'от канала' })

const convOf = (isGroup: boolean) =>
  renderHook(
    () => useConvMessages({ numericChatId: GROUP, isRealChat: true, isGroup, win: windowOf([sendAs]), meId: ME }),
    { wrapper },
  ).result.current.msgs[0]

describe('useConvMessages — вид чата доезжает до стороны бабла', () => {
  it('в группе send-as исходящий: вид чата объявлен, работает ветка мегагруппы', () => {
    expect(convOf(true).out).toBe(true)
  })

  it('вне группы тот же объект входящий — ветка `fromId === myId`', () => {
    expect(convOf(false).out).toBe(false)
  })
})
