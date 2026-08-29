/**
 * Порт tweb `src/components/radioForm.ts` — 1:1. Строка — `{container, input}`,
 * снятие отметки с прежде выбранного этот файл НЕ делает — это побочный
 * эффект нативной radio-группировки браузера по одинаковому `input.name`
 * (`radioField.ts`: `input.name = 'input-radio-' + options.name`, общий для
 * всей группы).
 *
 * Раньше здесь была своя реализация — строка `{container, radioField}` и
 * явный цикл `setValueSilently(false)` по остальным полям. Ревью нашло цену:
 * оба реальных вызывающих в tweb передают именно голый `input`, причём
 * `buttonMenu.ts:260-271` строит radio-строки из `CheckboxField`
 * (`input.type = 'radio'` навешивается прямо там) — у нашего порта
 * `checkboxField.ts` метода `setValueSilently` нет вовсе. Собственная
 * сигнатура сломалась бы ещё раз при порте `buttonMenu` radioGroups и
 * `row.ts:391 RadioFormFromRows`. Решение ведущего: дословный порт выше
 * иллюстративного кода теста из брифа шага 1 плана волны 2 — расхождение было в брифе,
 * а не в этом файле.
 */
export interface RadioFormRow {
  container: HTMLElement
  input: HTMLInputElement
}

export default function RadioForm(rows: RadioFormRow[], onChange: (value: string, event: Event) => void) {
  const form = document.createElement('form')

  rows.forEach((r) => {
    const { container, input } = r
    form.append(container)
    input.addEventListener('change', (e) => {
      if (input.checked) {
        onChange(input.value, e)
      }
    })
  })

  return form
}
