/**
 * Порт tweb `src/components/checkboxField.ts` — В ОБЪЁМЕ ЕДИНСТВЕННОГО
 * ВЫЗЫВАЮЩЕГО: `AppSelection.toggleElementCheckbox` строит
 * `new CheckboxField({name, round: true})` (tweb selection.ts:359-362) и дальше
 * трогает у него ровно два поля — `label` (кладёт в бабл) и `input`
 * (`input.checked = …`).
 *
 * ── Что урезано и почему ────────────────────────────────────────────────────
 * Ветки оригинала, у которых здесь нет вызывающего и нет зависимости в репо:
 *  • `text`/`textArgs` (`_i18n` на `.checkbox-caption`) — чекбокс бабла
 *    подписи не имеет, у нас всегда `checkbox-without-caption`;
 *  • `toggle` (переключатель `.checkbox-field-toggle`) — форма для настроек,
 *    не для выделения; её вызывающие приедут вместе с портом строк настроек;
 *  • `stateKey`/`stateValues`/`stateValueReverse` — двусторонняя привязка к
 *    `appStateManager` (tweb `rootScope.managers`/`apiManagerProxy`); у нас
 *    состояние живёт в zustand-сторах, а у выделения его нет вовсе;
 *  • `withRipple` — требует `components/ripple.ts`, которого в репо ещё нет
 *    (портируется вместе с кнопками); `withHover`, `color`, `restriction`,
 *    `asRadio`, `disabled` — их не зовёт ни выделение, ни что-либо ещё;
 *  • сеттер `checked` через `simulateEvent` (tweb :171-179) — хелпера
 *    `helpers/dom/dispatchEvent` в репо нет, а выделение пишет прямо в
 *    `input.checked`, как и сам tweb (selection.ts:367, 490).
 *
 * Разметка ветки `{round: true}` — дословная (tweb :107-152); стили под неё уже
 * портированы: `src/styles/tweb/_checkbox.scss` (`.checkbox-field`,
 * `.checkbox-field-round`, `.checkbox-box{-border,-background,-check}`), символ
 * `#check` — `components/SvgDefs.tsx`.
 */

export type CheckboxFieldOptions = {
  /** идёт в `id` инпута как `input-<name>` (tweb :59-61) */
  name?: string
  /** круглый чекбокс — форма, в которой чекбокс живёт в бабле */
  round?: boolean
}

export default class CheckboxField {
  public input: HTMLInputElement
  public label: HTMLLabelElement

  constructor(options: CheckboxFieldOptions = {}) {
    const label = this.label = document.createElement('label')
    label.classList.add('checkbox-field')

    if (options.round) {
      label.classList.add('checkbox-field-round')
    }

    const input = this.input = document.createElement('input')
    input.classList.add('checkbox-field-input')
    input.type = 'checkbox'
    if (options.name) {
      input.id = 'input-' + options.name
    }

    // tweb :110-114 — подписи нет, значит и каретки под неё не нужно
    label.classList.add('checkbox-without-caption')

    label.append(input)

    // tweb :127-148 — коробка чекбокса: рамка, заливка (она же анимация
    // «круг растёт») и галочка из общего спрайта
    const box = document.createElement('div')
    box.classList.add('checkbox-box')

    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    checkSvg.classList.add('checkbox-box-check')
    checkSvg.setAttributeNS(null, 'viewBox', '0 0 24 24')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttributeNS(null, 'href', '#check')
    use.setAttributeNS(null, 'x', '-1')
    checkSvg.append(use)

    const bg = document.createElement('div')
    bg.classList.add('checkbox-box-background')

    const border = document.createElement('div')
    border.classList.add('checkbox-box-border')

    box.append(border, bg, checkSvg)

    label.append(box)
  }
}
