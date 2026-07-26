// Единая точка холодного старта (аналог tweb index.ts): регистрируем SW, поднимаем
// воркер, СРАЗУ запускаем критические RPC (me + список диалогов), готовим всё, что
// нужно до первого кадра — offline-first кэш чатов и активный словарь — и отдаём
// managers для рендера. Всё, что можно, делается параллельно и до React.
import { startClient, type Managers } from './bootstrap'
import { initPwaInstall } from '../core/pwa'
import { getInitial, loadLang } from '../i18n'
import { setBootData } from './bootData'
import { hydrateChatsFromCache } from '../stores/chatsCache'
import { idbGet } from '../core/store/idbKv'

const TOKEN_KEY = 'session_token' // тот же ключ, что у TokenStore/chatsCache

export async function bootstrap(): Promise<{ managers: Managers }> {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
  }
  // Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
  initPwaInstall()

  const { managers } = startClient()

  // #1 — критические запросы стартуют до рендера: к моменту mount ответ уже летит.
  // Переиспользуются в useAuthGate/первом loadChats (через bootData) — без второго
  // round-trip me().
  const me = managers.auth.me()
  const dialogs = managers.chats.listDialogs()

  // #2 — offline-first кэш чатов + словарь языка + наличие токена: всё до первого
  // кадра, чтобы сразу показать последний известный UI без мигания и решить authed
  // локально (по токену), а не по сети.
  const [hydratedFromCache, , token] = await Promise.all([
    hydrateChatsFromCache(),
    loadLang(getInitial()),
    idbGet<string>(TOKEN_KEY),
  ])
  setBootData({ me, dialogs, hydratedFromCache, hasToken: !!token })

  return { managers }
}
