/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/checkboxFieldTsx.tsx` — Solid-обёртка над
 * ИМПЕРАТИВНЫМ `CheckboxField`. Узел строит класс, компонент лишь возвращает
 * его `label` наружу и связывает состояние в обе стороны:
 *  • сигнал изменился → `setValueSilently` (без `change`, иначе кольцо);
 *  • пользователь щёлкнул → сигнал и `onChange`.
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
 *  • опции `round`/`stateKey` в пропах ОБЪЯВЛЕНЫ у tweb, но `stateKey` наш
 *    `CheckboxField` не поддерживает (двусторонняя привязка к
 *    `appStateManager`, разобрано в его докблоке) — проп не переносим, чтобы
 *    он не был принят и молча проигнорирован;
 *  • `props.onChange` зовётся под `?.`: у tweb вызов безусловный
 *    (`props.onChange(checked())`), и компонент без обработчика уронил бы
 *    щелчок — у нас `onChange` в типе опционален, значит и вызов обязан быть
 *    опциональным.
 */
import { createEffect, createSignal, on, untrack, type JSX, type Signal } from 'solid-js'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import CheckboxField from '@components/checkboxField'
import { attachClassName } from '@helpers/solid/classname'
import type { LangPackKey } from '@lib/langPack'

export default function CheckboxFieldTsx(props: {
  class?: string
  text?: LangPackKey
  signal?: Signal<boolean>
  checked?: boolean
  toggle?: boolean
  onChange?: (checked: boolean) => void
}): JSX.Element {
  const [checked, setChecked] = props.signal ?? createSignal(props.checked ?? false)

  const checkboxField = new CheckboxField({
    text: props.text,
    toggle: props.toggle,
    checked: checked(),
  })

  createEffect(on(checked, () => {
    checkboxField.setValueSilently(checked())
  }, { defer: true }))

  createEffect(on(() => props.checked, (value) => {
    if(value === undefined) {
      return
    }

    setChecked(value)
  }))

  subscribeOn(checkboxField.input)('change', () => {
    setChecked(checkboxField.input.checked)
    untrack(() => props.onChange?.(checked()))
  })

  attachClassName(checkboxField.label, () => props.class)

  return checkboxField.label
}
