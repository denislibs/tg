/** @jsxImportSource solid-js */
// Preloader — Solid-порт нашего React `auth/Preloader.tsx` (сам он — порт tweb
// `components/putPreloader.ts`, классический круговой прелоадер). Разметка
// дословная (`putPreloader` собирает её строкой):
//
//   svg.preloader-circular[viewBox="25 25 50 50"] > circle.preloader-path
//
// `putPreloader(elem, true)` дополнительно заворачивает svg в `div.preloader`
// — это `<Preloader>`; голый svg (вариант «внутрь кнопки») — `<PreloaderCircular>`.
// Стили обеих форм — глобальные (`styles/tweb/_preloader.scss`, `_button.scss`).
import type { JSX } from 'solid-js'

/** Голый `svg.preloader-circular` — то, что tweb вставляет в кнопку соседом к `span.i18n`. */
export function PreloaderCircular(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
      <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10" />
    </svg>
  )
}

/** `div.preloader > svg.preloader-circular` — tweb `putPreloader(elem, true)`. */
export default function Preloader(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div class="preloader" {...props}>
      <PreloaderCircular />
    </div>
  )
}
