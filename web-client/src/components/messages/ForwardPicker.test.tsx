// Попап «Поделиться» в tweb собран НЕ из своей вёрстки, а из того же селектора
// пиров, что участники и админы в правой колонке (дамп
// `docs/research/tweb-dom/17-popup-01-forward-share.json`):
//
//   div.popup.popup-forward > div.popup-body
//     div.selector.selector-round.selector-right.selector-multiselect-hidden
//       …selector-search-section
//       div.sidebar-left-section-container.search-group.search-group-contacts   ← «недавние»
//         div.scrollable.scrollable-x.search-group-scrollable-x > ul.chatlist
//       …ul.chatlist со строками чатов
//
// До переноса тело было на своих модульных классах (`s.pickerSearch`,
// `s.recents`, `s.shareRow`), то есть три экрана выбора людей жили тремя
// разными вёрстками. Тест держит именно это: попап несёт свой модификатор,
// а внутри — общий селектор с рядом «недавних» внутри его скроллера.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ForwardPicker } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Dialog } from '../../core/models'

// Аватарки строк резолвятся через useMediaUrl → managers.media — пустой стаб.
const fakeManagers = { media: { downloadMediaURL: vi.fn(async () => '') } } as unknown as Managers

afterEach(cleanup)

const dialogs = [
  { id: 1, type: 'private', peer: { id: 11, displayName: 'Денис' }, unread: 0 },
  { id: 2, type: 'group', title: 'Группа', unread: 0 },
] as unknown as Dialog[]

function mount() {
  return render(
    <ManagersProvider managers={fakeManagers}>
      <ForwardPicker dialogs={dialogs} onPick={() => {}} onClose={() => {}} />
    </ManagersProvider>,
  )
}

describe('ForwardPicker — тело на общем селекторе', () => {
  it('попап несёт модификатор popup-forward', () => {
    mount()

    expect(document.querySelector('.popup.popup-forward')).not.toBeNull()
  })

  it('внутри — селектор с модификаторами формы, стороны и скрытого мультивыбора', () => {
    mount()
    const sel = document.querySelector('.popup-forward .selector')!

    expect(sel).not.toBeNull()
    expect(sel.classList.contains('selector-round')).toBe(true)
    expect(sel.classList.contains('selector-right')).toBe(true)
    expect(sel.classList.contains('selector-multiselect-hidden')).toBe(true)
  })

  it('ряд «недавних» лежит ВНУТРИ скроллера селектора', () => {
    mount()
    const recents = document.querySelector('.search-group.search-group-contacts')!

    expect(recents).not.toBeNull()
    expect(recents.closest('.selector-scrollable')).not.toBeNull()
    expect(recents.querySelector('.scrollable-x.search-group-scrollable-x')).not.toBeNull()
  })

  it('строки чатов — ul.chatlist селектора, а не своя вёрстка', () => {
    mount()

    expect(document.querySelectorAll('.selector .chatlist a.chatlist-chat').length).toBeGreaterThan(0)
  })
})
