// Пин модификаторов попапов чата (tweb вешает их вторым классом на `.popup`):
//   deleteMessages.ts:182 `PopupPeer('popup-delete-chat')` → .popup.popup-peer.popup-delete-chat
//   pickUser.tsx/forward.tsx `class="popup-forward"`      → .popup.popup-forward
// Дампы: `docs/tweb/dom/dumps/17-popup-03-delete-message.json`,
//        `docs/tweb/dom/dumps/17-popup-01-forward-share.json`.
// К этим классам цепляются партиалы `popups/_peer.scss` и `popups/_forward.scss`.
//
// `openDeleteMessageDialog` (раунд правок 3) — vanilla-функция поверх
// `PopupPeer`, гоняется НАСТОЯЩИМ классом на реальном DOM (happy-dom), тем же
// приёмом, что `popupPeer.test.ts` — без `render`/React вообще.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { initHotkeys } from '@core/hotkeys'
import type { AvatarManagers } from '@components/avatar'
import { openDeleteMessageDialog, ForwardPicker, ReactedUsersPopup } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'

const noop = () => {}

function mkManagers(): AvatarManagers {
  return { peers: { fillMirror: vi.fn(async() => {}) } }
}

describe('openDeleteMessageDialog — разметка (vanilla PopupPeer)', () => {
  afterEach(() => document.body.replaceChildren())

  it('popup-peer popup-delete-chat, авто-Cancel, have-checkbox, аватар из peerId', () => {
    openDeleteMessageDialog({
      peerId: 1,
      managers: mkManagers(),
      canRevoke: true,
      chatType: 'private',
      peerFirstName: 'Maya',
      onDeleteForEveryone: noop,
      onDeleteForMe: noop,
    })
    const root = document.querySelector('.popup')!
    expect(root.classList.contains('popup-peer')).toBe(true)
    expect(root.classList.contains('popup-delete-chat')).toBe(true)
    // одна danger-кнопка + авто-Cancel (tweb addCancelButton)
    const buttons = [...document.querySelectorAll('.popup-buttons > button')]
    expect(buttons.map((b) => b.classList.contains('danger'))).toEqual([true, false])
    // revoke в личке — чекбокс, значит контейнер помечен have-checkbox
    expect(document.querySelector('.popup-container')!.classList.contains('have-checkbox')).toBe(true)
    // аватар (peer.ts:46-54) — теперь строит сам PopupPeer из peerId
    expect(document.querySelector('.popup-header .avatar')).not.toBeNull()
  })
})

describe('ChatDialogs — модификаторы попапов (React-компоненты)', () => {
  afterEach(cleanup)

  it('ForwardPicker — popup-forward', () => {
    render(<ForwardPicker dialogs={[]} onPick={noop} onClose={noop} />)
    expect(document.querySelector('.popup')!.classList.contains('popup-forward')).toBe(true)
  })
})

describe('openDeleteMessageDialog — поведение (раунд правок 3, PopupPeer напрямую)', () => {
  afterEach(() => document.body.replaceChildren())

  it('чекбокс НЕ отмечен + Delete — onDeleteForMe, не onDeleteForEveryone', () => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true, chatType: 'private', peerFirstName: 'Maya',
      onDeleteForEveryone, onDeleteForMe,
    })
    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onDeleteForMe).toHaveBeenCalledTimes(1)
    expect(onDeleteForEveryone).not.toHaveBeenCalled()
  })

  it('чекбокс отмечен + Delete — onDeleteForEveryone (revoke)', () => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true, chatType: 'private', peerFirstName: 'Maya',
      onDeleteForEveryone, onDeleteForMe,
    })
    document.querySelector<HTMLElement>('.checkbox-field-input')!.click()
    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onDeleteForEveryone).toHaveBeenCalledTimes(1)
    expect(onDeleteForMe).not.toHaveBeenCalled()
  })

  it('канал — чекбокса нет вовсе, Delete сразу onDeleteForEveryone (tweb overrideRevoke)', () => {
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true, chatType: 'channel',
      onDeleteForEveryone, onDeleteForMe,
    })
    expect(document.querySelector('.checkbox-field-input')).toBeNull()
    expect(document.querySelector('.popup-container')!.classList.contains('have-checkbox')).toBe(false)

    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onDeleteForEveryone).toHaveBeenCalledTimes(1)
    expect(onDeleteForMe).not.toHaveBeenCalled()
  })

  it('Cancel — ни один из delete-колбэков не звучит, звучит только onClose', () => {
    vi.useFakeTimers()
    const onDeleteForEveryone = vi.fn()
    const onDeleteForMe = vi.fn()
    const onClose = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true, chatType: 'private',
      onDeleteForEveryone, onDeleteForMe, onClose,
    })
    const buttons = document.querySelectorAll<HTMLButtonElement>('.popup-buttons > button')
    buttons[buttons.length - 1].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    vi.advanceTimersByTime(300) // closeAfterTimeout — 250мс таймер base (popupElement.ts)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDeleteForEveryone).not.toHaveBeenCalled()
    expect(onDeleteForMe).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('Esc — тот же исход, что Cancel', () => {
    vi.useFakeTimers()
    const deactivate = initHotkeys({})
    const onClose = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true,
      onDeleteForEveryone: noop, onDeleteForMe: noop, onClose,
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    vi.advanceTimersByTime(300)

    expect(onClose).toHaveBeenCalledTimes(1)
    deactivate()
    vi.useRealTimers()
  })

  it('реальное удаление НЕ зовёт onClose следом — closeAfterTimeout наступает и на нём, отличаем флагом deleted', () => {
    vi.useFakeTimers()
    const onDeleteForMe = vi.fn()
    const onClose = vi.fn()
    openDeleteMessageDialog({
      peerId: 1, managers: mkManagers(), canRevoke: true,
      onDeleteForEveryone: noop, onDeleteForMe, onClose,
    })

    document.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    vi.advanceTimersByTime(300) // тот же closeAfterTimeout, что реджектит отмену — здесь удаление уже случилось

    expect(onDeleteForMe).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    vi.useRealTimers()
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
