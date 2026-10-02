/** @jsxImportSource solid-js */
// Строка «Архив» — порт tweb `components/archiveDialog.tsx` (задача 1-5 волны 7).
// Настоящий custom element и настоящее состояние над зеркалом диалогов
// (`useChatsStore`) и зеркалом пиров; замокана только граница с воркером —
// страница архива владельца (`managers.dialogs.getDialogs`). Закрепление строки
// в списке «Всех чатов» и её снятие на пустом архиве — `autonomousDialogList/dialogs.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { ARCHIVE_FOLDER_ID } from '@core/folderIds'
import type { Dialog } from '@core/models'
import type { DialogsPage } from '@core/managers/dialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import ArchiveDialog, { createArchiveDialogState, type ArchiveDialogManagers, type DisposableArchiveDialogState } from './archiveDialog.solid'

const user = (id: number, first_name = 'U' + id) => ({ _: 'user' as const, id, first_name, pFlags: {} })

function seed(dialogs: Dialog[]) {
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: (1000 - i) * 0x10000 })) }])
}

let page: DialogsPage
let getDialogs: ReturnType<typeof vi.fn<(options: { limit: number, filterId: number }) => Promise<DialogsPage>>>
let managers: ArchiveDialogManagers
let state: DisposableArchiveDialogState | undefined
let onHasArchiveDialogChanged: ReturnType<typeof vi.fn<(has: boolean) => void>>

function mount() {
  state = createArchiveDialogState({ managers, onHasArchiveDialogChanged })
  const element = new ArchiveDialog()
  element.feedProps({ state: state.state })
  document.body.append(element)
  return element
}

const names = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.row-subtitle-row .peer-title')).map((t) => t.textContent)
const subtitleText = (el: HTMLElement) => el.querySelector('.row-subtitle-row > div')!.textContent

beforeEach(() => {
  resetPeerMirror()
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  page = { dialogs: [], count: 0, isEnd: true }
  getDialogs = vi.fn(async () => page)
  managers = { dialogs: { getDialogs }, peers: { fillMirror: async () => {} } }
  onHasArchiveDialogChanged = vi.fn()
})

afterEach(() => {
  document.body.replaceChildren()
  state?.dispose()
  state = undefined
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  resetPeerMirror()
})

describe('ArchiveDialog: разметка tweb', () => {
  it('классы строки, ссылка с фокусом, аватар-иконка и заголовок «Архив»', () => {
    const el = mount()

    expect(el.tagName).toBe('ARCHIVE-DIALOG')
    expect([...el.classList]).toEqual(['row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'chatlist-chat', 'chatlist-chat-bigger', 'row-big'])
    expect(el.getAttribute('role')).toBe('link')
    expect(el.tabIndex).toBe(0)
    expect(el.querySelector('.row-media.row-media-bigger.dialog-avatar .tgico')).not.toBeNull()
    expect(el.querySelector('.row-row.row-title-row')!.textContent).toBe('Archived Chats')
  })

  it('Enter поднимает клик (его ловит список и открывает вкладку), Space — нет', () => {
    const el = mount()
    const onClick = vi.fn()
    el.addEventListener('click', onClick)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onClick).not.toHaveBeenCalled()
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('ArchiveDialog: превью и счётчик', () => {
  it('имена архивных диалогов по индексу через «, », не больше 10, каждое — до 20 символов', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 100 + i)
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(100, 'Очень длинное имя пользователя'), ...ids.slice(1).map((id) => user(id))] }])
    seed([makeDialog({ peerId: 1 }), ...ids.map((peerId) => makeDialog({ peerId, archived: true }))])
    const el = mount()

    const shown = names(el)
    expect(shown).toHaveLength(10)
    expect(shown[0]).toBe('Очень длинное имя по…')
    expect(shown.slice(1, 3)).toEqual(['U101', 'U102'])
    expect(subtitleText(el)).toBe(shown.join(', '))
  })

  it('непрочитанные — жирным, бейдж — число диалогов архива с непрочитанным; без непрочитанного бейджа нет', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(2), user(3), user(4)] }])
    seed([
      makeDialog({ peerId: 2, archived: true, unread: 5 }),
      makeDialog({ peerId: 3, archived: true }),
      makeDialog({ peerId: 4, archived: true, unread: 1 }),
    ])
    const el = mount()

    const titles = Array.from(el.querySelectorAll<HTMLElement>('.row-subtitle-row .peer-title'))
    expect(titles.map((t) => t.className.includes('unreadPeerTitle'))).toEqual([true, false, true])
    const badge = () => el.querySelector<HTMLElement>('.row-subtitle-row > .badge')
    expect(badge()!.classList.contains('badge-22')).toBe(true)
    expect(badge()!.classList.contains('badge-gray')).toBe(true)
    expect(badge()!.textContent).toBe('2')

    useChatsStore.getState().applyDialogOps([
      { op: 'patch', peerId: 2, fields: { unread_count: 0 } },
      { op: 'patch', peerId: 4, fields: { unread_count: 0 } },
    ])
    await vi.waitFor(() => expect(badge()).toBeNull())
  })

  it('превью живёт зеркалом: архивировали — имя появилось, разархивировали — ушло', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(2), user(3)] }])
    seed([makeDialog({ peerId: 2, archived: true }), makeDialog({ peerId: 3 })])
    const el = mount()
    expect(names(el)).toEqual(['U2'])

    useChatsStore.getState().applyDialogOps([{ op: 'patch', peerId: 3, fields: { folder_id: 1 } }])
    await vi.waitFor(() => expect(names(el).sort()).toEqual(['U2', 'U3']))

    useChatsStore.getState().applyDialogOps([{ op: 'patch', peerId: 2, fields: { folder_id: undefined } }])
    await vi.waitFor(() => expect(names(el)).toEqual(['U3']))
  })
})

describe('createArchiveDialogState: показ строки', () => {
  it('до ответа страницы архива строку не показываем; после — по наличию архива, и дальше следим', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(2)] }])
    seed([makeDialog({ peerId: 2, archived: true })])
    state = createArchiveDialogState({ managers, onHasArchiveDialogChanged })
    expect(onHasArchiveDialogChanged).not.toHaveBeenCalled()

    await state.state.ensureHydrated()
    expect(getDialogs).toHaveBeenCalledWith({ filterId: ARCHIVE_FOLDER_ID, limit: 10 })
    expect(onHasArchiveDialogChanged).toHaveBeenLastCalledWith(true)

    useChatsStore.getState().applyDialogOps([{ op: 'remove', peerId: 2 }])
    expect(onHasArchiveDialogChanged).toHaveBeenLastCalledWith(false)
  })

  it('страница — один раз: повторный `ensureHydrated` без запроса', async () => {
    state = createArchiveDialogState({ managers, onHasArchiveDialogChanged })
    await state.state.ensureHydrated()
    expect(state.state.ensureHydrated()).toBeUndefined()
    expect(getDialogs).toHaveBeenCalledTimes(1)
    expect(onHasArchiveDialogChanged).toHaveBeenLastCalledWith(false)
  })
})
