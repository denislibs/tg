// Пин модификаторов попапов чата (tweb вешает их вторым классом на `.popup`):
//   deleteMessages.ts:182 `PopupPeer('popup-delete-chat')` → .popup.popup-peer.popup-delete-chat
//   pickUser.tsx/forward.tsx `class="popup-forward"`      → .popup.popup-forward
// Дампы: `docs/tweb/dom/dumps/17-popup-03-delete-message.json`,
//        `docs/tweb/dom/dumps/17-popup-01-forward-share.json`.
// К этим классам цепляются партиалы `popups/_peer.scss` и `popups/_forward.scss`.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DeleteMessageDialog, ForwardPicker } from './ChatDialogs'

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
