// Селектор людей обязан совпадать с tweb по ДЕРЕВУ, а не «примерно выглядеть»:
// портированный `styles/tweb/_selector.scss` (дословная копия партиала) написан
// ровно на те классы, что рождает `appSelectPeers.ts` + `selectorSearch.ts`.
// Ни один из них не является «нашим» именем — потеряется класс, и правило
// молча перестанет матчиться (сборка и тайпчек этого не ловят).
//
// Эталоны — живые дампы `docs/tweb/dom/dumps/`:
//   `15-right-06-administrators` / `15-right-14-group-members` — правый вариант,
//   `14-left-30-new-group-members` / `-30b-…-selected` — левый вариант с чипами,
//   `15-right-09-removed-users` — пустое состояние.
import { useState, type ReactNode } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render as rtlRender, cleanup, fireEvent } from '@testing-library/react'
import PeerSelector, { type SelectorPeer } from './PeerSelector'
import { ManagersProvider } from '../../../core/hooks/useManagers'
import type { Managers } from '../../../client/bootstrap'

// Уточка пустого состояния — рантайм tlottie (`LottieSticker.tsx`, Этап 2
// плана «один движок lottie»): реальный плеер тянет WASM-воркер и canvas,
// которых под happy-dom нет. Проверяем мы ОБЁРТКУ
// (`.media-sticker-wrapper.selector-empty-placeholder-sticker`), её рендерит
// сам селектор, поэтому плеер здесь лишний.
vi.mock('../../../components/LottieSticker', () => ({ default: () => null }))

// Аватарка ряда идёт в зеркало медиа-URL через `UserAvatar` → `useMediaUrl`;
// от менеджеров селектору больше ничего не нужно.
const fakeManagers = { media: { downloadMediaURL: vi.fn(async () => '') } } as unknown as Managers

const render = (ui: ReactNode) =>
  rtlRender(<ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>)

const peers: SelectorPeer[] = [
  { id: 1, name: 'Alice', subtitle: 'last seen recently' },
  { id: 2, name: 'Bob', subtitle: 'online' },
]

afterEach(cleanup)

describe('PeerSelector — дерево селектора 1:1 с tweb', () => {
  it('корень несёт selector + модификаторы формы и стороны', () => {
    render(<PeerSelector peers={peers} />)

    // appSelectPeers.ts:234-238 — classList.add('selector', 'selector-'+design, 'selector-'+checkboxSide)
    const root = document.querySelector('.selector')
    expect(root).not.toBeNull()
    expect(root!.classList.contains('selector-round')).toBe(true)
    expect(root!.classList.contains('selector-right')).toBe(true)
  })

  it('левый вариант — selector-square selector-left', () => {
    render(<PeerSelector peers={peers} mode="multi" design="square" side="left" selected={[]} onSelectedChange={() => {}} />)

    const root = document.querySelector('.selector')!
    expect(root.classList.contains('selector-square')).toBe(true)
    expect(root.classList.contains('selector-left')).toBe(true)
  })

  it('скроллер, градиент и секция поиска — классы tweb', () => {
    render(<PeerSelector peers={peers} />)

    expect(document.querySelector('.selector > .scrollable.scrollable-y.selector-scrollable')).not.toBeNull()
    expect(document.querySelector('.menu-horizontal-gradient-container.selector-search-gradient-container')).not.toBeNull()
    expect(document.querySelector('.sidebar-left-section-container.selector-search-section-container')).not.toBeNull()
    expect(document.querySelector('.sidebar-left-section.selector-search-section > hr')).not.toBeNull()
    expect(document.querySelector('.selector-search-container > .scrollable.scrollable-y > .selector-search')).not.toBeNull()
    expect(document.querySelector('.selector-height-container')).not.toBeNull()
  })

  it('поле поиска — input-search-input-container/-input, без рамки и focus-эффекта', () => {
    render(<PeerSelector peers={peers} />)

    // selectorSearch.ts:38-49 — noBorder + noFocusEffect + удалённый clearBtn
    const container = document.querySelector('.input-search.selector-search-input-container')
    expect(container).not.toBeNull()
    const input = document.querySelector('input.input-field-input.input-search-input.selector-search-input')
    expect(input).not.toBeNull()
    expect(input!.classList.contains('with-focus-effect')).toBe(false)
    expect(container!.querySelector('.input-field-border')).toBeNull()
  })

  it('строки списка — ul.chatlist > a.row…chatlist-chat', () => {
    render(<PeerSelector peers={peers} />)

    const list = document.querySelector('.selector-list-section-content > ul.chatlist')
    expect(list).not.toBeNull()
    const rows = list!.querySelectorAll('a.chatlist-chat')
    expect(rows.length).toBe(2)
    const row = rows[0]
    for (const cls of ['row', 'no-wrap', 'row-with-padding', 'chatlist-chat-abitbigger']) {
      expect(row.classList.contains(cls)).toBe(true)
    }
    expect(row.getAttribute('data-peer-id')).toBe('1')
    expect(row.querySelector('.row-title.no-wrap.user-title > .peer-title')!.textContent).toBe('Alice')
    expect(row.querySelector('.row-row.row-subtitle-row.dialog-subtitle > .row-subtitle')!.textContent).toBe('last seen recently')
    expect(row.querySelector('.avatar.dialog-avatar.row-media.row-media-abitbigger')).not.toBeNull()
  })

  it('непустой список помечает секцию is-visible, пустой — показывает selector-empty-placeholder', () => {
    const empty = { title: 'SearchEmptyViewTitle', description: 'Search.EmptyQuery' } as const
    const { rerender } = rtlRender(
      <ManagersProvider managers={fakeManagers}><PeerSelector peers={peers} empty={empty} /></ManagersProvider>,
    )

    // appSelectPeers.ts:1026 — is-visible ставится ровно когда список непустой
    const section = document.querySelector('.selector-list-section-container')!
    expect(section.classList.contains('is-visible')).toBe(true)
    expect(document.querySelector('.selector-empty-placeholder')).toBeNull()

    rerender(<ManagersProvider managers={fakeManagers}><PeerSelector peers={[]} empty={empty} /></ManagersProvider>)
    expect(document.querySelector('.selector-list-section-container')!.classList.contains('is-visible')).toBe(false)
    const placeholder = document.querySelector('.selector-empty-placeholder')!
    expect(placeholder).not.toBeNull()
    expect(placeholder.querySelector('.media-sticker-wrapper.selector-empty-placeholder-sticker')).not.toBeNull()
    expect(placeholder.querySelector('.selector-empty-placeholder-title')!.textContent).toBe('No Results')
    expect(placeholder.querySelector('.selector-empty-placeholder-description')!.textContent).toBe('Try searching.')
  })

  it('поиск фильтрует список по имени', () => {
    render(<PeerSelector peers={peers} />)
    const input = document.querySelector<HTMLInputElement>('input.selector-search-input')!

    fireEvent.change(input, { target: { value: 'bo' } })

    const rows = document.querySelectorAll('ul.chatlist > a.chatlist-chat')
    expect(rows.length).toBe(1)
    expect(rows[0].querySelector('.peer-title')!.textContent).toBe('Bob')
  })

  it('single: клик по строке отдаёт пира, чекбоксов нет', () => {
    const picked: number[] = []
    render(<PeerSelector peers={peers} onPick={(p) => picked.push(p.id)} />)

    expect(document.querySelector('a.chatlist-chat .checkbox-field')).toBeNull()
    fireEvent.click(document.querySelectorAll('a.chatlist-chat')[1])
    expect(picked).toEqual([2])
  })

  it('multi: чекбокс в строке, чип выбранного в поле поиска', () => {
    function Host() {
      const [sel, setSel] = useState<number[]>([])
      return <PeerSelector peers={peers} mode="multi" selected={sel} onSelectedChange={setSel} />
    }
    render(<Host />)

    // design=round → CheckboxField({round: true}) (appSelectPeers.ts:1190)
    const checkbox = document.querySelector('a.chatlist-chat label.checkbox-field.checkbox-field-round')
    expect(checkbox).not.toBeNull()
    expect(document.querySelector('.selector-user')).toBeNull()

    fireEvent.click(document.querySelectorAll('a.chatlist-chat')[0])

    // selectorSearch.ts:319-400 — чип: .selector-user(.selector-user-primary)
    //   > .selector-user-avatar-container > .selector-user-avatar + .selector-user-avatar-close
    //   + .selector-user-title
    const chip = document.querySelector('.selector-search > .selector-user')!
    expect(chip).not.toBeNull()
    expect(chip.classList.contains('selector-user-primary')).toBe(true)
    expect(chip.classList.contains('is-last')).toBe(true)
    expect(chip.querySelector('.selector-user-avatar-container > .selector-user-avatar')).not.toBeNull()
    expect(chip.querySelector('.selector-user-avatar-container > .selector-user-avatar-close')).not.toBeNull()
    expect(chip.querySelector('.selector-user-title > .peer-title')!.textContent).toBe('Alice')
    expect(document.querySelector('a.chatlist-chat input.checkbox-field-input')).toHaveProperty('checked', true)

    // клик по чипу снимает выбор (selectorSearch onChipClick → simulateClickEvent строки)
    fireEvent.click(chip)
    expect(document.querySelector('.selector-user')).toBeNull()
  })
})
