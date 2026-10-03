// Порт tweb `helpers/string/bom.ts` — 1:1 (U+FEFF, «пустой» символ-филлер поля ввода).
const BOM = '﻿'
export default BOM
export const BOM_REG_EXP = new RegExp(BOM, 'g')
