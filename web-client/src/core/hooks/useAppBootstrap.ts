// Первичная загрузка данных приложения при входе в Shell: чаты/презенс, истории,
// настройки уведомлений/приватности, папки, черновики, звёзды + запуск realtime,
// web-push, бейджа непрочитанных и синхронизация настроек кэша в SW. Командный
// путь (managers/load*) — допустим из хука; realtimeBridge остаётся единственным
// каналом «сервер→стор».
import { useEffect } from 'react'
import { useManagers } from './useManagers'
import { loadChats, loadPresence } from '../../stores/chatsStore'
import { loadStories } from '../../stores/storiesStore'
import { loadNotifySettings } from '../../stores/notifyStore'
import { loadFolders } from '../../stores/foldersStore'
import { loadPrivacy } from '../../stores/privacyStore'
import { loadDrafts } from '../../stores/draftsStore'
import { loadStars } from '../../stores/starsStore'
import { runWhenUnlocked } from '../../stores/lockStore'
import { primeMediaToken } from '../mediaUrl'
import { syncCacheSettingsToSW } from '../mediaCache'
import { startRealtime } from '../../client/realtimeBridge'
import { setupPush } from '../../client/pushSetup'
import { initAppBadge } from '../../client/appBadge'
import { useSettingsStore } from '../../settings'
import { bootPrefetch } from '../../client/bootData'

export function useAppBootstrap(): void {
  const managers = useManagers()
  useEffect(() => {
    // Под passcode-локом (решён в boot.ts до рендера) НИЧЕГО не грузим и не
    // коннектим — вся первичная загрузка + realtime стартуют один раз после
    // разблокировки. Не под локом — сразу (runWhenUnlocked дергает fn синхронно).
    const run = () => {
      // Префетч (me/диалоги из main.tsx) берём ТОЛЬКО через bootPrefetch():
      // он одноразовый по смыслу (данные аккаунта, под которым страница
      // загрузилась), а этот эффект отрабатывает заново на каждое монтирование
      // Shell — см. докблок bootPrefetch. null → идём в сеть под текущим токеном.
      const prefetch = bootPrefetch() ?? undefined
      void loadChats(managers, prefetch)
      // Task 6 (перенос владения диалогами): диалоговая половина `loadChats`
      // снесена — на холодном старте (prefetch есть) список уже поднят и
      // применён к зеркалу ДО первого рендера (`client/boot.ts::
      // applyDialogsMirror`), повторный refresh() здесь плодил бы второй
      // /chats на каждое монтирование Shell. На тёплом входе БЕЗ reload (та же
      // жизнь страницы — вход/переезд сессии, useAuthGate.ts::onLoggedIn)
      // bootPrefetch() уже инвалидирован (invalidateBootPrefetch) — тогда это
      // единственное место, которое подтягивает диалоги новой сессии (owner
      // сам решает cache-first/сеть внутри refresh()→hydrate()).
      const dialogsReady = prefetch ? Promise.resolve() : managers.dialogs.refresh()
      void dialogsReady.then(() => loadPresence(managers))
      void loadStories(managers)
      void loadNotifySettings(managers)
      void loadFolders(managers)
      void loadPrivacy(managers)
      void loadDrafts(managers)
      void loadStars(managers)
      void primeMediaToken() // cache the media token so media bubbles build URLs sync
      // SW чистит медиакэш по TTL/лимиту при получении настроек (tweb clearOldCache)
      const { cacheTTL, cacheSize } = useSettingsStore.getState()
      syncCacheSettingsToSW(cacheTTL, cacheSize)
      startRealtime()
      initAppBadge() // счётчик непрочитанных: title/favicon/PWA-бейдж
      // offline-уведомления (web push) подписываем только если не выключены в настройках
      if (useSettingsStore.getState().notifyPush) void setupPush()
    }
    return runWhenUnlocked(run)
  }, [managers])
}
