/**
 * Порт tweb `src/components/rowFieldClasses.ts` (803f9599d) — классы, которые
 * строка ставит полям, раскладываемым ею самой.
 *
 * В строке может оказаться и чужой чекбокс (выделение в строке документа/аудио),
 * и он не должен подхватывать раскладку строки. Поэтому `_row.scss` целится в
 * эти производные классы, а не в `.checkbox-field` / `.radio-field` напрямую, и
 * носят их только поля, зарегистрированные строкой.
 *
 * ОТСТУПЛЕНИЕ: тумблер у нас получает только `row-checkbox-field-toggle`, без
 * `row-checkbox-field`. У tweb (803f9599d, rowTsx `Row.CheckboxFieldToggle`) —
 * оба класса, но с ef41b29db `_row.scss` даёт `.row .row-checkbox-field
 * { position: absolute }`, а тумблер лежит в `.row-title-right` — это
 * `.row-title` с `position: relative` и `overflow: hidden` при нулевой ширине
 * (единственный ребёнок абсолютный): тумблер обрезается целиком, что видно на
 * стенде. Раскладке чекбокса строки тумблер не нужен — ему нужны только
 * правила `row-checkbox-field-toggle` (`is-fake-disabled`, `accordion-toggler`).
 *
 * Взяты только используемые у нас константы; классы выделения строк
 * (`row-selection-*`, `row-with-checkbox-and-media`) приедут с аудио-строкой.
 */
export const ROW_CHECKBOX_FIELD_CLASS = 'row-checkbox-field'
export const ROW_CHECKBOX_FIELD_TOGGLE_CLASS = 'row-checkbox-field-toggle'
export const ROW_RADIO_FIELD_CLASS = 'row-radio-field'
