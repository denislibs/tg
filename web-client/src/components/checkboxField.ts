/**
 * Порт tweb `src/components/checkboxField.ts` — В ОБЪЁМЕ ДВУХ ВЫЗЫВАЮЩИХ:
 *  • `AppSelection.toggleElementCheckbox` строит `new CheckboxField({name,
 *    round: true})` (tweb selection.ts:359-362) и дальше трогает у него ровно
 *    два поля — `label` (кладёт в бабл) и `input` (`input.checked = …`);
 *  • `PopupPeer` чекбоксы (`popupPeer.ts`, раунд правок 3 — см. докблок файла)
 *    строит `new CheckboxField({text, checked})` (tweb peer.ts:98-101, внутри
 *    `if(options.checkboxes)`) и читает `input.checked` в колбэке кнопки.
 *
 * ── Что урезано и почему ────────────────────────────────────────────────────
 * Ветки оригинала, у которых здесь нет вызывающего и нет зависимости в репо:
 *  • `textArgs` (`_i18n` вторым параметром) — у нашего `t()` (`@/i18n`,
 *    `dict[s] ?? s`) нет интерполяции аргументов, предмета нет — `text` уже
 *    переведённая строка, кладётся `textContent`, а не через `_i18n`;
 *  • `toggle` (переключатель `.checkbox-field-toggle`) — форма для настроек,
 *    не для выделения и не для `PopupPeer`; её вызывающие приедут вместе с
 *    портом строк настроек;
 *  • `stateKey`/`stateValues`/`stateValueReverse` — двусторонняя привязка к
 *    `appStateManager` (tweb `rootScope.managers`/`apiManagerProxy`); у нас
 *    состояние живёт в zustand-сторах, а у обоих вызывающих его нет вовсе;
 *  • `withRipple`/`withHover` — НЕ портированы, но уже не из-за отсутствия
 *    `components/ripple.ts` (он появился позже, в задаче про кнопку/радио/
 *    тост — этот пункт устарел и здесь актуализирован без переноса самой
 *    ветки). Причина сейчас другая: у tweb `o.withRipple = true` ставится
 *    БЕЗУСЛОВНО для чекбоксов `PopupPeer` (peer.ts:98), но наш вызывающий
 *    (`popupPeer.ts:176`) этот флаг не передаёт — заводить ветку без
 *    единого вызывающего, который её включает, значит писать код, который
 *    никто не исполнит. Тот же вычет — в `popupElement.ts::setButtons`
 *    (кнопки попапа тоже без ripple). Включение `withRipple` в `popupPeer.ts`
 *    — отдельная задача (нужен вызывающий + тест на класс/эффект), не строка
 *    в этом файле;
 *  • `color`, `restriction`, `asRadio`, `disabled`, `listenerSetter` — их не
 *    зовёт ни выделение, ни `PopupPeer`;
 *  • сеттер `checked` через `simulateEvent` (tweb :171-179) — хелпера
 *    `helpers/dom/dispatchEvent` в репо нет, оба вызывающих пишут прямо в
 *    `input.checked`, как и сам tweb (selection.ts:367, 490; peer.ts читает
 *    `checkboxField.input.checked` через геттер `.checked`, portable без
 *    `simulateEvent` — сеттер нужен только для программного включения извне).
 *
 * Разметка ветки `{round: true}` — дословная (tweb :107-152); разметка `text`
 * (`span.checkbox-caption`, tweb :106-113) — тоже дословная; стили под обе уже
 * портированы: `src/styles/tweb/_checkbox.scss` (`.checkbox-field`,
 * `.checkbox-field-round`, `.checkbox-box{-border,-background,-check}`,
 * `.checkbox-caption`), символ `#check` — `components/SvgDefs.tsx`.
 */

export type CheckboxFieldOptions = {
  /** идёт в `id` инпута как `input-<name>` (tweb :59-61) */
  name?: string
  /** круглый чекбокс — форма, в которой чекбокс живёт в бабле */
  round?: boolean
  /** подпись строки (tweb :106-113, `span.checkbox-caption`); без неё —
   *  `checkbox-without-caption` (tweb :114), как и раньше */
  text?: string
  /** взведён при создании (tweb :64-66) */
  checked?: boolean
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
    if (options.checked) { // tweb :64-66
      input.checked = true
    }

    // tweb :106-114 — подпись есть → span.checkbox-caption, иначе класс
    // "без подписи" (каретке под неё не место).
    let span: HTMLSpanElement | undefined
    if (options.text) {
      span = document.createElement('span')
      span.classList.add('checkbox-caption')
      span.textContent = options.text
    } else {
      label.classList.add('checkbox-without-caption')
    }

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

    if (span) { // tweb :151-153 — подпись ПОСЛЕ коробки
      label.append(span)
    }
  }
}
