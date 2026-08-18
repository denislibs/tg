// Порт tweb `src/global.d.ts` — расширения DOM-интерфейсов, на которых держатся
// портированные императивные компоненты. Довозим по мере появления потребителей,
// а не весь файл разом.
//
// `HTMLElement.middlewareHelper` — механизм оригинала: узел САМ носит свой
// middleware-хелпер, и тот, кто узел удаляет, тут же его и рушит
// (`components/wrappers/mediaSpoiler.ts`: `mediaSpoiler.middlewareHelper.destroy()`).
// Без этого поля владение временем жизни спойлера пришлось бы держать в
// сторонней карте, чего в оригинале нет.
import type { MiddlewareHelper } from '@helpers/middleware'

declare global {
  interface HTMLElement {
    middlewareHelper?: MiddlewareHelper
  }
}

export {}
