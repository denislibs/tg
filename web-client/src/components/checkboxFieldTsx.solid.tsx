/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/checkboxFieldTsx.tsx` (812502980, 61 строка) —
 * Solid-обёртка над ИМПЕРАТИВНЫМ `CheckboxField`. Узел строит класс, компонент
 * лишь возвращает его `label` наружу и связывает состояние в обе стороны:
 *  • сигнал изменился → `setValueSilently` (без `change`, иначе кольцо);
 *  • пользователь щёлкнул → сигнал и `onChange`.
 * Подпись — не его дело: у HEAD поле «только контрол», текст кладётся в
 * `Row.Title` рядом с `Row.CheckboxField` (tweb `:6`).
 *
 * `defer: true` у первого эффекта обязателен: начальное значение уже попало в
 * конструктор (`checked: checked()`), и повторная запись на монтировании была
 * бы лишней.
 *
 * Расширение `.solid.tsx`, хотя JSX в файле нет ни строчки (компонент
 * возвращает готовый узел императивного класса): маска рантаймов
 * (`shared/solid/fileRuntime.ts` — `/\.solid\.(?:test\.)?tsx$/`) требует
 * именно `tsx`, и под `.solid.ts` файл не попал бы НИ под один плагин, а
 * заодно выпал бы из скана «в Solid-файлах нет импортов React»
 * (`shared/solid/boundary.test.ts`).
 *
 * ── Отличия от оригинала ───────────────────────────────────────────────────
 *  1. Пропы — не `Omit<CheckboxFieldOptions, 'toggleLockIcon'>` целиком, а та
 *     часть, которую умеет наш `CheckboxField`: `color`, `stateKey`,
 *     `stateValues`, `stateValueReverse`, `listenerSetter`,
 *     `asRadio` (tweb `:21-28`) он не поддерживает (разобрано в его докблоке:
 *     привязка к `appStateManager` у нас — zustand), и проп не переносим, чтобы
 *     он не был принят и молча проигнорирован. Приедут с первым экраном,
 *     которому они нужны.
 *  2. `text` у нас в пропах нет, как и у HEAD (снят ef41b29db); у класса
 *     подпись осталась — ею пользуется `PopupPeer`. Без подписи класс строит
 *     `span.checkbox-field`, как HEAD: в label-строке нет label-в-label.
 *  3. `checked` уходит в конструктор всегда, а не условным спредом (tweb
 *     `:29`): спред нужен оригиналу, чтобы не перебить значение, которое
 *     `CheckboxField` сам подтянет по `stateKey`; `stateKey` у нас нет (п. 1), и
 *     без него `checked: false` и отсутствие ключа неотличимы.
 */
import { createEffect, createSignal, on, untrack, type JSX, type Signal } from 'solid-js'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import CheckboxField from '@components/checkboxField'
import { attachClassName } from '@helpers/solid/classname'
import type { IconName } from '@core/tgico-icons'

export default function CheckboxFieldTsx(props: {
  class?: string
  name?: string
  round?: boolean
  toggle?: boolean
  /** поле-ограничение (tweb `:25`, задача 0б-6 волны 7) */
  restriction?: boolean
  disabled?: boolean
  checked?: boolean
  signal?: Signal<boolean>
  /** Замок в бегунке тумблера. Только вместе с `toggle` */
  lockIcon?: IconName
  onChange?: (checked: boolean) => void
  ref?: (checkboxField: CheckboxField) => void
}): JSX.Element {
  const [checked, setChecked] = props.signal ?? createSignal(props.checked ?? false)

  const checkboxField = new CheckboxField({
    toggle: props.toggle,
    toggleLockIcon: props.lockIcon,
    round: props.round,
    name: props.name,
    restriction: props.restriction,
    checked: checked(),
  })
  props.ref?.(checkboxField)

  createEffect(on(checked, () => {
    checkboxField.setValueSilently(checked())
  }, { defer: true }))

  createEffect(on(() => props.lockIcon, (icon) => {
    checkboxField.setToggleLockIcon(icon)
  }, { defer: true }))

  createEffect(on(() => props.checked, (value) => {
    if(value === undefined) {
      return
    }

    setChecked(value)
  }))

  createEffect(() => {
    checkboxField.toggleDisability(!!props.disabled)
  })

  subscribeOn(checkboxField.input)('change', () => {
    setChecked(checkboxField.input.checked)
    untrack(() => props.onChange?.(checked()))
  })

  attachClassName(checkboxField.label, () => props.class)

  return checkboxField.label
}
