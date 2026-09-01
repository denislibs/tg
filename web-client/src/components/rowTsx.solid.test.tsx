/** @jsxImportSource solid-js */
/**
 * Тесты порта `rowTsx.solid.tsx` — Solid-версии строки настроек.
 *
 * Главное, ради чего этот компонент вообще устроен через контекст, — ПОРЯДОК
 * ВЫКЛАДКИ: подкомпоненты (`<Row.Title>`, `<Row.Subtitle>`, …) не рисуются на
 * месте своего объявления, а регистрируются в контексте, и разметку строки
 * собирает родитель в СВОЁМ порядке. Без этого разметка зависела бы от того,
 * в каком порядке автор вкладки написал детей, и разъехалась бы с
 * императивным `components/row.ts`, у которого порядок жёсткий.
 *
 * Проверяется поэтому не «узлы есть», а «узлы в порядке строки при обратном
 * порядке в JSX» — это и есть предмет.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import Row from './rowTsx.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

/**
 * Части строки — прямые дети, сверху вниз, то есть порядок выкладки.
 * Именем части берётся её `row-*`-класс: у иконки к нему приклеен ещё `tgico`
 * (`IconTsx` ставит его первым), поэтому ищем нужный класс в списке, а не
 * сравниваем `className` целиком.
 */
const partOrder = (rowEl: HTMLElement) =>
  [...rowEl.children]
    .map((el) => [...el.classList].find((cls) => cls.startsWith('row-')))
    .filter(Boolean)

describe('rowTsx: порядок выкладки задаёт строка, а не JSX', () => {
  it('подпись под заголовком, даже если в разметке написана ПЕРЕД ним', () => {
    const el = mount(() => (
      <Row>
        <Row.Subtitle>снизу</Row.Subtitle>
        <Row.Title>сверху</Row.Title>
      </Row>
    ))

    const row = el.querySelector<HTMLElement>('.row')!
    expect(partOrder(row)).toEqual(['row-title', 'row-subtitle'])
  })

  it('иконка идёт ПОСЛЕ подписи, хотя объявлена первой', () => {
    const el = mount(() => (
      <Row>
        <Row.Icon icon="language" />
        <Row.Title>заголовок</Row.Title>
        <Row.Subtitle>подпись</Row.Subtitle>
      </Row>
    ))

    const row = el.querySelector<HTMLElement>('.row')!
    expect(partOrder(row)).toEqual(['row-title', 'row-subtitle', 'row-icon'])
  })
})

describe('rowTsx: классы строки выводятся из её содержимого', () => {
  it('без подписи строка получает no-subtitle, с подписью — теряет его', () => {
    const withoutSubtitle = mount(() => (
      <Row><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(withoutSubtitle.classList.contains('no-subtitle')).toBe(true)

    dispose?.()
    host?.remove()

    const withSubtitle = mount(() => (
      <Row><Row.Title>a</Row.Title><Row.Subtitle>b</Row.Subtitle></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(withSubtitle.classList.contains('no-subtitle')).toBe(false)
  })

  it('иконка добавляет row-with-icon и отступ, обычная строка — нет', () => {
    const plain = mount(() => (
      <Row><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(plain.classList.contains('row-with-icon')).toBe(false)
    expect(plain.classList.contains('row-with-padding')).toBe(false)

    dispose?.()
    host?.remove()

    const withIcon = mount(() => (
      <Row><Row.Icon icon="language" /><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(withIcon.classList.contains('row-with-icon')).toBe(true)
    expect(withIcon.classList.contains('row-with-padding')).toBe(true)
  })

  // Тег узла у оригинала выбирается по содержимому: строка с чекбоксом обязана
  // быть `<label>`, иначе клик по тексту не переключал бы чекбокс — это
  // нативная связь label→input, а не обработчик.
  it('строка с чекбоксом — это <label>, обычная — <div>', () => {
    const plain = mount(() => (
      <Row><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(plain.tagName).toBe('DIV')

    dispose?.()
    host?.remove()

    const withCheckbox = mount(() => (
      <Row>
        <Row.CheckboxField><input type="checkbox" /></Row.CheckboxField>
        <Row.Title>a</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!
    expect(withCheckbox.tagName).toBe('LABEL')
  })

  it('кликабельная строка получает row-clickable и зовёт обработчик', () => {
    const onClick = vi.fn()
    const row = mount(() => (
      <Row clickable={onClick}><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.classList.contains('row-clickable')).toBe(true)
    row.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('rowTsx: правый слот заголовка', () => {
  it('titleRight кладётся во вложенную строку рядом с заголовком', () => {
    const row = mount(() => (
      <Row>
        <Row.Title titleRight={<span class="right">3</span>}>Устройства</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    // Без правого слота заголовок — один `div.row-title`; с ним появляется
    // обёртка `row-title-row`, внутри которой левая и правая половины.
    const titleRow = row.querySelector('.row-title-row')!
    expect(titleRow).not.toBeNull()
    expect(titleRow.querySelector('.row-title-right .right')?.textContent).toBe('3')
  })
})
