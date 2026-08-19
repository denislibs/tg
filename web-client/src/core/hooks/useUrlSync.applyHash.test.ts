// Разбор хэша навигации: ссылка на сообщение обязана И открыть чат, И поставить
// прыжок. Без прыжка ссылка «Copy Message Link» открывала бы просто чат — то
// есть молча теряла бы половину смысла, и никакой тест это бы не поймал.
import { describe, it, expect, beforeEach } from 'vitest'
import { applyHash } from './useUrlSync'
import { useNavigationStore } from '@stores/navigationStore'
import { useChatsStore } from '@stores/chatsStore'
import { useSearchStore } from '@stores/searchStore'
import type { Managers } from '../../client/bootstrap'

// Числовые ветки хэша менеджеров не касаются; ветка @username ходит в
// директорию только когда чата нет в диалогах — в этих кейсах он есть.
const managers = {} as Managers

beforeEach(() => {
  useNavigationStore.getState().selectChat(null)
  useSearchStore.getState().clearPendingJump()
  useChatsStore.setState({ dialogs: [] })
})

describe('applyHash', () => {
  it('#<peerId>/<seq> — открывает чат и ставит прыжок к сообщению', async () => {
    await applyHash('#42/7', managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: 42, seq: 7 })
  })

  it('#@username/<seq> — то же для канала из диалогов', async () => {
    useChatsStore.setState({ dialogs: [{ peerId: -42, username: 'durov' }] as never })

    await applyHash('#@durov/9', managers)

    expect(useNavigationStore.getState().selectedId).toBe('-42')
    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: -42, seq: 9 })
  })

  it('#<peerId> без якоря — чат открывается, прыжка нет', async () => {
    await applyHash('#42', managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toBeNull()
  })

  it('пустой хэш — возврат к списку чатов', async () => {
    useNavigationStore.getState().selectChat('42')

    await applyHash('', managers)

    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  it('нераспознанный хэш навигацию не трогает', async () => {
    useNavigationStore.getState().selectChat('42')

    await applyHash('#не-хэш', managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toBeNull()
  })
})
