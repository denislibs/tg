/** @jsxImportSource solid-js */
/**
 * Устройство монтирования экрана входа — порт tweb `src/pages/mountAuthFlow.tsx`
 * (91 строка). Задача 6 волны 3 (этап 1, Solid-миграция auth-экрана): точка
 * монтирования переезжает с React `AuthFlow.tsx` (снесён этой же задачей) на
 * Solid `AuthCardsHost.solid.tsx`, и это её устройство.
 *
 * Вызывающий — `src/index.ts` (старт без сессии, tweb `index.ts:640-641`). Как и у оригинала: стартовый шаг ставится
 * `navigateAuth(...)` ДО монтирования (иначе `AuthCardsHost.onMount` увидит
 * пустой `currentCard()` и предупредит в консоль — она рассчитана на то, что
 * шаг уже выбран), DOM привешивается к `document.body` (не в React-дерево —
 * auth-хост позиционируется поверх всего приложения, ровно как в tweb), а
 * демонтаж — через СОХРАНЁННЫЙ `dispose`.
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
 * ── Модульный `activeDispose` и `disposeActiveAuthFlow` — как у оригинала ──
 * `mountAuthFlow.tsx:28`, `:62`: монтаж один — повторный вызов гасит прежний;
 * `disposeActiveAuthFlow()` зовёт `bootstrapIm` через секунду после показа
 * мессенджера (`pages/bootstrapIm.ts`, tweb `:65-67`). `has-auth-pages` этот
 * файл не трогает: класс стоит статикой в `index.html` и снимается один раз
 * насовсем в `bootstrapIm` — выход из аккаунта перезагружает страницу
 * (`src/index.ts::onLoggedOut`), второго захода на экран входа без
 * перезагрузки больше нет. HMR-ветки оригинала (`import.meta.hot.data`) нет:
 * `npm run dev` здесь — `vite build --watch`, `import.meta.hot` всегда
 * `undefined`.
 */
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

let activeDispose: (() => void) | null = null

/**
 * Монтирует экран входа и возвращает `dispose`. Порт `mountAuthFlow(authState)`.
 */
export function mountAuthFlow(props: AuthCardsHostProps): () => void {
  // Auth flow can only mount once at a time — clean up any previous instance.
  if(activeDispose) {
    activeDispose()
  }

  navigateAuth(initialCardSpec())

  const root = document.createElement('div')
  root.id = 'auth-flow-root'
  root.style.display = 'contents'
  document.body.appendChild(root)

  const { dispose } = mountSolid(root, AuthCardsHost, props)

  activeDispose = () => {
    dispose()
    root.remove()
    activeDispose = null
  }

  return activeDispose
}

/**
 * Tear down the currently mounted `<AuthCardsHost>` if any. Called from
 * `bootstrapIm` once the IM page has taken over.
 */
export function disposeActiveAuthFlow(): void {
  activeDispose?.()
}
