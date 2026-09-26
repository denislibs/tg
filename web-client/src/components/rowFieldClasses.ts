/**
 * Порт tweb `src/components/rowFieldClasses.ts` (803f9599d, 812502980) — классы, которые
 * строка ставит полям, раскладываемым ею самой.
 *
 * В строке может оказаться и чужой чекбокс (выделение в строке документа/аудио),
 * и он не должен подхватывать раскладку строки. Поэтому `_row.scss` целится в
 * эти производные классы, а не в `.checkbox-field` / `.radio-field` напрямую, и
 * носят их только поля, зарегистрированные строкой.
 *
 * Тумблер носит только `row-checkbox-field-toggle`, без `row-checkbox-field` —
 * так у tweb HEAD (ef41b29db снял второй класс, `rowTsx.tsx:482-492`).
 *
 * Взяты только используемые у нас константы; классы выделения строк
 * (`row-selection-*`, `row-with-checkbox-and-media`) приедут с аудио-строкой.
 * `RADIO_FIELD_RIGHT_CLASS` — радио справа (`rowTsx.tsx:457-459`): строка
 * узнаёт по нему поле, которое кладёт в правую часть заголовка.
 */
export const ROW_CHECKBOX_FIELD_CLASS = 'row-checkbox-field'
export const ROW_CHECKBOX_FIELD_TOGGLE_CLASS = 'row-checkbox-field-toggle'
export const ROW_RADIO_FIELD_CLASS = 'row-radio-field'
export const RADIO_FIELD_RIGHT_CLASS = 'radio-field-right'
