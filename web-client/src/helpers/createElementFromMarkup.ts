// Порт tweb `helpers/createElementFromMarkup.ts` (812502980) — 1:1; правки только
// под формат `.oxlintrc.json` и strict (возврат `as T`). Вход — статическая разметка
// самого кода (`components/colorPicker.ts`), не данные пользователя.
import { MOUNT_CLASS_TO } from '@config/debug'

export default function createElementFromMarkup<T = Element>(markup: string) {
  const div = document.createElement('div')
  div.innerHTML = markup.trim()
  return div.firstElementChild as T
}
MOUNT_CLASS_TO.createElementFromMarkup = createElementFromMarkup
