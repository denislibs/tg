// Чекбокс выделения в строке документа и аудио — поверх иконки и прелоадера
// (tweb 8ff1ea1e7: `z-index: 3`). Выделение ПРЕПЕНДИТ чекбокс в строку
// (`AppSelection.appendCheckbox`), а иконка, кнопка play и прелоадер
// загрузки позиционированы и стоят в DOM позже — без z-index они красятся
// поверх кружка. Гоняется НАСТОЯЩИЙ скомпилированный `styles/index.scss`.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

beforeAll(() => {
  const css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
})

/** Строка вкладки shared media с чекбоксом выделения первым ребёнком. */
function rowWithCheckbox(rowClass: string) {
  const row = document.createElement('div')
  row.classList.add(rowClass, 'search-super-item')
  const label = document.createElement('label')
  label.classList.add('checkbox-field', 'checkbox-field-round')
  row.append(label)
  document.body.append(row)
  return label
}

describe('чекбокс выделения над иконкой строки (tweb 8ff1ea1e7)', () => {
  it.each(['document', 'audio'])('строка .%s: z-index 3', (rowClass) => {
    expect(getComputedStyle(rowWithCheckbox(rowClass)).zIndex).toBe('3')
  })
})
