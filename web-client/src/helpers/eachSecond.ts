// Порт tweb `src/helpers/eachSecond.ts` (812502980). Отличие одно — стиль
// репозитория: без точек с запятой и с `unknown` вместо `any` у колбэка.
import eachTimeout from '@helpers/eachTimeout'

// It's better to use timeout instead of interval, because interval can be corrupted
export default function eachSecond(callback: () => unknown, runFirst?: boolean) {
  return eachTimeout(callback, () => 1000 - new Date().getMilliseconds(), runFirst)
}
