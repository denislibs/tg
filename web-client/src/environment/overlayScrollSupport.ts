// Порт tweb `environment/overlayScrollSupport.ts`. Браузерные пороги и
// условия (`IS_MOBILE`, `CHROMIUM_VERSION < 113 || >= 145`, весь состав
// `STATIC_OVERLAY_SCROLL`) — выстраданные значения, перенесены дословно, не
// трогал ни одной цифры. `CHROMIUM_VERSION!` — `strictNullChecks` (у нас
// включён, в tweb выключен): `environment/userAgent.ts` вычисляет его через
// `try { +match[1] } catch {}` без `return` на неудаче, TS честно видит
// `number | undefined`; `!` компилируется в ничто — `undefined < 113`/
// `undefined >= 145` и без ассершна дают `false`, поведение не меняется.
//
// Единственная замена — solid-js `createMemo` на обычную функцию:
// `IS_OVERLAY_SCROLL_SUPPORTED`/`USE_CUSTOM_SCROLL` просто пересчитывают своё
// выражение при каждом вызове, без кэша. Место вызова не меняется: и
// Solid-мемо, и обычная функция вызываются как `IS_OVERLAY_SCROLL_SUPPORTED()`
// (`scrollable.ts` зовёт их именно так, без разницы для потребителя).
//
// **Почему без кэша, хотя первая версия этого шима его заводила** (см. правку
// по итогам ревью Задачи 2, `task-2-report.md`): `scrollbarWidth()` — НЕ
// статичное значение, оно намеренно живое. В `helpers/dom/scrollbarWidth.ts`
// зашит переизмеритель на `ResizeObserver` с комментарием апстрима «When
// macOS switches scrollbar mode, inner div resizes → callback fires» — то
// есть tweb специально сделал так, чтобы значение менялось во времени (macOS
// System Settings → Appearance → «Show scroll bars»: «Always» ↔ «When
// scrolling» посреди открытой вкладки), а `createMemo` специально сделан,
// чтобы это подхватывать. Кэш-в-замыкании из первой версии залипал бы на
// первом прочитанном значении до перезагрузки страницы — расхождение с tweb,
// а не эквивалент. `STATIC_OVERLAY_SCROLL && scrollbarWidth() === 0` —
// булево «и» плюс чтение уже посчитанного поля (сама лень — внутри
// `scrollbarWidth()`, не здесь), пересчитывать на каждый вызов дешевле, чем
// проверять и поддерживать кэш.
import { CHROMIUM_VERSION, IS_CHROMIUM, IS_MOBILE, IS_MOBILE_SAFARI, IS_SAFARI } from '@environment/userAgent'
import scrollbarWidth from '@helpers/dom/scrollbarWidth'

export const USE_NATIVE_SCROLL = /* IS_APPLE ||  */IS_MOBILE/*  || true */

const STATIC_OVERLAY_SCROLL = IS_MOBILE ||
  (!IS_CHROMIUM && (!IS_SAFARI || IS_MOBILE_SAFARI)) ||
  CHROMIUM_VERSION! < 113 ||
  CHROMIUM_VERSION! >= 145

export const IS_OVERLAY_SCROLL_SUPPORTED = (): boolean => STATIC_OVERLAY_SCROLL && scrollbarWidth() === 0
export const USE_CUSTOM_SCROLL = (): boolean => !USE_NATIVE_SCROLL && !IS_OVERLAY_SCROLL_SUPPORTED()
