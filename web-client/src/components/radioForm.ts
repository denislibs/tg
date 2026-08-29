/**
 * Порт tweb `src/components/radioForm.ts` — обёртка `<form>` вокруг набора
 * `RadioField`. У tweb строка (`{container, input}`) снятие отметки с прежде
 * выбранного не делает вовсе — полагается на то, что браузер сам разводит
 * radio-инпуты с одинаковым `name` внутри одной формы. Здесь строка иная —
 * `{container, radioField}`: вызывающий отдаёт весь `RadioField`, а не голый
 * `input`, ИМЕННО ЗАТЕМ, чтобы снятие отметки было явным вызовом
 * `setValueSilently(false)`, а не побочным эффектом совпавшего `name` —
 * секции настроек волны 2 пересобирают строки чаще, чем tweb, и терять
 * группировку при переносе `container` между формами тише не хочется.
 */
import type RadioField from './radioField'

export interface RadioFormRow {
  container: HTMLElement
  radioField: RadioField
}

export default function RadioForm(rows: RadioFormRow[], onChange: (value: string, event: Event) => void) {
  const form = document.createElement('form')

  rows.forEach((r) => {
    const { container, radioField } = r
    form.append(container)
    radioField.input.addEventListener('change', (e) => {
      if (!radioField.input.checked) return

      rows.forEach((other) => {
        if (other.radioField !== radioField) other.radioField.setValueSilently(false)
      })

      onChange(radioField.input.value, e)
    })
  })

  return form
}
