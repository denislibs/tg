/** @jsxImportSource solid-js */
// SignImportCard — импорт сессии по одноразовому веб-токену из ссылки
// `#?tgWebAuthToken=…`. Solid-порт нашей React `cards/SignImportCard.tsx`
// (которая сама — порт tweb `pages/cards/SignImportCard.tsx`, 80 строк).
//
// Карточка живёт доли секунды: на монтировании кладётся прелоадер и сразу
// уходит обмен токена на сессию. Дерево 1:1 с живым tweb / нашей React-версией
// (dom-референс §2.7):
//
//   div.card                    ← БЕЗ page-модификатора и БЕЗ .input-wrapper
//     div                       ← preloaderHostEl, высота 0
//       div.preloader
//         svg.preloader-circular
//           circle.preloader-path
//
// ── Зачистка адреса — ЕДИНСТВЕННЫЙ писатель истории ─────────────────────────
// tweb чистит хеш до навигации: перезагрузка не должна снова тащить сгоревший
// токен в этот же экран. Пишет ИМЕННО `appNavigationController.overrideHash`
// (задача 4, ОСТАТОК #108 — порт tweb/src/index.ts:579 для того же хэша
// `#?tgWebAuthToken=…`), а не свой `history.replaceState(null, …)` мимо него:
// запись с `null` вместо `this.id` не опознаётся проверкой `id === this.id`
// в его же `_onPopState`. Сохранено дословно из React-версии.
//
// ── НАХОДКА 1 (ревью задачи 5): сетевой отказ — не вечный прелоадер ─────────
// `authManager.signImport` перебрасывает НЕ-`HttpError` наружу как есть
// (`core/managers/authManager.ts::signImport`: `if (!(e instanceof
// HttpError)) throw e`) — обрыв сети или отказ worker-RPC не укладывается в
// дискриминированный `SignImportResult`. Прежняя редакция висела на голом
// `.then()`: такой отказ давал необработанное отклонение промиса, карточка
// оставалась с прелоадером навсегда, а хеш — невычищенным (перезагрузка
// тащит тот же мёртвый экран обратно). У tweb ЛЮБАЯ ошибка (не только
// дискриминированные ветки) уходит на дефолтный экран (`SignImportCard.
// tsx:53-66`, ветка `default:`) — здесь `catch` делает то же самое явно.
import { onMount, type JSX } from 'solid-js'
import appNavigationController from '@core/navigation/appNavigationController'
import AuthCard from '../AuthCard.solid'
import Preloader from '../Preloader.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'

type Spec = Extract<CardSpec, { name: 'signImport' }>

export default function SignImportCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()

  onMount(() => {
    void (async () => {
      try {
        const res = await managers.auth.signImport(props.spec.payload.webAuthToken, 'web', 'browser')
        if (location.hash) appNavigationController.overrideHash('')
        if ('user' in res && res.user) {
          void toIm()
        } else if (res.passwordNeeded) {
          navigate({ name: 'password', payload: { token: res.passwordToken, hint: res.hint } })
        } else {
          navigate({ name: 'signIn' })
        }
      } catch {
        // Сеть/воркер — тот же дефолтный экран, что и любой дискриминированный
        // отказ (см. докблок «НАХОДКА 1»); зачистка хеша та же самая.
        if (location.hash) appNavigationController.overrideHash('')
        navigate({ name: 'signIn' })
      }
    })()
  })

  return (
    <AuthCard inputWrapper={false}>
      {/* высота хоста — 0: `.preloader` позиционирован абсолютно и вылезает вверх */}
      <div>
        <Preloader />
      </div>
    </AuthCard>
  )
}
