// Порт tweb `environment/overlayScrollSupport.ts`. Браузерные пороги и
// условия (`IS_MOBILE`, `CHROMIUM_VERSION < 113 || >= 145`, весь состав
// `STATIC_OVERLAY_SCROLL`) — выстраданные значения, перенесены дословно, не
// трогал ни одной цифры. `CHROMIUM_VERSION!` — `strictNullChecks` (у нас
// включён, в tweb выключен): `environment/userAgent.ts` вычисляет его через
// `try { +match[1] } catch {}` без `return` на неудаче, TS честно видит
// `number | undefined`; `!` компилируется в ничто — `undefined < 113`/
// `undefined >= 145` и без ассершна дают `false`, поведение не меняется.
//
// Единственная замена — solid-js `createMemo` на обычную функцию с кэшем в
// замыкании (вычисляется один раз при первом вызове, дальше отдаёт
// сохранённое значение): solid-js не входит в зависимости этого проекта,
// программа сознательно отказалась его вводить (см. `helpers/mediaSizes.ts`,
// `helpers/solid/readValue.ts`; закреплено в `docs/superpowers/plans/
// 2026-08-10-tweb-core-program.md`, решение координатора по блокеру Задачи 2
// — см. `task-2-report.md`). Место вызова не меняется: и Solid-мемо, и
// обычная функция вызываются как `IS_OVERLAY_SCROLL_SUPPORTED()`
// (`scrollable.ts` зовёт их именно так, без разницы для потребителя).
//
// Отличие в поведении: настоящий Solid-мемо у tweb реактивно пересчитался бы,
// если `scrollbarWidth()` (тоже сигнал) сменится посреди сессии — например,
// если пользователь на macOS живьём переключит режим отображения скроллбара
// в системных настройках. Наш кэш-в-замыкании это не подхватит: посчитан
// один раз и отдаёт то же значение до перезагрузки страницы. Компромисс
// принят координатором осознанно (см. тот же report) — случай редкий, а сама
// величина `scrollbarWidth()` в tweb тоже, по сути, измеряется один раз (её
// `observeResize`-колбэк переизмеряет тот же скрытый `div`, а не отслеживает
// реальные пользовательские действия).
import { CHROMIUM_VERSION, IS_CHROMIUM, IS_MOBILE, IS_MOBILE_SAFARI, IS_SAFARI } from '@environment/userAgent'
import scrollbarWidth from '@helpers/dom/scrollbarWidth'

export const USE_NATIVE_SCROLL = /* IS_APPLE ||  */IS_MOBILE/*  || true */

const STATIC_OVERLAY_SCROLL = IS_MOBILE ||
  (!IS_CHROMIUM && (!IS_SAFARI || IS_MOBILE_SAFARI)) ||
  CHROMIUM_VERSION! < 113 ||
  CHROMIUM_VERSION! >= 145

let _isOverlayScrollSupported: boolean | undefined
export const IS_OVERLAY_SCROLL_SUPPORTED = (): boolean => {
  if(_isOverlayScrollSupported === undefined) {
    _isOverlayScrollSupported = STATIC_OVERLAY_SCROLL && scrollbarWidth() === 0
  }
  return _isOverlayScrollSupported
}

let _useCustomScroll: boolean | undefined
export const USE_CUSTOM_SCROLL = (): boolean => {
  if(_useCustomScroll === undefined) {
    _useCustomScroll = !USE_NATIVE_SCROLL && !IS_OVERLAY_SCROLL_SUPPORTED()
  }
  return _useCustomScroll
}
