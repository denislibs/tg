// Порт tweb `src/helpers/windowSize.ts` (812502980): размеры окна, в котором
// живёт приложение (вкладка или окно выноса Document PiP,
// `components/clientPip.solid.tsx`), — `bindViewport` следует за
// `helpers/appWindow.ts`.
//
// Расхождения с оригиналом:
//  1. Вместо solid-сигнала (`createUnifiedSignal`) — приватные поля,
//     обновляемые на `resize` (та же форма API: `.width`/`.height` — геттеры);
//     читатели (`getVisibleRect.ts`, лента, фон чата, вьювер) берут значение
//     в момент вызова, реактивность им не нужна.
//  2. Вместо `@helpers/context`+`IS_WORKER` — гард `typeof window !==
//     'undefined'`: тот же смысл (в воркере/SSR window нет).
import { getAppWindow, onAppWindowChange } from '@helpers/appWindow'

export class WindowSize {
  private _width = 0
  private _height = 0
  private viewport: Window | undefined
  private set = () => this.setDimensions()

  constructor() {
    if(typeof window === 'undefined') return

    // tweb :23-27 — Bind to the active app window (the tab, or the Document PiP window while the
    // client is popped out). Re-bind when it flips so resize events and dimensions come from
    // whichever window the app currently lives in.
    this.bindViewport(getAppWindow())
    onAppWindowChange((win) => this.bindViewport(win))
  }

  // tweb :30-35
  private bindViewport(win: Window) {
    this.viewport?.removeEventListener('resize', this.set)
    this.viewport = win
    this.viewport.addEventListener('resize', this.set)
    this.set()
  }

  // tweb :37-41 (без `visualViewport`: у оригинала его ветка закомментирована)
  private setDimensions() {
    this._width = this.viewport!.innerWidth
    this._height = this.viewport!.innerHeight
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
