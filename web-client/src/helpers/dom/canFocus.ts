// Порт tweb `src/helpers/dom/canFocus.ts` (812502980) — дословно: на iOS Safari
// программный фокус первого поля экрана открывает клавиатуру поверх въезжающей
// вкладки, поэтому первое поле там не фокусируется.
import { IS_MOBILE_SAFARI } from '@environment/userAgent'

export function canFocus(isFirstInput: boolean) {
  return !IS_MOBILE_SAFARI || !isFirstInput
}
