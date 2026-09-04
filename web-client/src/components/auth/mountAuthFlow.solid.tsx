/** @jsxImportSource solid-js */
/**
 * Устройство монтирования экрана входа — порт tweb `src/pages/mountAuthFlow.tsx`
 * (91 строка). Задача 6 волны 3 (этап 1, Solid-миграция auth-экрана): точка
 * монтирования переезжает с React `AuthFlow.tsx` (снесён этой же задачей) на
 * Solid `AuthCardsHost.solid.tsx`, и это её устройство.
 *
 * Единственный вызывающий — `App.tsx::ThemedApp` (layout-эффект на `!authed`,
 * см. её комментарий у вызова). Как и у оригинала: стартовый шаг ставится
 * `navigateAuth(...)` ДО монтирования (иначе `AuthCardsHost.onMount` увидит
 * пустой `currentCard()` и предупредит в консоль — она рассчитана на то, что
 * шаг уже выбран), DOM привешивается к `document.body` (не в React-дерево —
 * auth-хост позиционируется поверх всего приложения, ровно как в tweb и как
 * было у прежнего React `AuthFlow.tsx::useAuthFlowRoot`), а демонтаж — через
 * СОХРАНЁННЫЙ `dispose`.
 *
 * Само монтирование делает не `render()` напрямую, а общий мост
 * `mountSolid` (`shared/solid/mountSolid.solid.tsx`) — тот же `ErrorBoundary`,
 * что у любого другого Solid-острова приложения, без второй копии её логики.
 *
 * ── Расхождение с оригиналом: нет персистентного `AuthState` ────────────────
 * У tweb `authStateToCardSpec` мапит MTProto `AuthState`, который сервер
 * возвращает и tweb сохраняет между перезагрузками (`authStateSignIn`/
 * `authStateAuthCode`/…) — сервер сам помнит, на каком шаге застрял клиент.
 * У нас авторизация REST, промежуточных состояний бэк не хранит: единственный
 * сигнал старта — ссылка `#?tgWebAuthToken=…` (tweb `index.ts`: вход с
 * web.telegram.org), при её отсутствии всегда стартуем с `signIn` — 1:1 с
 * прежним React `AuthFlow.tsx` (`useState<Card>(() => webAuthToken ?
 * 'signImport' : 'signIn')`).
 *
 * ── `has-auth-pages` — НАША добавка сверх устройства оригинала ──────────────
 * У tweb класс стоит СТАТИКОЙ в `index.html` и снимается один раз насовсем
 * (`bootstrapIm.ts`) — полноценного возврата на экран входа БЕЗ перезагрузки
 * страницы у них не бывает, `mountAuthFlow` его вообще не трогает. У нас
 * SPA: logout переключает `authed` в React без reload (`useAuthGate`), и
 * `App.tsx::Shell` снимает класс на КАЖДОМ своём монтировании (двойным rAF,
 * чтобы не заанимировать первый кадр мессенджера, — см. её комментарий).
 * Если не возвращать класс здесь, второй заход на экран входа (после logout
 * без перезагрузки) оставил бы `.main-column` без transition-гейта до
 * следующей полной перезагрузки страницы. Снятие на dispose — тем же
 * двойным-rAF приёмом, каким это делал прежний React `AuthFlow.tsx`.
 *
 * ── Расхождение с оригиналом: нет модульного `activeDispose`/`disposeActiveAuthFlow` ──
 * У tweb `mountAuthFlow` держит модульную переменную `activeDispose` и в
 * начале функции сам гасит предыдущий монтаж, если он ещё жив («Auth flow
 * can only mount once at a time»), плюс экспортирует `disposeActiveAuthFlow()`
 * для внешнего вызывающего (`bootstrapIm`, когда IM-страница берёт управление).
 * Здесь этого нет: единственный вызывающий — `App.tsx::ThemedApp`, и его
 * `useLayoutEffect` САМ гарантирует связку 1:1 «маунт ↔ dispose» — React
 * зовёт cleanup ПРЕЖДЕ следующего эффекта той же зависимости, поэтому второй
 * одновременный монтаж физически недостижим тем же путём, каким его ловит
 * `activeDispose` у оригинала. Останется риск только при ВТОРОМ, независимом
 * вызывающем (аналоге `bootstrapIm`, которого в Solid-слое пока нет) — тогда
 * этот девиэйшн придётся снимать вместе с ним, а не раньше.
 */
import { doubleRaf } from '../../core/accountTransition'
import { mountSolid } from '../../shared/solid/mountSolid.solid'
import AuthCardsHost, { type AuthCardsHostProps } from './AuthCardsHost.solid'
import { navigateAuth, type CardSpec } from './authFlow.solid'

// tweb `index.ts`: вход с web.telegram.org приходит ссылкой `#?tgWebAuthToken=…`.
function readWebAuthToken(): string {
  const q = location.hash.indexOf('?')
  if (q === -1) return ''
  return new URLSearchParams(location.hash.slice(q + 1)).get('tgWebAuthToken') ?? ''
}

/** Порт `mountAuthFlow.tsx::authStateToCardSpec` — см. докблок файла. */
function initialCardSpec(): CardSpec {
  const webAuthToken = readWebAuthToken()
  return webAuthToken ? { name: 'signImport', payload: { webAuthToken } } : { name: 'signIn' }
}

/**
 * Монтирует экран входа и возвращает `dispose`. Порт `mountAuthFlow(authState)`.
 */
export function mountAuthFlow(props: AuthCardsHostProps): () => void {
  navigateAuth(initialCardSpec())

  const root = document.createElement('div')
  root.id = 'auth-flow-root'
  root.style.display = 'contents'
  document.body.appendChild(root)
  document.body.classList.add('has-auth-pages')

  const dispose = mountSolid(root, AuthCardsHost, props)

  return () => {
    dispose()
    root.remove()
    void doubleRaf().then(() => document.body.classList.remove('has-auth-pages'))
  }
}
