// НЕ порт — минимальный локальный шим под путь `@helpers/windowSize`, на
// который завязан `helpers/dom/getVisibleRect.ts` (`import windowSize from
// '@helpers/windowSize'`). Полный tweb `helpers/windowSize.ts` реактивен на
// solid-js (`createUnifiedSignal`) и в конструкторе безусловно подписывается
// на `@helpers/appWindow` — отдельную, не относящуюся к скроллу фичу Document
// Picture-in-Picture (выпорхнуть весь клиент в always-on-top окно), 122
// строки. У нас в проекте нет ни solid-js (решение программы — см. `helpers/
// mediaSizes.ts`, `helpers/solid/readValue.ts`), ни Document PiP, и ни то, ни
// другое не нужно ради двух чисел, которые реально читает `getVisibleRect.ts`
// (`windowSize.width`/`windowSize.height`). Решение координатора по блокеру
// Задачи 2 — см. `task-2-report.md`; проверено, что `scrollable.ts`/
// `scrollSaver.ts` (Задачи 3-4) `windowSize` не используют вообще — только
// `getVisibleRect.ts`, и только эти два поля.
//
// Вместо solid-сигнала — plain-класс с кэшем в приватных полях, обновляемым
// на `resize` (та же форма API: `.width`/`.height` — геттеры, как в tweb, так
// что `getVisibleRect.ts` не пришлось трогать вообще). Вместо `@helpers/
// context`+`IS_WORKER` — прямой `typeof window !== 'undefined'`-гард: тот же
// смысл (в воркере/SSR window нет), но без ещё одной невостребованной
// транзитивной зависимости.
export class WindowSize {
  private _width = typeof window !== 'undefined' ? window.innerWidth : 0
  private _height = typeof window !== 'undefined' ? window.innerHeight : 0

  constructor() {
    if(typeof window === 'undefined') return

    window.addEventListener('resize', () => {
      this._width = window.innerWidth
      this._height = window.innerHeight
    }, { passive: true })
  }

  public get width() {
    return this._width
  }

  public get height() {
    return this._height
  }
}

const windowSize = new WindowSize()
export default windowSize
