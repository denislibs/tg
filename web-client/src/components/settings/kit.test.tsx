// SettingsScreen — стек экранов на слайдере tweb (`tweb components/slider.ts:39-44`
// + `components/transition.ts:23-42`). Проверяем ровно то, что раньше делал
// AnimatePresence: саб-экран приходит соседней вкладкой и доживает в DOM до
// конца обратного слайда.
import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Row, SettingsScreen } from './kit'
import TgIcon from '../TgIcon'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import { glyph } from '@core/tgico-icons'

const noop = () => {}

function Screen({ open }: { open: boolean }) {
  return (
    <SettingsScreen
      title="PrivacySettings"
      onBack={noop}
      sub={open ? <div data-testid="sub">саб</div> : null}
    >
      корень
    </SettingsScreen>
  )
}

describe('SettingsScreen', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('рисует контейнер слайдера с вкладками', () => {
    const { container } = render(<Screen open={false} />)
    const slider = container.querySelector('.tabs-container')
    expect(slider?.getAttribute('data-animation')).toBe('navigation')
    // единственная вкладка активна сразу — первый показ не анимируется
    expect(container.querySelectorAll('.tabs-tab')).toHaveLength(1)
    expect(container.querySelector('.tabs-tab')?.classList.contains('active')).toBe(true)
  })

  it('открывает саб соседней вкладкой и ведёт классы перехода', () => {
    const { container, rerender } = render(<Screen open={false} />)
    act(() => { rerender(<Screen open />) })

    const slider = container.querySelector('.tabs-container')!
    const [own, sub] = Array.from(container.querySelectorAll<HTMLElement>('.tabs-tab'))
    expect(slider.classList.contains('animating')).toBe(true)
    expect(slider.classList.contains('backwards')).toBe(false)
    // приходящая — `active to`, уходящая ещё видима и помечена `from`
    expect(sub.classList.contains('active')).toBe(true)
    expect(sub.classList.contains('to')).toBe(true)
    expect(own.classList.contains('from')).toBe(true)
    expect(own.classList.contains('active')).toBe(true)
  })

  it('держит саб в DOM, пока играет обратный слайд', () => {
    const { container, rerender } = render(<Screen open={false} />)
    act(() => { rerender(<Screen open />) })
    act(() => { vi.advanceTimersByTime(400) })

    act(() => { rerender(<Screen open={false} />) })
    expect(container.querySelector('[data-testid="sub"]')).not.toBeNull()
    expect(container.querySelector('.tabs-container')!.classList.contains('backwards')).toBe(true)

    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('[data-testid="sub"]')).toBeNull()
    expect(container.querySelectorAll('.tabs-tab')).toHaveLength(1)
  })
})

// Row — порт `tweb components/row.ts` на глобальные классы `_row.scss`.
// Пины ниже держат ИМЕННО дерево tweb (эталоны — дампы
// docs/tweb/dom/dumps/15-right-02-edit-channel, …-12-edit-group,
// …-13-group-permissions, 07-right-sidebar): у собственных CSS-модулей
// имена хешируются, поэтому «переименовали класс — молча отвалилась вся
// портированная геометрия» ловится только таким пином.
describe('Row — разметка tweb', () => {
  const row = (c: HTMLElement) => c.querySelector<HTMLElement>('.row')!

  it('простая строка: div.row.no-subtitle > div.row-title', () => {
    const { container } = render(<Row label="Encryption Key" translate={false} />)
    const r = row(container)
    expect(r.tagName).toBe('DIV')
    expect(r.classList.contains('no-subtitle')).toBe(true)
    // некликабельная — без ripple-классов и без узла .c-ripple
    expect(r.classList.contains('row-clickable')).toBe(false)
    expect(r.classList.contains('rp')).toBe(false)
    expect(r.querySelector('.c-ripple')).toBeNull()
    expect(r.querySelector('.row-title')!.textContent).toBe('Encryption Key')
    expect(r.querySelector('.row-row')).toBeNull()
  })

  it('подпись снимает no-subtitle и приходит div.row-subtitle', () => {
    const { container } = render(<Row label="+7 707" sublabel="Phone" translate={false} />)
    const r = row(container)
    expect(r.classList.contains('no-subtitle')).toBe(false)
    expect(r.querySelector('.row-subtitle')!.textContent).toBe('Phone')
  })

  it('кликабельная получает row-clickable/hover-effect/rp и узел .c-ripple ПЕРВЫМ', () => {
    const { container } = render(<Row label="Invite Links" translate={false} onClick={() => {}} />)
    const r = row(container)
    expect(r.classList.contains('row-clickable')).toBe(true)
    expect(r.classList.contains('hover-effect')).toBe(true)
    expect(r.classList.contains('rp')).toBe(true)
    expect(r.firstElementChild!.className).toBe('c-ripple')
  })

  it('иконка — цветная плашка span.row-icon.row-icon-colored, глиф внутри (tweb 2197fee9c) + row-with-icon/row-with-padding', () => {
    const { container } = render(
      <Row icon={<TgIcon name="link_filled" size={24} color="var(--primary-color)" />} label="Invite Links" translate={false} />,
    )
    const r = row(container)
    expect(r.classList.contains('row-with-icon')).toBe(true)
    expect(r.classList.contains('row-with-padding')).toBe(true)
    const plate = r.querySelector<HTMLElement>(':scope > .row-icon')!
    expect(plate.tagName).toBe('SPAN')
    expect(plate.classList.contains('tgico')).toBe(false)
    expect(plate.classList.contains('row-icon-colored')).toBe(true)
    expect(plate.style.backgroundImage).toBe(getRowIconBackgroundImage('link_filled'))
    const glyphEl = plate.firstElementChild as HTMLElement
    expect(glyphEl.className).toBe('tgico row-icon-icon')
    expect(glyphEl.textContent).toBe(glyph('link_filled'))
    // Кегль и цвет глифа — от плашки (`.row-icon` 1.5rem, `.row-icon-colored` #fff):
    // инлайн TgIcon их не перебивает.
    expect(glyphEl.style.color).toBe('')
    expect(glyphEl.style.fontSize).toBe('inherit')
  })

  it('не-глиф в слоте иконки (аватар, чекбокс, эмодзи) плашки не получает', () => {
    const { container } = render(
      <Row icon={<span className="reaction-emoji">👍</span>} label="Like" translate={false} />,
    )
    const icon = row(container).querySelector<HTMLElement>('.row-icon')!
    expect(icon.className).toBe('row-icon reaction-emoji')
    expect(icon.style.backgroundImage).toBe('')
  })

  it('accent/danger (у tweb это Button btn-primary btn-transparent, не Row) — глиф без плашки', () => {
    for (const flag of [{ accent: true }, { danger: true }]) {
      const { container, unmount } = render(
        <Row icon={<TgIcon name="delete" />} label="Delete" translate={false} {...flag} />,
      )
      const icon = row(container).querySelector<HTMLElement>('.row-icon')!
      expect(icon.classList.contains('tgico')).toBe(true)
      expect(icon.classList.contains('row-icon-colored')).toBe(false)
      expect(icon.style.backgroundImage).toBe('')
      unmount()
    }
  })

  it('свои поля строки — с классами row-* (tweb 803f9599d): чекбокс и тумблер', () => {
    const { container, unmount } = render(<Row label="History" translate={false} checkbox checked />)
    const cb = row(container).querySelector<HTMLElement>('.checkbox-field')!
    expect(cb.classList.contains('row-checkbox-field')).toBe(true)
    expect(cb.classList.contains('row-checkbox-field-toggle')).toBe(false)
    unmount()

    const { container: c2 } = render(<Row label="Sound" translate={false} toggle checked />)
    const toggle = row(c2).querySelector<HTMLElement>('.checkbox-field-toggle')!
    expect(toggle.classList.contains('row-checkbox-field')).toBe(false) // отступление, rowFieldClasses.ts
    expect(toggle.classList.contains('row-checkbox-field-toggle')).toBe(true)
  })

  it('onClick получает событие (координаты — для перехода темы)', () => {
    const onClick = vi.fn()
    const { container } = render(<Row label="Night" translate={false} onClick={onClick} />)
    row(container).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 7, clientY: 9 }))
    expect(onClick.mock.calls[0][0].clientX).toBe(7)
  })

  it('className доклеивается к строке', () => {
    const { container } = render(<Row label="A" translate={false} className="is-active" />)
    expect(row(container).classList.contains('is-active')).toBe(true)
  })

  it('value → row-row.row-title-row > row-title + row-title.row-title-right.row-title-right-secondary', () => {
    const { container } = render(<Row label="Group Type" value="Private" translate={false} />)
    const titleRow = row(container).querySelector<HTMLElement>('.row-row')!
    expect(titleRow.classList.contains('row-title-row')).toBe(true)
    const [title, right] = Array.from(titleRow.children) as HTMLElement[]
    expect(title.className).toBe('row-title')
    expect(title.textContent).toBe('Group Type')
    expect(right.classList.contains('row-title')).toBe(true)
    expect(right.classList.contains('row-title-right')).toBe(true)
    expect(right.classList.contains('row-title-right-secondary')).toBe(true)
    expect(right.textContent).toBe('Private')
  })

  it('toggle → label.row.row-with-toggle, а тумблер лежит в row-title-right', () => {
    const { container } = render(<Row label="Notifications" translate={false} toggle checked />)
    const r = row(container)
    expect(r.tagName).toBe('LABEL')
    expect(r.classList.contains('row-with-toggle')).toBe(true)
    // без иконки тумблерная строка padding'а НЕ получает (tweb havePadding)
    expect(r.classList.contains('row-with-padding')).toBe(false)
    const right = r.querySelector<HTMLElement>('.row-title-right')!
    // вторичным текстом правый блок тумблера не красится
    expect(right.classList.contains('row-title-right-secondary')).toBe(false)
    expect(right.querySelector('.checkbox-field-toggle')).not.toBeNull()
  })

  it('restriction докладывает тумблеру checkbox-field-toggle-restriction', () => {
    const { container } = render(<Row label="Send Messages" translate={false} toggle restriction />)
    expect(
      container.querySelector('.checkbox-field-toggle')!.classList.contains('checkbox-field-toggle-restriction'),
    ).toBe(true)
  })

  it('checkbox → label.row.row-with-padding + отдельный label.checkbox-field с box (НЕ тумблер)', () => {
    const { container } = render(
      <Row label="Chat history for new members" translate={false} checkbox checked />,
    )
    const r = row(container)
    expect(r.tagName).toBe('LABEL')
    expect(r.classList.contains('row-with-padding')).toBe(true)
    expect(r.classList.contains('row-with-toggle')).toBe(false)
    // чекбокс — ребёнок САМОЙ строки, а не правого блока заголовка
    const box = r.querySelector<HTMLElement>(':scope > .checkbox-field')!
    expect(box.classList.contains('checkbox-field-absolute')).toBe(true)
    expect(box.classList.contains('checkbox-field-toggle')).toBe(false)
    expect(box.querySelector('.checkbox-box > .checkbox-box-border')).not.toBeNull()
    expect(box.querySelector('.checkbox-box > .checkbox-box-background')).not.toBeNull()
    expect(box.querySelector('svg.checkbox-box-check')).not.toBeNull()
    expect(box.querySelector<HTMLInputElement>('input.checkbox-field-input')!.checked).toBe(true)
  })

  it('danger/accent — классы tweb .danger/.primary, а не инлайновый цвет', () => {
    const { container: a } = render(<Row label="Leave Group" translate={false} danger />)
    expect(row(a).classList.contains('danger')).toBe(true)
    const { container: b } = render(<Row label="Add Members" translate={false} accent />)
    expect(row(b).classList.contains('primary')).toBe(true)
  })
})
