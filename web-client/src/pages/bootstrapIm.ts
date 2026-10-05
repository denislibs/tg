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
 *  2. Опус-рекордер (`:31-37`, `:48-50`) — вендорный UMD из `public/opus/`
 *     (нетронутые байты npm, `public/opus/README.md`), поэтому грузится тегом
 *     `loadScript`, который сам кладёт `window.Recorder`, а не `import()` ESM-копии
 *     `@vendor/recorder.min.js`. Полифилл `requestVideoFrameCallback` не портирован:
 *     его единственный читатель у нас — превью кружка, а оно без rVFC берёт
 *     `loadeddata` (`chat/recording/videoRecordingPanel.solid.tsx`).
 *  3. ВРЕМЕННО до порта своих пачек: React-остров глобальных оверлеев
 *     (`#react-overlays`, `components/shell/mountGlobalOverlays.ts`) — у tweb
 *     React нет.
 */
import blurActiveElement from '@helpers/dom/blurActiveElement'
import { doubleRaf } from '@helpers/schedulers'
import { loadFonts } from '@core/dom/loadFonts'
import isNativeVoiceRecorderSupported from '@helpers/voiceRecorder/isNativeSupported'
import loadScript from '@helpers/dom/loadScript'
import { getProxiedManagers } from '@/client/bootstrap'
import { disposeActiveAuthFlow } from '@components/auth/mountAuthFlow.solid'
import { mountGlobalOverlays } from '@components/shell/mountGlobalOverlays'
import appDialogsManager from '@lib/appDialogsManager'

/** Вендор opus-recorder (расхождение 2): UMD кладёт конструктор в `window.Recorder`. */
const OPUS_RECORDER_URL = '/opus/recorder.min.js'

let bootstrapped = false

export async function bootstrapIm(): Promise<void> {
  if(bootstrapped) return
  bootstrapped = true

  const pageChatsEl = document.getElementById('page-chats')
  if(pageChatsEl) pageChatsEl.style.display = ''

  blurActiveElement()

  // Skip the opus-recorder fallback chunk entirely on browsers that have the
  // WebCodecs-based native path. Saves ~80 KB of WASM-shipping JS on every
  // sign-in for ~94% of users (May 2026 baseline).
  const recorderImport: Promise<unknown> = isNativeVoiceRecorderSupported() ?
    Promise.resolve(null) :
    loadScript(OPUS_RECORDER_URL) // расхождение 2

  await Promise.all([
    recorderImport,
    loadFonts(),
  ])

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
