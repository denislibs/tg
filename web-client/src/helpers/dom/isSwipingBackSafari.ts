// Порт tweb `helpers/dom/isSwipingBackSafari.ts` — 1:1, без правок.
// Гасит жест у левой кромки экрана в мобильном Safari: там это системный
// свайп «назад», перехватывать его нельзя. `IS_MOBILE_SAFARI` в первом
// операнде также страхует `instanceof TouchEvent` в окружениях без
// TouchEvent (happy-dom): до второго операнда дело не доходит.
import { IS_MOBILE_SAFARI } from '@environment/userAgent'

export default function isSwipingBackSafari(e: TouchEvent | MouseEvent) {
  return IS_MOBILE_SAFARI && e instanceof TouchEvent && e.touches[0].clientX < 30
}
