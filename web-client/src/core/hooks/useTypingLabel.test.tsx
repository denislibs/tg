// useTypingLabel: печатающий, которого нет в зеркале пиров, не называется —
// порт tweb 50da390c6 (`appImManager.getPeerTyping`).
//
// Имя берётся из зеркала, и для пира, который до вкладки ещё не доехал,
// `getPeerTitle` отдаёт фолбэк «Удалённый аккаунт» — отсюда «Удалённый аккаунт
// печатает» в чатлисте и в шапке. Такие печатающие отбрасываются ДО рендера и
// из счёта тоже, чтобы оставшаяся строка была грамматичной; в личке имени нет
// вовсе (строка — голое «печатает»), и проверка там не делается.
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTypingLabel } from './useTypingLabel'
import { ManagersProvider } from './useManagers'
import { applyPeerOps, resetPeerMirror } from '../peerCache'
import { useChatsStore } from '../../stores/chatsStore'
import { useI18nStore } from '../../i18n'
import type { User } from '../peers/peer'

const GROUP = -100
const MIRA = 11
const OLEG = 12
const UNKNOWN = 13

const user = (id: number, firstName: string): User => ({ _: 'user', id, pFlags: {}, first_name: firstName })
const typing = { _: 'sendMessageTypingAction' } as const

const fillMirror = vi.fn(async () => {})
const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={{ peers: { fillMirror } } as never}>{children}</ManagersProvider>
)

function type(peerId: number, ...userIds: number[]) {
  for (const userId of userIds) useChatsStore.getState().setTyping(peerId, userId, typing, Date.now())
}

const label = (peerId: number, isGroup: boolean) =>
  renderHook(() => useTypingLabel(peerId, isGroup), { wrapper }).result.current

beforeEach(() => {
  useI18nStore.setState({ lang: 'en' })
  applyPeerOps([{ op: 'upsert', peers: [user(MIRA, 'Mira'), user(OLEG, 'Oleg')] }])
})

afterEach(() => {
  useChatsStore.setState({ typing: {} })
  resetPeerMirror()
})

describe('useTypingLabel — печатающий вне зеркала пиров', () => {
  it('один неизвестный — индикатора нет вовсе', () => {
    type(GROUP, UNKNOWN)
    expect(label(GROUP, true)).toEqual({ active: false, label: '', kind: 'text' })
  })

  it('неизвестный + известный — одно имя, а не пара с «Удалённым аккаунтом»', () => {
    type(GROUP, UNKNOWN, MIRA)
    expect(label(GROUP, true).label).toBe('Mira is typing')
  })

  it('неизвестный + двое известных — пара, неизвестный не в счёте', () => {
    type(GROUP, MIRA, UNKNOWN, OLEG)
    expect(label(GROUP, true).label).toBe('Mira and Oleg are typing')
  })

  it('в личке имени нет, и проверка не делается', () => {
    type(UNKNOWN, UNKNOWN)
    expect(label(UNKNOWN, false)).toEqual({ active: true, label: 'is typing', kind: 'text' })
  })

  it('пробел зеркала по-прежнему объявляется — имя придёт, и строка появится', () => {
    type(GROUP, UNKNOWN)
    label(GROUP, true)
    expect(fillMirror).toHaveBeenCalledWith([UNKNOWN])
  })
})
