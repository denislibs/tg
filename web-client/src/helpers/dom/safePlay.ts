// Порт tweb `helpers/dom/safePlay.ts` 1:1: play() без unhandled rejection —
// autoplay-политики браузера легитимно отклоняют вызов вне жеста.
import noop from '@helpers/noop'

export default function safePlay(media: { play: () => unknown }) {
  try {
    const promise = media.play()
    if (promise instanceof Promise) {
      promise.catch(noop)
    }
  } catch (e) {
    console.error(e)
  }
}
