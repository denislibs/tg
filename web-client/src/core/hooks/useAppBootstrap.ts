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
import { bootData } from '../../client/bootData'

export function useAppBootstrap(): void {
  const managers = useManagers()
  useEffect(() => {
    // Под passcode-локом (решён в boot.ts до рендера) НИЧЕГО не грузим и не
    // коннектим — вся первичная загрузка + realtime стартуют один раз после
    // разблокировки. Не под локом — сразу (runWhenUnlocked дергает fn синхронно).
    const run = () => {
      // Префетч (me/listDialogs из main.tsx) переиспользуем только если старт был
      // НЕ под локом — иначе это пустышки, тянем свежие (см. bootData.locked).
      const prefetch = bootData && !bootData.locked ? { me: bootData.me, dialogs: bootData.dialogs } : undefined
      void loadChats(managers, prefetch).then(() => loadPresence(managers))
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
