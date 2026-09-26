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
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import Row, { createRowTitle } from './rowTsx.solid'
import { RADIO_FIELD_RIGHT_CLASS } from './rowFieldClasses'
import contextMenuController from '@helpers/contextMenuController'
import { getIconContent } from './icon'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  contextMenuController.close()
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

// Порт tweb `src/tests/rowIcon.test.tsx` (tweb 2197fee9c → HEAD): иконка строки —
// отдельный контейнер-плашка с градиентом, глиф внутри.
describe('Row.Icon — цветная плашка', () => {
  it('renders a registered icon inside a separate gradient container', () => {
    const container = mount(() => (
      <Row><Row.Icon icon="data_filled" /><Row.Title>Data</Row.Title></Row>
    )).querySelector<HTMLElement>('.row-icon')!
    const icon = container.firstElementChild!

    expect(container.classList.contains('row-icon-colored')).toBe(true)
    expect(container.classList.contains('tgico')).toBe(false)
    expect(container.style.backgroundImage).toBe(getRowIconBackgroundImage('data_filled'))
    expect(icon.classList.contains('row-icon-icon')).toBe(true)
    expect(icon.classList.contains('tgico')).toBe(true)
  })

  it('uses a deterministic fallback background when no color is supplied', () => {
    const container = mount(() => (
      <Row><Row.Icon icon="data" /><Row.Title>Data</Row.Title></Row>
    )).querySelector<HTMLElement>('.row-icon')!

    expect(container.classList.contains('row-icon-colored')).toBe(true)
    expect(container.getAttribute('style')).toContain('linear-gradient')
    expect(container.firstElementChild!.textContent).toBe(getIconContent('data'))
  })

  it('noBackground — класс остаётся, градиента нет (tweb HEAD rowTsx.tsx:401-420)', () => {
    const container = mount(() => (
      <Row><Row.Icon icon="stop" class="danger" noBackground /><Row.Title>Stop</Row.Title></Row>
    )).querySelector<HTMLElement>('.row-icon')!
    expect(container.className).toBe('row-icon row-icon-colored danger')
    expect(container.style.backgroundImage).toBe('')
  })
})

// tweb 803f9599d (`rowTsx.tsx` `registerRowField` + `rowFieldClasses.ts`): поле,
// зарегистрированное через Row, получает класс строки — `_row.scss` раскладывает
// только свои поля, а не любой чекбокс внутри строки.
describe('поля строки метятся классами row-*', () => {
  it('CheckboxField → row-checkbox-field, RadioField → row-radio-field, Toggle → row-checkbox-field-toggle', () => {
    const h = mount(() => (
      <div>
        <Row><Row.CheckboxField><label class="checkbox-field" data-f="cb" /></Row.CheckboxField><Row.Title>a</Row.Title></Row>
        <Row><Row.RadioField><label class="radio-field" data-f="radio" /></Row.RadioField><Row.Title>b</Row.Title></Row>
        <Row><Row.CheckboxFieldToggle><label class="checkbox-field checkbox-field-toggle" data-f="toggle" /></Row.CheckboxFieldToggle><Row.Title>c</Row.Title></Row>
      </div>
    ))
    const f = (k: string) => h.querySelector<HTMLElement>(`[data-f="${k}"]`)!.classList
    expect(f('cb').contains('row-checkbox-field')).toBe(true)
    expect(f('cb').contains('row-checkbox-field-toggle')).toBe(false)
    expect(f('radio').contains('row-radio-field')).toBe(true)
    expect(f('toggle').contains('row-checkbox-field')).toBe(false) // как у tweb HEAD (ef41b29db, rowTsx.tsx:482-492)
    expect(f('toggle').contains('row-checkbox-field-toggle')).toBe(true)
  })
})

// ── Задача 0 волны 2D: `Row` на tweb HEAD (`rowTsx.tsx`, 812502980) ──────────

/** Прогнать отложенную работу (`createContextMenu.open` асинхронен: фильтр пунктов, `ButtonMenu`). */
const settle = async () => {
  for(let i = 0; i < 4; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Клик «от пользователя»: `isTrusted` у синтетики happy-dom всегда false, а
 *  `hasMouseMovedSinceDown` смотрит только на доверенные клики. */
function trustedClick(target: HTMLElement, detail = 1) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail })
  Object.defineProperty(event, 'isTrusted', { value: true })
  target.dispatchEvent(event)
}

// tweb `:106-113`, `:235`, `:254-256`, `:340-342`.
describe('toggleAside: тумблер при подписи уезжает в правую колонку', () => {
  it('тумблер + заголовок + подпись → тумблер в div.row-right, у строки row-grid, в заголовке его нет', () => {
    const row = mount(() => (
      <Row>
        <Row.CheckboxFieldToggle><label class="checkbox-field checkbox-field-toggle" data-f="toggle" /></Row.CheckboxFieldToggle>
        <Row.Title>Заголовок</Row.Title>
        <Row.Subtitle>Подпись</Row.Subtitle>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    const toggle = row.querySelector<HTMLElement>('[data-f="toggle"]')!
    expect(toggle.parentElement!.classList.contains('row-right')).toBe(true)
    expect(toggle.parentElement!.parentElement).toBe(row)
    expect(row.classList.contains('row-grid')).toBe(true)
    expect(row.querySelector('.row-title-row')).toBeNull()
    // `div.row-right` идёт после подписи — порядок выкладки `:246-256`
    expect(partOrder(row)).toEqual(['row-title', 'row-subtitle', 'row-right'])
  })

  it('без подписи тумблер остаётся в правой части заголовка, row-grid нет', () => {
    const row = mount(() => (
      <Row>
        <Row.CheckboxFieldToggle><label class="checkbox-field checkbox-field-toggle" data-f="toggle" /></Row.CheckboxFieldToggle>
        <Row.Title>Заголовок</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.querySelector('[data-f="toggle"]')!.parentElement!.classList.contains('row-title-right')).toBe(true)
    expect(row.querySelector('.row-right')).toBeNull()
    expect(row.classList.contains('row-grid')).toBe(false)
  })

  it('со своим RightContent тумблер тоже остаётся в заголовке — колонка занята', () => {
    const row = mount(() => (
      <Row>
        <Row.CheckboxFieldToggle><label class="checkbox-field checkbox-field-toggle" data-f="toggle" /></Row.CheckboxFieldToggle>
        <Row.Title>Заголовок</Row.Title>
        <Row.Subtitle>Подпись</Row.Subtitle>
        <Row.RightContent><span data-action>…</span></Row.RightContent>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.querySelector('[data-f="toggle"]')!.parentElement!.classList.contains('row-title-right')).toBe(true)
    expect(row.querySelectorAll('.row-right')).toHaveLength(1)
    expect(row.querySelector('.row-right [data-f="toggle"]')).toBeNull()
  })
})

// Порт tweb `src/tests/rowIcon.test.tsx` `describe('Row.RadioField')` (812502980):
// радио с `radio-field-right` регистрируется как `radioFieldRight` (`:454-468`)
// и уезжает в правую часть заголовка (`:338-362`).
describe('Row.RadioField: радио справа', () => {
  it('радио с radio-field-right встаёт в .row-title-right, а не в корень строки', () => {
    const el = mount(() => (
      <Row>
        <Row.Title>Choice</Row.Title>
        <Row.Subtitle>Description</Row.Subtitle>
        <Row.RadioField>
          <label class={RADIO_FIELD_RIGHT_CLASS} data-radio="right">
            <span class="radio-field-main" />
          </label>
        </Row.RadioField>
      </Row>
    ))

    const row = el.querySelector('.row')!
    const radio = el.querySelector('[data-radio="right"]')!
    const titleRight = el.querySelector('.row-title-right')

    expect(radio.parentElement).toBe(titleRight)
    expect(radio.parentElement).not.toBe(row)
    expect(row.classList.contains('row-with-padding')).toBe(false)
    expect(row.querySelector('.row-right')).toBeNull()
    // радио справа — всё равно поле строки: тег label и класс поля
    expect(row.tagName).toBe('LABEL')
    expect(radio.classList.contains('row-radio-field')).toBe(true)
  })

  it('titleRight рядом с радио справа → row-title-right-with-control', () => {
    const el = mount(() => (
      <Row>
        <Row.Title titleRight={<span data-title-right>Details</span>}>Choice</Row.Title>
        <Row.RadioField>
          <label class={RADIO_FIELD_RIGHT_CLASS} data-radio="right">
            <span class="radio-field-main" />
          </label>
        </Row.RadioField>
      </Row>
    ))

    const titleRight = el.querySelector('.row-title-right')!
    const radio = el.querySelector('[data-radio="right"]')!

    expect(titleRight.querySelector('[data-title-right]')).not.toBeNull()
    expect(radio.parentElement).toBe(titleRight)
    expect(titleRight.classList.contains('row-title-right-with-control')).toBe(true)
  })

  it('при Row.RightContent обёртка заголовка остаётся в своей ячейке грида', () => {
    const el = mount(() => (
      <Row>
        <Row.Title titleRight={<span data-grid-title-right>Details</span>}>Choice</Row.Title>
        <Row.Subtitle>Description</Row.Subtitle>
        <Row.RadioField>
          <label class={RADIO_FIELD_RIGHT_CLASS} data-radio="right">
            <span class="radio-field-main" />
          </label>
        </Row.RadioField>
        <Row.RightContent data-row-action>Action</Row.RightContent>
      </Row>
    ))

    const row = el.querySelector('.row')!
    const titleRow = el.querySelector('.row-title-row')!

    expect(row.classList.contains('row-grid')).toBe(true)
    expect(titleRow.parentElement).toBe(row)
    expect(titleRow.querySelector('[data-grid-title-right]')).not.toBeNull()
    expect(titleRow.querySelector('[data-radio="right"]')).not.toBeNull()
    expect(row.querySelector(':scope > [data-row-action]')).not.toBeNull()
  })

  it('обычное радио остаётся в корне строки с левым отступом', () => {
    const el = mount(() => (
      <Row>
        <Row.Title>Choice</Row.Title>
        <Row.RadioField>
          <label data-radio="left">
            <span class="radio-field-main" />
          </label>
        </Row.RadioField>
      </Row>
    ))

    const row = el.querySelector('.row')!
    expect(el.querySelector('[data-radio="left"]')!.parentElement).toBe(row)
    expect(row.classList.contains('row-with-padding')).toBe(true)
    expect(row.querySelector('.row-title-right')).toBeNull()
  })
})

// tweb `:96-97`, `:179-204`, `:215`, `:122`.
describe('contextMenu: строка-«селект» открывает меню', () => {
  it('без clickable клик открывает меню, строка кликабельна; openContextMenuRef получает и снимает open', async () => {
    const onItem = vi.fn()
    const refs: unknown[] = []
    const row = mount(() => (
      <Row
        contextMenu={{ buttons: [{ icon: 'copy', regularText: 'Пункт', onClick: onItem }] }}
        openContextMenuRef={(open) => refs.push(open)}
      >
        <Row.Title>Селект</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.classList.contains('row-clickable')).toBe(true)
    expect(typeof refs[0]).toBe('function')

    row.click()
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('Пункт')
    expect(row.classList.contains('menu-open')).toBe(true)

    dispose?.()
    dispose = undefined
    expect(refs[refs.length - 1]).toBeUndefined()
  })

  it('правый клик по строке тоже открывает меню (listenTo — сама строка)', async () => {
    const row = mount(() => (
      <Row contextMenu={{ buttons: [{ icon: 'copy', regularText: 'Пункт', onClick: () => {} }] }}>
        <Row.Title>Селект</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    expect(document.querySelector('.btn-menu.contextmenu.active')).not.toBeNull()
  })

  it('с функцией clickable клик зовёт её, а меню не открывает', async () => {
    const onClick = vi.fn()
    const row = mount(() => (
      <Row clickable={onClick} contextMenu={{ buttons: [{ icon: 'copy', regularText: 'Пункт', onClick: () => {} }] }}>
        <Row.Title>Строка</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    row.click()
    await settle()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.btn-menu.contextmenu.active')).toBeNull()
  })
})

// tweb `:205-216`.
describe('onClick: disabled и «уехавшая» мышь гасят клик', () => {
  it('disabled — clickable не зовётся; aria-disabled — тоже', () => {
    const onClick = vi.fn()
    const el = mount(() => (
      <div>
        <Row clickable={onClick} disabled><Row.Title>a</Row.Title></Row>
        <Row clickable={onClick} aria-disabled><Row.Title>b</Row.Title></Row>
      </div>
    ))
    el.querySelectorAll<HTMLElement>('.row').forEach((row) => row.click())
    expect(onClick).not.toHaveBeenCalled()
    expect(el.querySelector('.row')!.classList.contains('is-disabled')).toBe(true)
    expect(el.querySelector('.row')!.getAttribute('aria-disabled')).toBe('true')
  })

  it('клик после смещения мыши (mousedown на другом узле) — не зовётся; на том же узле — зовётся', () => {
    const onClick = vi.fn()
    const el = mount(() => (
      <Row clickable={onClick} noRipple><Row.Title>a</Row.Title><Row.Subtitle>b</Row.Subtitle></Row>
    ))
    const title = el.querySelector<HTMLElement>('.row-title')!
    const subtitle = el.querySelector<HTMLElement>('.row-subtitle')!

    subtitle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trustedClick(title)
    expect(onClick).not.toHaveBeenCalled()

    title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trustedClick(title)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// a11y из 472e3e76b: tweb `:116-164`, `:222-225`, `:243`, `:260`.
describe('доступность строки', () => {
  it('кликабельная строка без поля — role="button", tabindex="0", Enter и Space жмут её', () => {
    const onClick = vi.fn()
    const row = mount(() => (
      <Row clickable={onClick}><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('выключенная кликабельная строка — tabindex="-1"; некликабельная — без role и tabindex', () => {
    const el = mount(() => (
      <div>
        <Row clickable={() => {}} disabled><Row.Title>a</Row.Title></Row>
        <Row><Row.Title>b</Row.Title></Row>
      </div>
    ))
    const [disabled, plain] = el.querySelectorAll<HTMLElement>('.row')
    expect(disabled.getAttribute('tabindex')).toBe('-1')
    expect(plain.hasAttribute('role')).toBe(false)
    expect(plain.hasAttribute('tabindex')).toBe(false)
  })

  it('строка с тумблером — label без role, input подписан заголовком (aria-labelledby = id .row-title)', () => {
    const row = mount(() => (
      <Row>
        <Row.CheckboxFieldToggle>
          <span class="checkbox-field checkbox-field-toggle"><input type="checkbox" /></span>
        </Row.CheckboxFieldToggle>
        <Row.Title>Уведомления</Row.Title>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    const title = row.querySelector<HTMLElement>('.row-title')!
    const input = row.querySelector<HTMLInputElement>('input')!
    expect(row.tagName).toBe('LABEL')
    expect(row.hasAttribute('role')).toBe(false)
    expect(title.id).not.toBe('')
    expect(input.getAttribute('aria-labelledby')).toBe(title.id)
  })

  it('as задан — роль не выводится', () => {
    const row = mount(() => (
      <Row clickable={() => {}} as="a"><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(row.tagName).toBe('A')
    expect(row.hasAttribute('role')).toBe(false)
  })

  // Порт tweb `src/tests/rowRadioFieldInteraction.test.tsx` (первый кейс):
  // вложенная кнопка справа — первичной целью становится заголовок.
  it('составная строка: первичная цель — .row-title, вложенная кнопка не вложена в неё', () => {
    const open = vi.fn()
    const remove = vi.fn()
    const row = mount(() => (
      <Row clickable={open} noRipple>
        <Row.Title>Open details</Row.Title>
        <Row.RightContent>
          <button type="button" onClick={(event) => { event.stopPropagation(); remove() }}>Remove</button>
        </Row.RightContent>
      </Row>
    )).querySelector<HTMLElement>('.row')!
    const title = row.querySelector<HTMLElement>('.row-title')!

    expect(row.getAttribute('role')).toBeNull()
    expect(title.getAttribute('role')).toBe('button')
    expect(title.getAttribute('tabindex')).toBe('0')
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(open).toHaveBeenCalledOnce()
    row.querySelector<HTMLButtonElement>('button')!.click()
    expect(remove).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
  })

  it('on:keydown пропом заменяет buttonKeyDown', () => {
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    const row = mount(() => (
      <Row clickable={onClick} on:keydown={onKeyDown}><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })
})

// tweb `:54-75`, `:427-448`, `:503-524`.
describe('RightContent и Media: пустое не рендерится, готовый узел принимается', () => {
  it('пустой Row.RightContent — нет div.row-right и нет row-grid', () => {
    const row = mount(() => (
      <Row>
        <Row.Title>Choice</Row.Title>
        <Row.Subtitle>Description</Row.Subtitle>
        <Row.RightContent>{false}</Row.RightContent>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.querySelector('.row-right')).toBeNull()
    expect(row.classList.contains('row-grid')).toBe(false)
  })

  it('Row.Media element={узел} — узел в строке с row-media row-media-small; снятие — классы убраны', () => {
    const media = document.createElement('div')
    media.classList.add('own')
    const row = mount(() => (
      <Row><Row.Title>a</Row.Title><Row.Media element={media} size="small" /></Row>
    )).querySelector<HTMLElement>('.row')!

    expect(media.parentElement).toBe(row)
    expect(media.className).toBe('own row-media row-media-small')
    expect(row.classList.contains('row-with-padding')).toBe(true)

    dispose?.()
    dispose = undefined
    expect(media.className).toBe('own')
  })

  it('Row.Media без size — только row-media', () => {
    const row = mount(() => (
      <Row><Row.Title>a</Row.Title><Row.Media><span /></Row.Media></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(row.querySelector('.row-media')!.className).toBe('row-media')
  })

  // Порт tweb `rowRadioFieldInteraction.test.tsx` «only removes classes that Row added».
  it('Row.RightContent element снимает на уходе только добавленные им классы', () => {
    const external = document.createElement('div')
    external.classList.add('row-right')

    const row = mount(() => (
      <Row noRipple>
        <Row.Title>External content</Row.Title>
        <Row.RightContent element={external} class="temporary-row-class" />
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(external.parentElement).toBe(row)
    expect(row.classList.contains('row-grid')).toBe(true)
    expect(external.classList.contains('temporary-row-class')).toBe(true)

    dispose?.()
    dispose = undefined
    expect(external.classList.contains('row-right')).toBe(true)
    expect(external.classList.contains('temporary-row-class')).toBe(false)
  })
})

// tweb `:264-399`, `:33-38`, `:101`, `:242`.
describe('части строки: ref-пропы, rowClass, titleRightClass, midtitleRight, style', () => {
  // Порт tweb `rowRadioFieldInteraction.test.tsx` «mounts empty row parts for explicit refs».
  it('пустые части с явным ref монтируются без содержимого', () => {
    let title: HTMLDivElement | undefined
    let subtitle: HTMLDivElement | undefined
    const el = mount(() => (
      <Row noRipple>
        <Row.Title ref={(element) => title = element} />
        <Row.Subtitle ref={(element) => subtitle = element} />
      </Row>
    ))

    expect(title).toBe(el.querySelector('.row-title'))
    expect(subtitle).toBe(el.querySelector('.row-subtitle'))
    expect(title!.textContent).toBe('')
    expect(subtitle!.textContent).toBe('')
    expect(el.textContent).not.toContain('true')
  })

  it('titleRightRef/subtitleRightRef создают правые половины; rowClass и titleRightClass ложатся на свои узлы', () => {
    let titleRight: HTMLDivElement | undefined
    let subtitleRight: HTMLDivElement | undefined
    const el = mount(() => (
      <Row>
        <Row.Title rowClass="my-row" titleRightClass="my-right" titleRightRef={(element) => titleRight = element}>a</Row.Title>
        <Row.Subtitle subtitleRightRef={(element) => subtitleRight = element}>b</Row.Subtitle>
      </Row>
    ))

    expect(titleRight).toBe(el.querySelector('.row-title-row > .row-title-right'))
    expect(el.querySelector('.row-title-row')!.classList.contains('my-row')).toBe(true)
    expect(titleRight!.classList.contains('my-right')).toBe(true)
    expect(subtitleRight).toBe(el.querySelector('.row-subtitle-row > .row-subtitle-right'))
  })

  it('midtitleRight — правая половина средней строки; with-midtitle на строке', () => {
    const row = mount(() => (
      <Row>
        <Row.Title>a</Row.Title>
        <Row.Midtitle midtitleRight={<span data-mr>справа</span>}>середина</Row.Midtitle>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    expect(row.classList.contains('with-midtitle')).toBe(true)
    expect(row.querySelector('.row-midtitle-row > .row-midtitle-right [data-mr]')).not.toBeNull()
  })

  it('style ложится на корень строки', () => {
    const row = mount(() => (
      <Row style={{ 'min-height': '10px' }}><Row.Title>a</Row.Title></Row>
    )).querySelector<HTMLElement>('.row')!
    expect(row.style.minHeight).toBe('10px')
  })

  it('createRowTitle — div.row-title с dir="auto"', () => {
    const title = createRowTitle()
    expect(title.tagName).toBe('DIV')
    expect(title.className).toBe('row-title')
    expect(title.dir).toBe('auto')
  })
})

// Корень строки — `RippleElement` поверх `Passthrough` (tweb ef41b29db, 803f9599d):
// `ref` зовётся ОДИН раз (в нём `createContextMenu` — второй вызов повесил бы
// второе меню), а реактивный `classList` не стирает чужие классы (`menu-open`,
// который вешает на строку `createContextMenu`).
describe('корень строки переживает реактивные обновления', () => {
  it('ref строки зовётся один раз, чужой класс на корне остаётся', () => {
    const ref = vi.fn()
    const [sub, setSub] = createSignal(false)
    const row = mount(() => (
      <Row ref={ref} clickable={() => {}}>
        <Row.Title>a</Row.Title>
        <Show when={sub()}><Row.Subtitle>b</Row.Subtitle></Show>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    row.classList.add('menu-open')
    setSub(true)
    expect(row.classList.contains('no-subtitle')).toBe(false)
    setSub(false)
    expect(row.classList.contains('no-subtitle')).toBe(true)

    expect(ref).toHaveBeenCalledTimes(1)
    expect(ref).toHaveBeenCalledWith(row)
    expect(row.classList.contains('menu-open')).toBe(true)
  })

  it('меню строки переживает реактивное обновление: клик после смены детей всё ещё открывает его', async () => {
    const [sub, setSub] = createSignal(false)
    const row = mount(() => (
      <Row contextMenu={{ buttons: [{ icon: 'copy', regularText: 'Пункт', onClick: () => {} }] }}>
        <Row.Title>Селект</Row.Title>
        <Show when={sub()}><Row.Subtitle>значение</Row.Subtitle></Show>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    setSub(true)
    row.click()
    await settle()
    expect(document.querySelector('.btn-menu.contextmenu.active')).not.toBeNull()
  })

  it('on:keydown не навешивается повторно на каждом обновлении', () => {
    const onKeyDown = vi.fn()
    const [sub, setSub] = createSignal(false)
    const row = mount(() => (
      <Row clickable={() => {}} on:keydown={onKeyDown}>
        <Row.Title>a</Row.Title>
        <Show when={sub()}><Row.Subtitle>b</Row.Subtitle></Show>
      </Row>
    )).querySelector<HTMLElement>('.row')!

    setSub(true)
    setSub(false)
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })
})
