// Пин модификаторов попапов чата (tweb вешает их вторым классом на `.popup`):
//   deleteMessages.ts:182 `PopupPeer('popup-delete-chat')` → .popup.popup-peer.popup-delete-chat
//   pickUser.tsx/forward.tsx `class="popup-forward"`      → .popup.popup-forward
// Дампы: `docs/tweb/dom/dumps/17-popup-03-delete-message.json`,
//        `docs/tweb/dom/dumps/17-popup-01-forward-share.json`.
// К этим классам цепляются партиалы `popups/_peer.scss` и `popups/_forward.scss`.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DeleteMessageDialog, ForwardPicker, ReactedUsersPopup } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'

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
