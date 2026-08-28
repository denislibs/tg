// Доступ ленты к рендереру градиента АКТИВНЫХ обоев — РЕЕСТР, и только он.
//
// В tweb рендерер достаётся через `chat.gradientRenderer` (chat.ts:270-272) —
// геттер, который спрашивает у модуля обоев `appChatBackground
// .getActiveGradientRenderer()` (bubbles/chatBackground.tsx:567,610-613,770-775:
// слоты обоев публикуют свой рендерер подписчикам). Лента дёргает его ровно в
// одном месте — bubbles.ts:4710-4714, в `startCallback` прокрутки к сообщению;
// у нас там же — `chat/bubbles.ts::scrollToBubble`, и сам сдвиг
// (`toNextPosition(dimensions.getProgress)`) живёт ТАМ, как в оригинале: длину
// прокрутки знает только прокручивающий.
//
// У нас обои живут в `components/ChatBackground.tsx` (портал в body), а лента —
// в `components/Chat.tsx`; общего родителя-владельца нет, поэтому тот же самый
// «реестр активного рендерера» вынесен сюда модулем.
import type ChatBackgroundGradientRenderer from './gradientRenderer'

/**
 * Мета активных обоев, которая нужна ЗЕРКАЛУ градиента (tweb
 * `ActiveBackgroundMeta`, bubbles/chatBackground.tsx:60).
 *
 * `isDarkMaskPattern` — тёмный узор через маску (ночная тема): сам градиент при
 * этом остаётся ярким, темноту даёт узор-маска поверх него. Зеркало узора не
 * повторяет, поэтому потребитель обязан дотемнить свою подложку сам — иначе на
 * тёмном чате колонка светится ярким градиентом (tweb chatBackground.tsx:528-533).
 */
export type ActiveBackgroundMeta = { isDarkMaskPattern: boolean }

type RendererListener = (r: ChatBackgroundGradientRenderer | undefined, meta?: ActiveBackgroundMeta) => void

let active: ChatBackgroundGradientRenderer | undefined
let activeMeta: ActiveBackgroundMeta | undefined
const listeners = new Set<RendererListener>()

/** обои сообщают о своём рендерере (tweb `gradientRendererRef`) */
export function setActiveGradientRenderer(
  renderer: ChatBackgroundGradientRenderer | undefined,
  meta?: ActiveBackgroundMeta,
) {
  active = renderer
  activeMeta = meta
  for (const listener of listeners) listener(active, activeMeta)
}

/** tweb `appChatBackground.getActiveGradientRenderer()` */
export function getActiveGradientRenderer(): ChatBackgroundGradientRenderer | undefined {
  return active
}

/**
 * Подписка на смену рендерера активных обоев (tweb
 * `appChatBackground.onActiveGradientRendererChange`, chatBackground.tsx:762-775):
 * слушатель зовётся текущим значением СРАЗУ при подписке, возвращается отписка.
 * Потребитель — колонка папок: она зеркалит градиент в свой холст вместо
 * дорогого `backdrop-filter: blur(40px)`.
 */
export function onActiveGradientRendererChange(listener: RendererListener): () => void {
  listeners.add(listener)
  listener(active, activeMeta)
  return () => {
    listeners.delete(listener)
  }
}
