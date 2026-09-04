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
import { onMount, type JSX } from 'solid-js'
import appNavigationController from '@core/navigation/appNavigationController'
import AuthCard from '../AuthCard.solid'
import Preloader from '../Preloader.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'

type Spec = Extract<CardSpec, { name: 'signImport' }>

export default function SignImportCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()

  onMount(() => {
    void managers.auth
      .signImport(props.spec.payload.webAuthToken, 'web', 'browser')
      .then((res) => {
        if (location.hash) appNavigationController.overrideHash('')
        if ('user' in res && res.user) {
          void toIm()
        } else if (res.passwordNeeded) {
          navigate({ name: 'password', payload: { token: res.passwordToken, hint: res.hint } })
        } else {
          navigate({ name: 'signIn' })
        }
      })
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
