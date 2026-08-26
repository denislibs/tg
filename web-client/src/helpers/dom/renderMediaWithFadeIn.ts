// Порт tweb `src/helpers/dom/renderMediaWithFadeIn.ts` — 1:1 по логике
// (формат под `.oxlintrc.json`: без `;`, явные типы вместо `any` оригинала).
//
// Центральная вставка ПОЛНОГО медиа поверх превью. Порядок операций и есть
// смысл функции:
//   1. класс `fade-in` вешается на элемент ДО загрузки — анимация стартует в
//      том же кадре, в котором медиа появляется в дереве;
//   2. медиа декодируется офскрин (`renderImageFromUrlPromise`) и только потом
//      аппендится — недекодированная картинка дала бы пустой кадр;
//   3. превью (`thumbImage`) снимается ПО СОБЫТИЮ `animationend`, а не по
//      таймеру: длительность анимации живёт в CSS, и таймер разъехался бы с ней
//      на любой правке стилей (и на `animation-level-0`, где её нет вовсе);
//   4. `no-background` на контейнере — только после того, как медиа реально
//      закрыло подложку.
//
// Оригинал восстановлен как есть — `UNMOUNT_THUMBS` в tweb константа-`true`,
// вырожденная ветка `false` не портирована (мёртвый код). Снесённый React-слой
// подложку не снимал вовсе — это было расхождение, а не решение.
//
// НЕ портирован свап `thumb→full` из медиавьювера
// (`components/mediaViewer/base.ts`, tweb base.ts:2944-2956): вопреки первому
// впечатлению это НЕ третья копия этой функции — в самом tweb вьювер идёт
// мимо `renderMediaWithFadeIn` собственным двухкадровым `fastRaf`-свапом без
// `fade-in`/`animationend`/`no-background` (полёт мувера уже держит свою
// анимацию, и класс `fade-in` конфликтовал бы с ней). Сводить их в один
// хелпер значит разойтись с оригиналом в обе стороны сразу.
import sequentialDom from '@helpers/sequentialDom'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'

const UNMOUNT_THUMBS = true

export default function renderMediaWithFadeIn({
  container,
  media,
  url,
  needFadeIn,
  aspecter = container,
  thumbImage,
  fadeInElement = media,
  onRender,
  onRenderFinish,
  useRenderCache,
}: {
  container: HTMLElement
  media: HTMLElement | HTMLImageElement | HTMLVideoElement
  url: string
  needFadeIn: boolean
  aspecter?: HTMLElement
  thumbImage?: HTMLElement
  fadeInElement?: HTMLElement
  onRender?: () => void
  onRenderFinish?: () => void
  useRenderCache?: boolean
}): Promise<void> {
  if (needFadeIn) {
    fadeInElement.classList.add('fade-in')
  }

  return renderImageFromUrlPromise(media, url, useRenderCache).then(() => {
    return sequentialDom.mutateElement(container, () => {
      aspecter.append(media)

      if (needFadeIn) {
        onRender?.()
        fadeInElement.addEventListener('animationend', () => {
          void sequentialDom.mutate(() => {
            fadeInElement.classList.remove('fade-in')
            if (UNMOUNT_THUMBS) thumbImage?.remove()
            container.classList.add('no-background')
            onRenderFinish?.()
          })
        }, { once: true })
      } else {
        if (UNMOUNT_THUMBS) thumbImage?.remove()
        container.classList.add('no-background')
        onRender?.()
        onRenderFinish?.()
      }
    })
  })
}
