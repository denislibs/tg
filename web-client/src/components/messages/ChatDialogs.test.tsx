// Пин модификаторов попапов чата (tweb вешает их вторым классом на `.popup`):
//   deleteMessages.ts:182 `PopupPeer('popup-delete-chat')` → .popup.popup-peer.popup-delete-chat
//   pickUser.tsx/forward.tsx `class="popup-forward"`      → .popup.popup-forward
// Дампы: `docs/tweb/dom/dumps/17-popup-03-delete-message.json`,
//        `docs/tweb/dom/dumps/17-popup-01-forward-share.json`.
// К этим классам цепляются партиалы `popups/_peer.scss` и `popups/_forward.scss`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { DeleteMessageDialog, ForwardPicker, ReactedUsersPopup } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'

// exit-переход (usePopupTransition, ../settings/kit.tsx) держит узел в DOM ещё
// 300мс после setOpen(false) — колбэк владельца (onClose/onDeleteFor…) звучит
// только когда узел реально размонтирован (тот же контракт, что был у
// снесённого `shared/ui/ConfirmPopup`, задача 3 плана solid-wave-1).
const flushExit = () => act(() => new Promise((r) => setTimeout(r, 350)))

const noop = () => {}

describe('ChatDialogs — модификаторы попапов', () => {
  afterEach(cleanup)

  it('DeleteMessageDialog — popup-peer popup-delete-chat', () => {
    render(
      <DeleteMessageDialog
        canRevoke
        chatType="private"
        peerFirstName="Maya"
        onDeleteForEveryone={noop}
        onDeleteForMe={noop}
        onClose={noop}
      />,
    )
    const root = document.querySelector('.popup')!
    expect(root.classList.contains('popup-peer')).toBe(true)
    expect(root.classList.contains('popup-delete-chat')).toBe(true)
    // одна danger-кнопка + авто-Cancel (tweb addCancelButton)
    const buttons = [...document.querySelectorAll('.popup-buttons > button')]
    expect(buttons.map((b) => b.classList.contains('danger'))).toEqual([true, false])
    // revoke в личке — чекбокс, значит контейнер помечен have-checkbox
    expect(document.querySelector('.popup-container')!.classList.contains('have-checkbox')).toBe(true)
  })

  it('ForwardPicker — popup-forward', () => {
    render(<ForwardPicker dialogs={[]} onPick={noop} onClose={noop} />)
    expect(document.querySelector('.popup')!.classList.contains('popup-forward')).toBe(true)
  })
})

describe('DeleteMessageDialog — поведение (самостоятельная React-реализация, задача 3)', () => {
  afterEach(cleanup)

  it('чекбокс НЕ отмечен + Delete — onDeleteForMe, не onDeleteForEveryone', async() => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    render(
      <DeleteMessageDialog
        canRevoke chatType="private" peerFirstName="Maya"
        onDeleteForEveryone={onDeleteForEveryone} onDeleteForMe={onDeleteForMe} onClose={noop}
      />,
    )
    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!.click()
    await flushExit()

    expect(onDeleteForMe).toHaveBeenCalledTimes(1)
    expect(onDeleteForEveryone).not.toHaveBeenCalled()
  })

  it('чекбокс отмечен + Delete — onDeleteForEveryone (revoke)', async() => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    render(
      <DeleteMessageDialog
        canRevoke chatType="private" peerFirstName="Maya"
        onDeleteForEveryone={onDeleteForEveryone} onDeleteForMe={onDeleteForMe} onClose={noop}
      />,
    )
    document.querySelector<HTMLElement>('.checkbox-field-input')!.click()
    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!.click()
    await flushExit()

    expect(onDeleteForEveryone).toHaveBeenCalledTimes(1)
    expect(onDeleteForMe).not.toHaveBeenCalled()
  })

  it('канал — чекбокса нет вовсе, Delete сразу onDeleteForEveryone (tweb overrideRevoke)', async() => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    render(
      <DeleteMessageDialog
        canRevoke chatType="channel"
        onDeleteForEveryone={onDeleteForEveryone} onDeleteForMe={onDeleteForMe} onClose={noop}
      />,
    )
    expect(document.querySelector('.checkbox-field-input')).toBeNull()
    expect(document.querySelector('.popup-container')!.classList.contains('have-checkbox')).toBe(false)

    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!.click()
    await flushExit()

    expect(onDeleteForEveryone).toHaveBeenCalledTimes(1)
    expect(onDeleteForMe).not.toHaveBeenCalled()
  })

  it('Cancel — ни один из delete-колбэков не звучит, звучит только onClose', async() => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    const onClose = vi.fn()
    render(
      <DeleteMessageDialog
        canRevoke chatType="private"
        onDeleteForEveryone={onDeleteForEveryone} onDeleteForMe={onDeleteForMe} onClose={onClose}
      />,
    )
    document.querySelector<HTMLButtonElement>('.popup-buttons > button.primary')!.click()
    await flushExit()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDeleteForEveryone).not.toHaveBeenCalled()
    expect(onDeleteForMe).not.toHaveBeenCalled()
  })

  it('Esc — тот же исход, что Cancel', async() => {
    const onClose = vi.fn()
    render(<DeleteMessageDialog canRevoke onDeleteForEveryone={noop} onDeleteForMe={noop} onClose={onClose} />)

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flushExit()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// «Кто отреагировал / просмотрел» — ОДИН список (порт tweb `PopupReactedList`,
// `popups/reactedList.ts`). Строку просмотревшего от строки реагировавшего
// отличает ОТСУТСТВИЕ реакции: стикер добавляется только `if(reaction)`
// (`reactedList.ts:49-72`). Шапка — два счётчика «глиф + число», как фальшивые
// табы `reactions`/`checks` оригинала (`createFakeReaction`, `:344-361`).
describe('ReactedUsersPopup — объединённый список', () => {
  afterEach(cleanup)

  // Аватарка ряда (`UserAvatar` → `useMediaUrl`) спрашивает менеджеры: без
  // провайдера рендер падает ещё до предмета теста.
  const renderPopup = (rows: { name: string; photoId?: number; emoji?: string }[]) =>
    render(
      <ManagersProvider managers={{ media: { downloadMediaURL: async () => undefined } } as never}>
        <ReactedUsersPopup x={0} y={0} rows={rows} onClose={noop} />
      </ManagersProvider>,
    )

  it('у просмотревшего эмодзи нет, у реагировавшего есть', () => {
    renderPopup([{ name: 'Аня', emoji: '👍' }, { name: 'Боря' }])
    expect(document.body.textContent).toContain('Аня')
    expect(document.body.textContent).toContain('Боря')
    // ровно один эмодзи на два ряда
    expect(document.body.textContent!.split('👍').length - 1).toBe(1)
  })

  it('шапка — два счётчика (реакции + просмотры), каждый со своим глифом', () => {
    renderPopup([{ name: 'Аня', emoji: '👍' }, { name: 'Боря' }, { name: 'Вера' }])
    const glyphs = [...document.querySelectorAll('.tgico')]
    expect(glyphs).toHaveLength(2)
    // 1 реакция, 2 просмотра — числа считаются по САМИМ строкам
    expect(glyphs[0].parentElement!.textContent).toContain('1')
    expect(glyphs[1].parentElement!.textContent).toContain('2')
  })

  it('пустой список — счётчиков нет вовсе', () => {
    renderPopup([])
    expect(document.querySelectorAll('.tgico')).toHaveLength(0)
  })
})
