// Порт tweb `src/components/prepareAlbum.ts` — 1:1 по логике; правки только под
// формат `.oxlintrc.json` (без `;`) и под `strict` (в tweb выключен):
//   • `widthItem`/`heightItem` у `Array.find` — `| undefined`, поэтому пустая
//     раскладка (0 элементов) отсекается явным `if(!widthItem || !heightItem)`
//     вместо падения на чтении `.geometry` у `undefined`. Поведение то же:
//     `Layouter.layout()` возвращает `[]` только на пустом списке, а альбома из
//     нуля медиа не бывает;
//   • `let div: HTMLElement; div = children[idx]` слито в одно объявление;
//   • закомментированные хвосты оригинала (`div.style.backgroundColor` со
//     случайным цветом, второй проход `forMedia`) не портированы.
//
// Смысл функции: `Layouter` считает геометрию альбома В ПИКСЕЛЯХ, а в DOM она
// кладётся В ПРОЦЕНТАХ от общего бокса — поэтому контейнер можно ужимать по
// ширине (адаптив, `max-width` бабла), и грид ужимается вместе с ним, не
// пересчитываясь. Скругления углов альбома живут на КРАЙНИХ элементах
// (`RectPart.Left|Top` → `border-start-start-radius` и т.д.), а не на
// контейнере: у каждой ячейки свой обрезающий бокс.
//
// Живой DOM tweb (`docs/tweb/dom/dumps/03-album-channel.json`):
//   div.attachment [style="width: 420px; height: 539px;"]
//     div.album-item.grouped-item [style="width: 100%; height: 49.9072%; top: 0%; left: 0%; …"]
//       div.album-item-media
import { Layouter, RectPart } from '@core/dom/groupedLayout'

export default function prepareAlbum(options: {
  container: HTMLElement
  items: { w: number; h: number }[]
  maxWidth: number
  minWidth: number
  spacing: number
  maxHeight?: number
  forMedia?: true
  noGroupedItem?: boolean
}) {
  const layouter = new Layouter(options.items, options.maxWidth, options.minWidth, options.spacing, options.maxHeight)
  const layout = layouter.layout()

  const widthItem = layout.find((item) => item.sides & RectPart.Right)
  const heightItem = layout.find((item) => item.sides & RectPart.Bottom)
  if (!widthItem || !heightItem) {
    return { items: [] as HTMLElement[], width: 0, height: 0 }
  }

  const width = widthItem.geometry.width + widthItem.geometry.x
  const height = heightItem.geometry.height + heightItem.geometry.y

  const container = options.container
  container.style.width = width + 'px'
  container.style.height = height + 'px'
  const children = container.children

  const items = layout.map(({ geometry, sides }, idx) => {
    let div = children[idx] as HTMLElement | undefined
    if (!div) {
      div = document.createElement('div')
      container.append(div)
    }

    div.classList.add('album-item')
    if (!options.noGroupedItem) div.classList.add('grouped-item')

    div.style.width = (geometry.width / width * 100) + '%'
    div.style.height = (geometry.height / height * 100) + '%'
    div.style.top = (geometry.y / height * 100) + '%'
    div.style.left = (geometry.x / width * 100) + '%'

    if (sides & RectPart.Left && sides & RectPart.Top) {
      div.style.borderStartStartRadius = `calc(var(--border-start-start-radius) - ${options.spacing}px)`
    }

    if (sides & RectPart.Left && sides & RectPart.Bottom) {
      div.style.borderEndStartRadius = `calc(var(--border-end-start-radius) - ${options.spacing}px)`
    }

    if (sides & RectPart.Right && sides & RectPart.Top) {
      div.style.borderStartEndRadius = `calc(var(--border-start-end-radius) - ${options.spacing}px)`
    }

    if (sides & RectPart.Right && sides & RectPart.Bottom) {
      div.style.borderEndEndRadius = `calc(var(--border-end-end-radius) - ${options.spacing}px)`
    }

    if (options.forMedia) {
      const mediaDiv = document.createElement('div')
      mediaDiv.classList.add('album-item-media')

      div.append(mediaDiv)
    }

    return div
  })

  return { items, width, height }
}
