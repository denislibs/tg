/**
 * Порт tweb `src/pages/bootstrapIm.ts` (812502980) — процедурный подъём
 * мессенджера: показать `#page-chats`, запустить `appDialogsManager`, снять
 * `has-auth-pages` и экран входа.
 *
 * Идемпотентен: зовут его и успешный вход (`AuthCardsHost` `toIm`), и прямой
 * старт с сессией (`src/index.ts`) — второй вызов пустой.
 *
 * Расхождения с оригиналом:
 *  1. `pushToState('authState', authStateSignedIn)` (`:25`) нет — авторизация у
 *     нас REST, промежуточного `AuthState` нет (шапка `mountAuthFlow.solid.tsx`).
 *  2. Опус-рекордер и полифилл `requestVideoFrameCallback` (`:34-49`) не
 *     грузятся: запись голоса — своя (`useVoiceRecorder`, Б-30), полифилл не
 *     портирован.
 *  3. ВРЕМЕННО до порта своих пачек: React-остров глобальных оверлеев
 *     (`#react-overlays`, `components/shell/mountGlobalOverlays.ts`) — у tweb
 *     React нет.
 */
import blurActiveElement from '@helpers/dom/blurActiveElement'
import { doubleRaf } from '@helpers/schedulers'
import { loadFonts } from '@core/dom/loadFonts'
import { getProxiedManagers } from '@/client/bootstrap'
import { disposeActiveAuthFlow } from '@components/auth/mountAuthFlow.solid'
import { mountGlobalOverlays } from '@components/shell/mountGlobalOverlays'
import appDialogsManager from '@lib/appDialogsManager'

let bootstrapped = false

export async function bootstrapIm(): Promise<void> {
  if(bootstrapped) return
  bootstrapped = true

  const pageChatsEl = document.getElementById('page-chats')
  if(pageChatsEl) pageChatsEl.style.display = ''

  blurActiveElement()

  await loadFonts()

  mountGlobalOverlays(getProxiedManagers()) // расхождение 3

  appDialogsManager.start()

  // start() toggles body.is-left-column-shown synchronously
  // (appImManager.selectTab(CHATLIST)). The .main-column transform/opacity
  // transition in _chats.scss is gated by :not(.has-auth-pages) so the bar
  // doesn't slide in from its off-screen handheld state. The two class
  // changes (add is-left-column-shown, remove has-auth-pages) would
  // otherwise batch into a single style commit and the gate would have no
  // effect — yield a frame so the committed state still has has-auth-pages
  // and the transform/opacity jump is instant.
  await doubleRaf()
  document.body.classList.remove('has-auth-pages')

  // Tear down the auth UI 1s after IM appears — same delay the legacy
  // `pageIm.onFirstMount` used so the cross-fade looks right.
  setTimeout(() => {
    disposeActiveAuthFlow()
  }, 1000)
}

export default bootstrapIm
