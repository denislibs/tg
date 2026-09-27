// Порт tweb `src/helpers/dom/focusInput.ts` (812502980) — 1:1; `placeCaretAtEnd`
// у нас живёт в `shared/lib/caret.ts`.
import { placeCaretAtEnd } from '@shared/lib/caret'

export default function focusInput(input: HTMLElement, e?: KeyboardEvent) {
  input.focus()
  placeCaretAtEnd(input)

  if(e) {
    // clone and dispatch same event to new input. it is needed for sending message if input was blurred
    const newEvent = new KeyboardEvent(e.type, e)
    input.dispatchEvent(newEvent)
  }
}
