// Порт tweb `components/putPreloader.ts` — классический круговой прелоадер.
// Разметка дословная (`putPreloader` собирает её строкой):
//
//   svg.preloader-circular[viewBox="25 25 50 50"] > circle.preloader-path
//
// `putPreloader(elem, true)` дополнительно заворачивает svg в `div.preloader` —
// это `<Preloader>`; голый svg (`putPreloader(elem)`, вариант «внутрь кнопки»)
// — это `<PreloaderCircular>`. Стили обеих форм глобальные
// (`styles/tweb/_preloader.scss`, `styles/tweb/_button.scss`).
import type { HTMLAttributes } from 'react'

/** Голый `svg.preloader-circular` — то, что tweb вставляет в кнопку соседом к `span.i18n`. */
export function PreloaderCircular() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="preloader-circular" viewBox="25 25 50 50">
      <circle className="preloader-path" cx="50" cy="50" r="20" fill="none" strokeMiterlimit="10" />
    </svg>
  )
}

/** `div.preloader > svg.preloader-circular` — tweb `putPreloader(elem, true)`. */
export default function Preloader(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="preloader" {...props}>
      <PreloaderCircular />
    </div>
  )
}
