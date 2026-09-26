/**
 * Порт tweb `src/components/checkboxField.ts` (корень и тумблер — по HEAD
 * 812502980: `span`, `toggleCircle`, замок, `toggleDisability`) — В ОБЪЁМЕ
 * ТРЁХ ВЫЗЫВАЮЩИХ (третий — Solid-обёртка `checkboxFieldTsx.solid.tsx`):
 *  • `AppSelection.toggleElementCheckbox` строит `new CheckboxField({name,
 *    round: true})` (tweb selection.ts:359-362) и дальше трогает у него ровно
 *    два поля — `label` (кладёт в бабл) и `input` (`input.checked = …`);
 *  • `PopupPeer` чекбоксы (`popupPeer.ts`, раунд правок 3 — см. докблок файла)
 *    строит `new CheckboxField({text, checked})` (tweb peer.ts:98-101, внутри
 *    `if(options.checkboxes)`) и читает `input.checked` в колбэке кнопки.
 *
 * ── Что урезано и почему ────────────────────────────────────────────────────
 * Ветки оригинала, у которых здесь нет вызывающего и нет зависимости в репо:
 *  (`text`/`textArgs` портированы дословно с задачи 7: подпись — КЛЮЧ, узел
 *  строит `_i18n(span, key, args)`, как в оригинале (:114). Раньше здесь стояла
 *  «уже переведённая строка» в `textContent`, и по сигнатуре `text?: string`
 *  это было неотличимо от ключа — та же половина раскола контракта, что у
 *  `ButtonMenuItem`/`PopupButton`.)
 *  • (`toggle` СНЯТ с этого списка — портирован вместе с первой Solid-вкладкой
 *    настроек, у которой он появился вызывающим: `checkboxFieldTsx.solid.ts`
 *    → `sidebarLeft/tabs/language.solid.tsx`. Разметка дословная, tweb
 *    :117-129. Подветка `restriction` внутри неё (`:120-122`) не перенесена
 *    вместе с самим `restriction` — см. ниже. Toggle-ветка `row.ts`
 *    (`checkboxFieldOptions.toggle`) от этого достижимой НЕ становится: её
 *    держит не `CheckboxField`, а отсутствие вызывающего у самого `row.ts`, —
 *    остаток #110);
 *  • `stateKey`/`stateValues`/`stateValueReverse` — двусторонняя привязка к
 *    `appStateManager` (tweb `rootScope.managers`/`apiManagerProxy`); у нас
 *    состояние живёт в zustand-сторах, а у обоих вызывающих его нет вовсе;
 *  • `withRipple`/`withHover` — НЕ портированы, но уже не из-за отсутствия
 *    `components/ripple.ts` (он появился позже, шагом 1 плана волны 2 —
 *    кнопка/радио/тост; этот пункт устарел и здесь актуализирован без
 *    переноса самой ветки). Причина сейчас другая: у tweb `o.withRipple =
 *    true` ставится БЕЗУСЛОВНО для чекбоксов `PopupPeer` (peer.ts:98), но наш
 *    вызывающий (`popupPeer.ts:176`) этот флаг не передаёт — заводить ветку
 *    без единого вызывающего, который её включает, значит писать код, который
 *    никто не исполнит. Тот же вычет — в `popupElement.ts::setButtons`
 *    (кнопки попапа тоже без ripple). ЗАДАЧИ НА ЭТО РАСХОЖДЕНИЕ НЕТ НИ ОДНОЙ:
 *    #110 покрывает только `toggle` и `contextMenu`, `withRipple`/`withHover`
 *    в неё не входят — вынесено ведущему финальным ревью волны 2, номер
 *    проставить сюда, как только он появится;
 *  • `color`, `restriction`, `asRadio`, `listenerSetter` — их не зовёт ни
 *    выделение, ни `PopupPeer`, ни Solid-обёртка;
 *  • (`toggleDisability` и `toggleLockIcon`/`setToggleLockIcon` СНЯТЫ с этого
 *    списка — портированы с HEAD 812502980 вместе с дельтой `checkboxFieldTsx`
 *    (волна 2D, задача 2): их зовут её эффекты, tweb `checkboxField.ts:122`,
 *    `:127`, `:165-174`, `:184-188`.) Опция `disabled` конструктора
 *    (`:52-54`) не перенесена: Solid-обёртка выключает поле эффектом, а у
 *    оригинала ветка зовёт `toggleDisability` ДО создания `input` (`:58`) и
 *    упала бы на `this.input.disabled` — вызывающих у неё нет и там;
 *    `isDisabled` (`:180-182`) — вызывающего нет;
 *  • (пара `get/set checked` (tweb :151-162) СНЯТА с этого списка — пришла с
 *    первым вызывающим сеттера, `checkboxFields.solid.tsx` (план 2D, задача 11):
 *    групповой тумблер «Энергосбережения» переключает вложенных записью
 *    `field.checkboxField.checked = …`, и `change` обязан всплыть до формы.)
 *
 * ── ОСТАТОК ВОЛНЫ (#112) ───────────────────────────────────────────────────
 * Живые React-двойники того же поля — `shared/ui/Checkbox` и
 * `components/TgSwitch` (вместе восемь файлов-потребителей против трёх у
 * этого порта, без самих файлов-определений и их тестов). Как и у
 * `button.ts`/`buttonIcon.ts`: двойники уйдут вместе с последним
 * React-экраном, который их рисует.
 *
 * Разметка ветки `{round: true}` — дословная (tweb :107-152); разметка `text`
 * (`span.checkbox-caption`, tweb :106-113) — тоже дословная; стили под обе уже
 * портированы: `src/styles/tweb/_checkbox.scss` (`.checkbox-field`,
 * `.checkbox-field-round`, `.checkbox-box{-border,-background,-check}`,
 * `.checkbox-caption`), символ `#check` — `components/SvgDefs.tsx`.
 */

import Icon from '@components/icon'
import simulateEvent from '@helpers/dom/dispatchEvent'
import type { IconName } from '@core/tgico-icons'
import { _i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'

export type CheckboxFieldOptions = {
  /** идёт в `id` инпута как `input-<name>` (tweb :59-61) */
  name?: string
  /** круглый чекбокс — форма, в которой чекбокс живёт в бабле */
  round?: boolean
  /** подпись строки — КЛЮЧ (tweb :12, :106-113, `span.checkbox-caption`); без неё —
   *  `checkbox-without-caption` (tweb :114), как и раньше */
  text?: LangPackKey
  /** аргументы подписи (tweb :114 — второй параметр `_i18n`) */
  textArgs?: FormatterArguments
  /** взведён при создании (tweb :64-66) */
  checked?: boolean
  /** переключатель вместо коробки с галочкой (tweb :17, :117-129) */
  toggle?: boolean
  /** замок в бегунке тумблера (tweb HEAD :25, :127); только с `toggle` */
  toggleLockIcon?: IconName
}

export default class CheckboxField {
  public input: HTMLInputElement
  /** корень поля; `span`, как у HEAD, — `label` только с подписью, см. конструктор */
  public label: HTMLElement
  /** бегунок тумблера (tweb HEAD :33, :122); без `toggle` не создаётся */
  public toggleCircle?: HTMLElement

  constructor(options: CheckboxFieldOptions = {}) {
    // tweb HEAD `:37` (ef41b29db) — `span`: поле «только контрол», его подпись —
    // строка, которая сама `label` (label-в-label ломал бы `row.control`,
    // 472e3e76b). `label` остаётся лишь у поля С ПОДПИСЬЮ — ветки старой базы
    // для единственного потребителя `PopupPeer` (чекбоксы попапа без строки;
    // щелчок по подписи обязан переключать поле). Уйдёт с попапами 2C.
    const label = this.label = document.createElement(options.text ? 'label' : 'span')
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
      _i18n(span, options.text, options.textArgs) // tweb :114
    } else {
      label.classList.add('checkbox-without-caption')
    }

    label.append(input)

    if (options.toggle) {
      // tweb :117-129 — переключатель: дорожка + бегунок, коробки нет вовсе.
      // Подветка `restriction` (:120-122) не перенесена вместе с самой опцией
      // `restriction` — у неё по-прежнему нет ни одного вызывающего.
      label.classList.add('checkbox-field-toggle')

      const toggle = document.createElement('div')
      toggle.classList.add('checkbox-toggle')
      const circle = this.toggleCircle = document.createElement('div')
      circle.classList.add('checkbox-toggle-circle')
      toggle.append(circle)
      label.append(toggle)

      this.setToggleLockIcon(options.toggleLockIcon) // tweb HEAD :127
    } else {
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

    if (span) { // tweb :151-153 — подпись ПОСЛЕ коробки
      label.append(span)
    }
  }

  /** tweb :151-153 */
  get checked() {
    return this.input.checked
  }

  /** tweb :155-162 — запись с `change` (всплывает): его ждут слушатели поля и формы */
  set checked(checked: boolean) {
    this.setValueSilently(checked)
    simulateEvent(this.input, 'change')
  }

  /**
   * tweb :176-178 — записать состояние, НЕ порождая `change`. Им синхронизирует
   * поле с сигналом Solid `checkboxFieldTsx.solid.tsx`: запись снаружи не должна
   * снова вызвать обработчик и закольцеваться.
   */
  public setValueSilently(checked: boolean) {
    this.input.checked = checked
  }

  /** tweb HEAD :165-174 — замок в бегунке тумблера или его снятие. Только для тумблера. */
  public setToggleLockIcon(icon?: IconName) {
    const circle = this.toggleCircle
    if (!circle) {
      return
    }

    circle.classList.toggle('with-lock', !!icon)
    circle.replaceChildren(...(icon ? [Icon(icon)] : []))
  }

  /** tweb HEAD :184-188 */
  public toggleDisability(disable: boolean) {
    this.label.classList.toggle('checkbox-disabled', disable)
    this.input.disabled = disable
    return () => this.toggleDisability(!disable)
  }
}
