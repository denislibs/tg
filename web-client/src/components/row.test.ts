// Порт-тест `tweb/src/components/row.ts` — разметка строки настроек это
// контракт со стилями (`tweb/src/scss/partials/_row.scss`), поэтому проверяем
// именно классы и порядок узлов, а не только текстовое содержимое.
import { describe, expect, it } from 'vitest'
import Row, { RadioFormFromRows } from './row'
import RadioField from './radioField'

describe('Row', () => {
  it('строит заголовок, подзаголовок и правую часть в разметке tweb', () => {
    const row = new Row({
      title: 'Telegram Web 1.0',
      subtitle: '127.0.0.1 - Россия',
      titleRight: 'вчера',
      clickable: true,
    })

    expect(row.container.classList.contains('row')).toBe(true)
    expect(row.container.classList.contains('no-subtitle')).toBe(false)
    expect(row.container.querySelector('.row-title')!.textContent).toBe('Telegram Web 1.0')
    expect(row.container.querySelector('.row-subtitle')!.textContent).toBe('127.0.0.1 - Россия')
    expect(row.container.querySelector('.row-title-right')!.textContent).toBe('вчера')
    expect(row.container.classList.contains('row-clickable')).toBe(true)
  })

  it('без подзаголовка держит класс no-subtitle', () => {
    const row = new Row({ title: 'Только заголовок' })
    expect(row.container.classList.contains('no-subtitle')).toBe(true)
  })

  it('заголовок с titleRight переносится в отдельную row-title-row (tweb :168-199)', () => {
    // Без titleRight заголовок — прямой потомок container (`c = this.container`);
    // с titleRight — заголовок и правая часть уезжают в общий `.row-title-row`.
    // Тест ловит перепутанные ветки `c`/`this.container`.
    const row = new Row({ title: 'Заголовок', titleRight: 'right' })
    const titleRow = row.container.querySelector(':scope > .row-title-row')
    expect(titleRow).not.toBeNull()
    expect(titleRow!.querySelector('.row-title')!.textContent).toBe('Заголовок')
    expect(titleRow!.querySelector('.row-title-right')!.textContent).toBe('right')
  })

  it('radioField встраивается в container и получает disable-hover', () => {
    const radioField = new RadioField({ text: 'Вариант', name: 'g1', value: 'a' })
    const row = new Row({ radioField })

    expect(row.container.contains(radioField.label)).toBe(true)
    expect(radioField.label.classList.contains('disable-hover')).toBe(true)
    expect(row.container.classList.contains('row-with-padding')).toBe(true)
  })

  it('RadioFormFromRows кладёт container каждой строки в форму и зовёт onChange только для отмеченного input', () => {
    const rows = [
      new Row({ radioField: new RadioField({ text: 'A', name: 'grp', value: 'a' }) }),
      new Row({ radioField: new RadioField({ text: 'B', name: 'grp', value: 'b' }) }),
    ]
    const values: string[] = []
    const form = RadioFormFromRows(rows, (value) => values.push(value))

    // row.ts:391 передаёт в RadioForm именно `r.container`/`r.radioField.input` —
    // перепутанная пара молча собрала бы форму без чужих узлов или без слушателя.
    expect(form.contains(rows[0].container)).toBe(true)
    expect(form.contains(rows[1].container)).toBe(true)

    // radioForm.ts зовёт onChange только когда `input.checked` — сняли отметку
    // и всё равно дёрнули change, колбэк молчит.
    rows[0].radioField.input.dispatchEvent(new Event('change'))
    expect(values).toEqual([])

    rows[1].radioField.input.checked = true
    rows[1].radioField.input.dispatchEvent(new Event('change'))
    expect(values).toEqual(['b'])
  })
})
