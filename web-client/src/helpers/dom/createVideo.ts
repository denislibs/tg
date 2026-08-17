// Порт tweb `src/helpers/dom/createVideo.ts` в применимом объёме.
//
// Функция крошечная, но каждая её строка — не декорация:
//   • `disablePictureInPicture` по умолчанию — инлайн-видео ленты и снапшоты
//     мувера не должны предлагать PiP; `pip: true` снимает запрет ровно для
//     живого видео плеера (tweb createVideo:22);
//   • `playsinline` — без него iOS Safari уводит ЛЮБОЕ воспроизведение в
//     нативный полноэкранный плеер, то есть автоплей гифки в бабле открывал бы
//     системный оверлей;
//   • `middleware.onDestroy` → `src=''` + `load()` — снятие видео с ленты
//     обязано отпустить сетевой запрос и декодер, иначе прокрутка ленты
//     копит живые загрузки. Уборка ждёт `getHeavyAnimationPromise()`: `load()`
//     синхронно роняет декодер, и посреди тяжёлой анимации это заметный фриз.
//
// НЕ портировано (у нас нет предмета):
//   • `initVideoHls` / ветка `src.startsWith('hls/')` — HLS-качеств нет;
//   • `updateStreamInUse` + `serviceMessagePort.invokeVoid('toggleStreamInUse')`
//     — учёт живых стримов в service worker'е tweb; наш SW range-запросы не
//     реф-каунтит. Вместе с ними отпадает и `Object.defineProperty(video,'src')`
//     оригинала: перехват сеттера существовал ТОЛЬКО ради этих двух веток, а
//     без них он лишь ломал бы штатный `src` (в т.ч. уборку выше).
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import type { Middleware } from '@helpers/middleware'

export default function createVideo({ pip, middleware }: {
  pip?: boolean
  middleware?: Middleware
}): HTMLVideoElement {
  const video = document.createElement('video')
  if (!pip) video.disablePictureInPicture = true
  video.setAttribute('playsinline', 'true')

  middleware?.onDestroy(async () => {
    await getHeavyAnimationPromise()
    video.src = ''
    video.load()
  })

  return video
}
