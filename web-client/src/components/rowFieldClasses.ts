/**
 * Порт tweb `src/components/rowFieldClasses.ts` (803f9599d) — классы, которые
 * строка ставит полям, раскладываемым ею самой.
 *
 * В строке может оказаться и чужой чекбокс (выделение в строке документа/аудио),
 * и он не должен подхватывать раскладку строки. Поэтому `_row.scss` целится в
 * эти производные классы, а не в `.checkbox-field` / `.radio-field` напрямую, и
 * носят их только поля, зарегистрированные строкой.
 *
 * Взяты только используемые у нас константы; классы выделения строк
 * (`row-selection-*`, `row-with-checkbox-and-media`) приедут с аудио-строкой.
 */
export const ROW_CHECKBOX_FIELD_CLASS = 'row-checkbox-field'
export const ROW_CHECKBOX_FIELD_TOGGLE_CLASS = 'row-checkbox-field-toggle'
export const ROW_RADIO_FIELD_CLASS = 'row-radio-field'
