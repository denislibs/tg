// Доступ ленты к рендереру градиента АКТИВНЫХ обоев + сам сдвиг градиента.
//
// В tweb рендерер достаётся через `chat.gradientRenderer` (chat.ts:270-272) —
// геттер, который спрашивает у модуля обоев `appChatBackground
// .getActiveGradientRenderer()` (bubbles/chatBackground.tsx:567,610-613,770-775:
// слоты обоев публикуют свой рендерер подписчикам). Лента дёргает его ровно в
// одном месте — bubbles.ts:4710-4714, в `startCallback` прокрутки к сообщению.
//
// У нас обои живут в `components/ChatBackground.tsx` (портал в body), а лента —
// в `components/Chat.tsx`; общего родителя-владельца нет, поэтому тот же самый
// «реестр активного рендерера» вынесен сюда модулем.
import type ChatBackgroundGradientRenderer from './gradientRenderer'

/** Потолок ожидания прокрутки: у tweb прогресс ограничен длительностью самой
 *  анимации прокрутки (fastSmoothScroll.ts:269), у нас прокрутка к низу
 *  императивная — ограничиваем по времени, чтобы rAF-цикл рендерера градиента
 *  не крутился бесконечно, если пин так и не случился. */
const SCROLL_TIMEOUT = 1000

let active: ChatBackgroundGradientRenderer | undefined

/** обои сообщают о своём рендерере (tweb `gradientRendererRef`) */
export function setActiveGradientRenderer(renderer: ChatBackgroundGradientRenderer | undefined) {
  active = renderer
}

/** tweb `appChatBackground.getActiveGradientRenderer()` */
export function getActiveGradientRenderer(): ChatBackgroundGradientRenderer | undefined {
  return active
}

/**
 * Сдвинуть градиент на одну позицию вместе с прокруткой контейнера к низу —
 * порт tweb bubbles.ts:4710-4714 (`gradientRenderer?.toNextPosition(dimensions
 * .getProgress)` из `startCallback` прокрутки).
 *
 * Ключевое: аргумент `getProgress` обязателен. Без него `toNextPosition` уходит
 * в ветку САМОанимации (gradientRenderer.ts:258-288) и фон едет сам по себе —
 * именно это и выглядело как «много нажимаешь — фон сам меняется».
 *
 * tweb отдаёт прогресс своей анимации прокрутки (fastSmoothScroll.ts:269,
 * время/длительность). У нас прокрутка к низу императивная (useChatScroll
 * .correctScroll пишет `scrollTop` по ResizeObserver), поэтому прогресс считается
 * по фактически пройденному пути.
 *
 * @returns было ли что сдвигать. `false` — прокрутки не будет (мы уже у низа или
 *   обои без градиента), и сдвиг не случился: у tweb в этом случае `startCallback`
 *   просто не позовётся, а флаг `updateGradient` дождётся следующей прокрутки.
 */
export function shiftGradientWithScroll(scroller: HTMLElement): boolean {
  const renderer = active
  if (!renderer) return false

  const from = scroller.scrollTop
  const path = scroller.scrollHeight - scroller.clientHeight - from
  if (path < 1) return false

  const startAt = Date.now()
  renderer.toNextPosition(() => {
    if (Date.now() - startAt > SCROLL_TIMEOUT) return 1
    const progress = (scroller.scrollTop - from) / path
    return progress <= 0 ? 0 : progress >= 1 ? 1 : progress
  })
  return true
}
