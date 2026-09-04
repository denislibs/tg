// Порт tweb `components/putPreloader.ts` — классический круговой прелоадер.
// Разметка дословная (`putPreloader` собирает её строкой):
//
//   svg.preloader-circular[viewBox="25 25 50 50"] > circle.preloader-path
//
// `putPreloader(elem, true)` дополнительно заворачивает svg в `div.preloader` —
// это `<Preloader>`; голый svg (`putPreloader(elem)`, вариант «внутрь кнопки»)
// — это `<PreloaderCircular>`. Стили обеих форм глобальные
// (`styles/tweb/_preloader.scss`, `styles/tweb/_button.scss`).
//
// Переехал из `components/auth/Preloader.tsx` (задача 6 волны 3, снос React-
// версии экрана входа): компонент не auth-специфичен — единственный
// оставшийся React-потребитель, `components/stickers/StickerSetModal.tsx`
// (`popups/stickers.tsx:339-342` — под `.is-loading` в теле попапа лежит
// именно `putPreloader`), к экрану входа отношения не имеет. Solid-версия
// (`components/auth/Preloader.solid.tsx`) — отдельный, самостоятельный порт
// той же разметки под auth-карточки; эта копия не про экран входа, а про
// оставшиеся React-экраны — переносить её в Solid НЕ входит в периметр
// задачи 6.
//
// `PreloaderCircular` (голый вариант «внутрь кнопки») НЕ экспортируется —
// у React-стороны нет ни одного потребителя такого вида (единственным был
// снесённый `AuthButton.tsx`); внутри файла она нужна только как деталь
// реализации `<Preloader>`. У Solid-версии (`Preloader.solid.tsx`) свой
// экспорт этой же формы ЖИВОЙ — им пользуются три auth-карточки
// (`SignInCard`/`PasswordCard`/`SignUpCard.solid.tsx`).
import type { HTMLAttributes } from 'react'

/** Голый `svg.preloader-circular` — то, что tweb вставляет в кнопку соседом к `span.i18n`. Деталь реализации `<Preloader>`, наружу не экспортируется — см. докблок файла. */
function PreloaderCircular() {
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
