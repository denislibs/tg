/**
 * Точка входа — порт tweb `src/index.ts` (812502980), обработчик
 * `DOMContentLoaded` (`:417-675`). Модульный `<script>` (`index.html`) исполняется
 * после разбора документа, поэтому ждать события не нужно.
 *
 * Тело до развилки (код-пароль, состояние, лангпак, тема, фон) — наш
 * `client/boot.ts::bootstrap()` (`:453-612`). Здесь — то, что вокруг:
 *  • `setRootClasses`/`setSidebarLeftWidth` в начале (`:420-430`);
 *  • развилка `:613-673`: без сессии — `mountAuthFlow` (`:640-641`), с сессией —
 *    `fadeInWhenFontsReady(#main-columns)` (`:645-646`), анимация входа
 *    `should_animate_main` (`:650-669`, у нас `ANIMATE_MAIN_KEY`) и
 *    `bootstrapIm()`;
 *  • выход и смена сессии — перезагрузкой (`onLoggedOut`, tweb
 *    `lib/apiManagerProxy.ts:619-634`, `:676-704`).
 *
 * Расхождения с оригиналом:
 *  1. Сессия решается по наличию токена (`hasToken`), а не по `authState`
 *     (авторизация REST, шапка `components/auth/mountAuthFlow.solid.tsx`).
 *     Истёкшую сессию ловит фоновый `me()`: `null` — стереть персист и
 *     перезагрузиться на экран входа (у tweb это делает 401 сетевого слоя).
 *  2. `singleInstance`, вход по t.me, `tgWebAuthToken`-импорт до развилки,
 *     состояние вкладок — Б-17 плана волны 7 (вне волны); `tgWebAuthToken`
 *     разбирает сам экран входа (`mountAuthFlow.solid.tsx::initialCardSpec`).
 *  3. Сверх оригинала: опрос версии сборки (`startVersionCheck`, у tweb —
 *     `checkForUpdates` бургера, О-100).
 *  4. `setSidebarLeftWidth`: «свёрнута» — запомненная настройка и НЕ плавающий
 *     диапазон (≤ 925px), а у tweb — и не мобильный (расхождение 3 шапки
 *     `stores/foldersSidebar.solid.ts`); плюс наш полноширинный режим колонки
 *     на узком экране (≤ 900px, класс `is-full-width`,
 *     `components/sidebarLeft/columnLeft.scss`).
 */
import './styles/index.scss'
import '@components/sidebarLeft/columnLeft.scss'
import { createEffect, createRoot } from 'solid-js'
import { bootstrap } from './client/boot'
import { bootPrefetch, invalidateBootPrefetch } from './client/bootData'
import type { Managers } from './client/bootstrap'
import { loadFonts, fadeInWhenFontsReady } from './core/dom/loadFonts'
import { setRootClasses } from './core/dom/rootClasses'
import { isUserCollapsedLeft } from './core/dom/updateColumnWidths'
import mediaSizes from './core/dom/mediaSizes'
import { ANIMATE_MAIN_KEY } from './core/accountTransition'
import { RT } from './core/realtime/events'
import appNavigationController from './core/navigation/appNavigationController'
import { startVersionCheck } from './core/version/versionCheck'
import { mountAuthFlow } from './components/auth/mountAuthFlow.solid'
import { useIsSidebarCollapsed } from './stores/foldersSidebar.solid'
import { saveEncryptionKeyForHandoff } from '@lib/passcode/keyHandoff'
import rootScope from '@lib/rootScope'
import { doubleRaf } from '@helpers/schedulers'
import pause from '@helpers/schedulers/pause'

/** Ширина колонки «во всю ширину» — наша раскладка (расхождение 4). */
const FULL_WIDTH_QUERY = '(max-width:900px)'

/** tweb `:205-235` — см. расхождение 4. */
export function setSidebarLeftWidth() {
  const columnEl = document.getElementById('column-left')!
  const fullWidth = window.matchMedia(FULL_WIDTH_QUERY)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useIsSidebarCollapsed()
  const update = () => {
    setIsSidebarCollapsed(isUserCollapsedLeft() && !mediaSizes.isLessThanFloatingLeftSidebar)
    columnEl.classList.toggle('is-full-width', fullWidth.matches)
  }
  update()
  mediaSizes.addEventListener('resize', update)
  fullWidth.addEventListener('change', update)
  createRoot(() => {
    createEffect(() => {
      columnEl.classList.toggle('is-collapsed', isSidebarCollapsed())
    })
  })
}

/**
 * tweb `apiManagerProxy.ts:619-634` (`logging_out`) + `onLoggedOut` `:676-704`:
 * переход активной сессии — перезагрузка. Намерение объявляет владелец токена
 * (`authManager` → `rt:logging_out`/`rt:logged_in`, `web-client/CLAUDE.md`
 * «Владение фактами»), кадр приходит всем вкладкам, включая инициатора (его
 * анимация выхода играет ДО команды).
 *  • `migrateTo === null` — активного аккаунта не осталось: стереть персист и
 *    перезагрузиться без хэша и query на экран входа.
 *  • `migrateTo !== null` — токен переехал на другой вошедший аккаунт (а
 *    `rt:logged_in` — новая сессия под открытой страницей): перезагрузиться под
 *    ним. Под код-паролем ключ переезжает через `window.sessionStorage` вкладки
 *    (tweb 65c6ea8f8), код не спрашивается заново.
 */
export function listenSessionTransitions(managers: Managers) {
  const reloadKeepingKey = () => {
    void saveEncryptionKeyForHandoff().finally(() => appNavigationController.reload())
  }

  rootScope.addEventListener(RT.loggingOut, ({ migrateTo }) => {
    invalidateBootPrefetch()
    if(migrateTo !== null) {
      reloadKeepingKey()
      return
    }

    void managers.persist.clearAll().finally(() => onLoggedOut())
  })

  rootScope.addEventListener(RT.loggedIn, () => {
    invalidateBootPrefetch()
    reloadKeepingKey()
  })
}

function onLoggedOut() {
  const url = new URL(location.href)
  url.hash = ''
  url.search = ''
  appNavigationController.reload(url)
}

/**
 * Расхождение 1: подтверждение сессии сетью. Префетч `me` старта — тот же
 * запрос, что `client/boot.ts` пустил до первого кадра.
 */
export function confirmSession(managers: Managers) {
  ;(bootPrefetch()?.me ?? managers.auth.me())
    .then((user) => {
      if(user) return
      // сессия истекла — сбрасываем персист и уходим на экран входа
      void managers.persist.clearAll().finally(() => onLoggedOut())
    })
    .catch(() => {
      // сеть недоступна — с валидным токеном остаёмся офлайн
    })
}

export async function start() {
  setRootClasses()
  setSidebarLeftWidth()

  const { managers, hasToken } = await bootstrap()
  startVersionCheck()
  listenSessionTransitions(managers)

  if(!hasToken) {
    mountAuthFlow({ managers })
    return
  }

  confirmSession(managers)

  const fontsPromise = loadFonts()
  void fadeInWhenFontsReady(document.getElementById('main-columns'))

  const { bootstrapIm } = await import('./pages/bootstrapIm')
  const shouldAnimate = !!localStorage.getItem(ANIMATE_MAIN_KEY)

  const pageChatsEl = document.getElementById('page-chats') as HTMLDivElement

  if(shouldAnimate) {
    localStorage.removeItem(ANIMATE_MAIN_KEY)
    pageChatsEl.classList.add('main-screen-enter')

    await bootstrapIm()
    await fontsPromise

    await doubleRaf()
    pageChatsEl.classList.add('main-screen-entering')
    await pause(200)

    pageChatsEl.classList.remove('main-screen-enter', 'main-screen-entering')
  } else {
    await bootstrapIm()
  }
}

// Точку входа исполняет браузер при загрузке модуля; тесты импортируют функции
// выше и зовут `start()` сами (`src/index.test.ts`).
if(import.meta.env.MODE !== 'test') void start()
