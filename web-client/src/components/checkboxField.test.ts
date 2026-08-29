// Разметка порта `components/checkboxField.ts` — сверена с tweb
// `src/components/checkboxField.ts:107-152` (ветка без `toggle`).
// `text`/`checked` — раунд правок 3 плана solid-wave-1 (потребитель:
// `PopupPeer` чекбоксы, `popupPeer.ts`).
import { describe, expect, it } from 'vitest'
import CheckboxField from './checkboxField'

describe('CheckboxField', () => {
  it('label.checkbox-field.checkbox-without-caption > input + .checkbox-box', () => {
    const field = new CheckboxField()

    expect(field.label.tagName).toBe('LABEL')
    expect(field.label.classList.contains('checkbox-field')).toBe(true)
    expect(field.label.classList.contains('checkbox-without-caption')).toBe(true)
    expect(field.label.classList.contains('checkbox-field-round')).toBe(false)

    // порядок детей — tweb :123 (input) и :150 (box)
    expect(field.label.firstElementChild).toBe(field.input)
    expect(field.input.type).toBe('checkbox')
    expect(field.input.classList.contains('checkbox-field-input')).toBe(true)

    const box = field.label.children[1] as HTMLElement
    expect(box.classList.contains('checkbox-box')).toBe(true)
    // tweb :148 — рамка, заливка, галочка именно в этом порядке
    expect(Array.from(box.children).map((c) => c.getAttribute('class'))).toEqual([
      'checkbox-box-border',
      'checkbox-box-background',
      'checkbox-box-check',
    ])
  })

  it('галочка — <use href="#check"> из общего спрайта (tweb :134-140)', () => {
    const field = new CheckboxField()
    const svg = field.label.querySelector('svg.checkbox-box-check')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    const use = svg.firstElementChild!
    expect(use.tagName).toBe('use')
    expect(use.getAttribute('href')).toBe('#check')
    expect(use.getAttribute('x')).toBe('-1')
  })

  it('round → .checkbox-field-round; name → id инпута (tweb :43-45, :59-61)', () => {
    const field = new CheckboxField({ name: '42', round: true })
    expect(field.label.classList.contains('checkbox-field-round')).toBe(true)
    expect(field.input.id).toBe('input-42')
  })

  it('без name id не проставляется', () => {
    expect(new CheckboxField().input.id).toBe('')
  })

  it('text → span.checkbox-caption ПОСЛЕ .checkbox-box, без checkbox-without-caption (tweb :106-114, :151-153)', () => {
    const field = new CheckboxField({ text: 'Also delete for Maya' })

    expect(field.label.classList.contains('checkbox-without-caption')).toBe(false)
    const span = field.label.lastElementChild as HTMLElement
    expect(span.tagName).toBe('SPAN')
    expect(span.classList.contains('checkbox-caption')).toBe(true)
    expect(span.textContent).toBe('Also delete for Maya')
    // порядок: input, box, span (tweb :123, :150, :153)
    expect(Array.from(field.label.children).map((c) => c.tagName)).toEqual(['INPUT', 'DIV', 'SPAN'])
  })

  it('checked:true — input взведён сразу (tweb :64-66)', () => {
    expect(new CheckboxField({ checked: true }).input.checked).toBe(true)
    expect(new CheckboxField().input.checked).toBe(false)
  })
})
