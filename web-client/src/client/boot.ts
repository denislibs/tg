// Единая точка холодного старта (аналог tweb index.ts): регистрируем SW, поднимаем
// воркер, СРАЗУ запускаем критические RPC (me + список диалогов), готовим всё, что
// нужно до первого кадра — offline-first кэш чатов и активный словарь — и отдаём
// managers для рендера. Всё, что можно, делается параллельно и до React.
import { startClient, type Managers } from './bootstrap'
import { installBridgeHandoff } from './dnpBridgeHandoff'
import { initPwaInstall } from '../core/pwa'
import { getInitial, loadLang } from '../i18n'
import { setBootData } from './bootData'
import { hydrateDialogsFromPersist } from '../stores/dialogsPersist'
import { persistScope } from '../core/store/persist'
import { idbGet } from '../core/store/idbKv'
import { useSettingsStore } from '../settings'
import { useLockStore } from '../stores/lockStore'
import { preventCrossTabDynamicImportDeadlock } from '../core/preventDeadlock'
import type { User } from '../core/managers/authManager'
import type { Dialog } from '../core/models'

const TOKEN_KEY = 'session_token' // тот же ключ, что у TokenStore/dialogsPersist

export async function bootstrap(): Promise<{ managers: Managers }> {
  // В самом начале boot (как tweb index.ts): ждём один кадр анимации, чтобы
  // отложить последующие dynamic import и не словить кросс-табовый deadlock
  // загрузки модулей в Chrome (см. preventDeadlock.ts). До решения о passcode-локе
  // и до любого ленивого import.
  await preventCrossTabDynamicImportDeadlock()

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
  }
  // Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
  initPwaInstall()

  const { managers, ep } = startClient()
  // DNP-ON: раздаём мост SW↔SharedWorker (self-gated; инертно при DNP-off).
  installBridgeHandoff(ep)

  // #0 — решение о passcode-локе ДО любых RPC/коннекта. passcodeEnabled лежит в
  // localStorage (tg-settings, читается синхронно на создании стора), поэтому лок
  // ставится до первого кадра. Под локом НЕ префетчим me/dialogs и не гидрируем —
  // WS/RPC поднимет useAppBootstrap/useAuthGate уже после разблокировки.
  const locked = useSettingsStore.getState().passcodeEnabled
  if (locked) useLockStore.getState().lock()

  // #1 — критические запросы стартуют до рендера: к моменту mount ответ уже летит.
  // Переиспользуются в useAuthGate/первом loadChats (через bootData) — без второго
  // round-trip me(). Под локом — пустышки (см. bootData.locked).
  const me: Promise<User | null> = locked ? Promise.resolve(null) : managers.auth.me()
  const dialogs: Promise<Dialog[]> = locked ? Promise.resolve([]) : managers.chats.listDialogs()

  // #2 — offline-first кэш чатов + словарь языка + наличие токена: всё до первого
  // кадра, чтобы сразу показать последний известный UI без мигания и решить authed
  // локально (по токену), а не по сети. persistScope до hydrate стирает данные
  // предыдущего аккаунта (мультиаккаунт), чтобы стор не поднял чужой список.
  const token = await idbGet<string>(TOKEN_KEY)
  await persistScope(token ?? null)
  const [hydratedFromCache] = await Promise.all([
    locked ? Promise.resolve(false) : hydrateDialogsFromPersist(),
    loadLang(getInitial()),
  ])
  setBootData({ me, dialogs, hydratedFromCache, hasToken: !!token, locked })

  return { managers }
}
