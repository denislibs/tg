// Порт tweb `src/helpers/eachMinute.ts` (812502980); `unknown` вместо `any` у
// колбэка — стиль репозитория.
import eachTimeout from '@helpers/eachTimeout'

// It's better to use timeout instead of interval, because interval can be corrupted
export default function eachMinute(callback: () => unknown, runFirst?: boolean) {
  return eachTimeout(callback, () => (60 - new Date().getSeconds()) * 1000, runFirst)
}
