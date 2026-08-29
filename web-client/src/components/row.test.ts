// Порт-тест `tweb/src/components/row.ts` — разметка строки настроек это
// контракт со стилями (`tweb/src/scss/partials/_row.scss`), поэтому проверяем
// именно классы и порядок узлов, а не только текстовое содержимое.
import { describe, expect, it, vi } from 'vitest'
import Row, { RadioFormFromRows } from './row'
import RadioField from './radioField'
import CheckboxField from './checkboxField'
import SidebarSlider from './slider'
import { SliderSuperTabEventable } from './sliderTab'

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

  // Раунд 1 ревью: обе адаптации ниже — места, где наш CheckboxField (нет
  // `.span`) заставил разойтись с буквальным текстом tweb (`!field.span` /
  // `field.checked`) — были без единого теста, значит без пина на регресс.

  it('чекбокс без подписи получает checkbox-field-absolute (tweb :143-148, у нас — querySelector(.checkbox-caption))', () => {
    const withoutCaption = new CheckboxField()
    const row = new Row({ checkboxField: withoutCaption })
    expect(row.container.contains(withoutCaption.label)).toBe(true)
    expect(withoutCaption.label.classList.contains('checkbox-field-absolute')).toBe(true)

    // С подписью (`.checkbox-caption` есть) коробка НЕ абсолютная — иначе она
    // легла бы поверх текста (`_row.scss:379-384` рассчитан именно на пустой label).
    const withCaption = new CheckboxField({ text: 'Подпись' })
    const row2 = new Row({ checkboxField: withCaption })
    expect(row2.container.contains(withCaption.label)).toBe(true)
    expect(withCaption.label.classList.contains('checkbox-field-absolute')).toBe(false)
  })

  it('withCheckboxSubtitle переключает подпись строки по input.checked чекбокса (tweb :152-161, у нас — input.checked вместо .checked)', () => {
    const checkboxField = new CheckboxField()
    const row = new Row({ checkboxField, withCheckboxSubtitle: true })

    // До первого change подпись не выставляется — ни tweb, ни наш порт не
    // вызывают onChange при построении, только подписываются на будущий 'change'.
    expect(row.subtitle.textContent).toBe('')

    checkboxField.input.checked = true
    checkboxField.input.dispatchEvent(new Event('change'))
    expect(row.subtitle.textContent).toBe('Enabled')

    checkboxField.input.checked = false
    checkboxField.input.dispatchEvent(new Event('change'))
    expect(row.subtitle.textContent).toBe('Disabled')
  })

  it('icon добавляет .row-icon и класс .row-with-icon на container (tweb :201-210)', () => {
    const row = new Row({ title: 'Заголовок', icon: 'add' })
    const icon = row.container.querySelector(':scope > .row-icon')
    expect(icon).not.toBeNull()
    expect(row.container.classList.contains('row-with-icon')).toBe(true)
    expect(row.container.classList.contains('row-with-padding')).toBe(true)
  })

  it('rightContent (buttonRight/rightTextContent) уезжает в .row-right, container получает row-grid (tweb :268-284)', () => {
    // buttonRight — настоящая кнопка через Button(), а не голый rightContent.
    const withButton = new Row({ title: 'A', buttonRightLangKey: 'Save' })
    const btn = withButton.container.querySelector(':scope > .row-right')
    expect(btn).not.toBeNull()
    expect(btn!.tagName).toBe('BUTTON')
    expect(withButton.container.classList.contains('row-grid')).toBe(true)
    expect(withButton.buttonRight).toBe(btn)

    // rightTextContent — голый span.row-title-right-secondary, без кнопки.
    const withText = new Row({ title: 'B', rightTextContent: '42' })
    const span = withText.container.querySelector(':scope > .row-right')
    expect(span).not.toBeNull()
    expect(span!.tagName).toBe('SPAN')
    expect(span!.textContent).toBe('42')
    expect(span!.classList.contains('row-title-right-secondary')).toBe(true)
  })

  it('subtitleRight строит .row-subtitle-row с подзаголовком и правой частью рядом (tweb :118-126, симметрично titleRow)', () => {
    const row = new Row({ subtitle: '2 участника', subtitleRight: 'admin' })
    const subtitleRow = row.container.querySelector(':scope > .row-subtitle-row')
    expect(subtitleRow).not.toBeNull()
    expect(subtitleRow!.querySelector('.row-subtitle:not(.row-subtitle-right)')!.textContent).toBe('2 участника')
    expect(subtitleRow!.querySelector('.row-subtitle-right')!.textContent).toBe('admin')
  })

  it('midtitle вставляется классом row-midtitle НЕПОСРЕДСТВЕННО перед subtitle (tweb :332-337)', () => {
    const row = new Row({ subtitle: 'Подзаголовок' })
    const midtitle = row.midtitle
    expect(midtitle.classList.contains('row-midtitle')).toBe(true)
    // insertBefore(midtitle, subtitle) — midtitle обязан идти ПЕРЕД subtitle,
    // а не просто где-то в том же родителе (порядок — грид-контракт
    // `.row-grid.with-midtitle` в _row.scss: title/midtitle/subtitle сверху вниз).
    expect(midtitle.nextElementSibling).toBe(row.subtitle)
  })
})

// `navigationTab` (tweb :216-247) заведена вместе с `SidebarSlider` (задача 5
// волны) — до него типа слайдера не существовало и опция была опущена.
describe('Row — navigationTab', () => {
  function createSlider() {
    const sidebarEl = document.createElement('div')
    const sliderEl = document.createElement('div')
    sliderEl.classList.add('sidebar-slider', 'tabs-container')
    sidebarEl.append(sliderEl)
    document.body.append(sidebarEl)
    return new SidebarSlider({ sidebarEl })
  }

  it('клик по строке открывает вкладку слайдера и отдаёт ей аргументы из getInitArgs', async () => {
    const slider = createSlider()
    const inits: unknown[] = []
    class Tab extends SliderSuperTabEventable {
      override init(payload: unknown) { inits.push(payload) }
    }

    const row = new Row({
      title: 'Devices',
      navigationTab: { constructor: Tab, slider, getInitArgs: () => ({ authorizations: [] }) },
    })
    document.body.append(row.container)

    row.container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(inits).toEqual([{ authorizations: [] }]))
    expect(document.querySelector('.sidebar-slider .tabs-tab')).not.toBeNull()
  })

  it('после разрушения вкладки аргументы готовятся заново — иначе повторное открытие покажет старый снимок', async () => {
    const slider = createSlider()
    const inits: unknown[] = []
    class Tab extends SliderSuperTabEventable {
      override init(payload: unknown) { inits.push(payload) }
    }

    let version = 0
    const row = new Row({
      title: 'Devices',
      navigationTab: { constructor: Tab, slider, getInitArgs: () => ({ version: ++version }) },
    })
    document.body.append(row.container)

    row.container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    const tab = slider.getHistory()[slider.getHistory().length - 1] as Tab

    // Разрушение вкладки — тот самый момент, после которого снимок протух.
    tab.eventListener.dispatchEvent('destroyAfter', Promise.resolve())
    await Promise.resolve()

    row.container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(inits).toHaveLength(2))
    expect(inits).toEqual([{ version: 1 }, { version: 2 }])
  })
})
