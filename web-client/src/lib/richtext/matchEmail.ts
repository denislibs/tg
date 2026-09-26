// Порт tweb `src/lib/richTextProcessor/matchEmail.ts` (812502980) — дословно.
// `EMAIL_REG_EXP` у нас живёт в `parseEntities.ts` (у tweb — `richTextProcessor/index.ts:66`),
// выражение то же.
import { EMAIL_REG_EXP } from './parseEntities'

export default function matchEmail(text: string) {
  return !text ? null : text.match(EMAIL_REG_EXP)
}
