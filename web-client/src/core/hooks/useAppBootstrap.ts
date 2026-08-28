// Первичная загрузка данных приложения при входе в Shell: чаты/презенс, истории,
// настройки уведомлений/приватности, папки, черновики, звёзды + запуск realtime,
// web-push, бейджа непрочитанных и синхронизация настроек кэша в SW. Командный
// путь (managers/load*) — допустим из хука; realtimeBridge остаётся единственным
// каналом «сервер→стор».
import { useEffect } from 'react'
import { useManagers } from './useManagers'
import { loadChats, loadPresence, startPresenceDegradation } from '../../stores/chatsStore'
import { loadStories } from '../../stores/storiesStore'
import { loadNotifySettings } from '../../stores/notifyStore'
import { loadFolders } from '../../stores/foldersStore'
import { loadPrivacy } from '../../stores/privacyStore'
import { loadStars } from '../../stores/starsStore'
import { runWhenUnlocked } from '../../stores/lockStore'
import { primeMediaToken } from '../mediaUrl'
import { syncCacheSettingsToSW } from '../mediaCache'
import { startRealtime } from '../../client/realtimeBridge'
import { setupPush } from '../../client/pushSetup'
import { initAppBadge } from '../../client/appBadge'
import { useSettingsStore } from '../../settings'
import { bootPrefetch, bootWasLocked } from '../../client/bootData'
import { fillDialogsMirror, applyDialogsMirror } from '../../client/boot'

export function useAppBootstrap(): void {
  const managers = useManagers()
  useEffect(() => {
    let stopPresenceDegradation: (() => void) | undefined
    // Под passcode-локом (решён в boot.ts до рендера) НИЧЕГО не грузим и не
    // коннектим — вся первичная загрузка + realtime стартуют один раз после
    // разблокировки. Не под локом — сразу (runWhenUnlocked дергает fn синхронно).
    const run = () => {
      // Префетч (`me` из main.tsx) берём ТОЛЬКО через bootPrefetch(): он
      // одноразовый по смыслу (данные аккаунта, под которым страница
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
      // сам решает cache-first/сеть внутри refresh()→hydrate()). Пин (обе
      // ветки условия, мутацией) — useAppBootstrap.dialogsGate.test.tsx
      // (Fix, ревью Task 6, Important #2).
      //
      // Fix (финальное ревью, Important #3): на холодном старте берём ПРОМИС
      // догона, запущенного boot'ом (`bootData.dialogsReady`), а не
      // `Promise.resolve()`. `loadPresence` читает цели из зеркала, и на пустом
      // кэше (смена аккаунта, очищенное хранилище, вход в соседней вкладке) он
      // получал пустой список и молча выходил — весь сеанс без онлайн-точек и
      // «был(а) в сети». Массового сида презенса больше нигде нет (второй вызов
      // в useNavigationActions.ts — точечный, на одного пира).
      //
      // Fix (повторное ревью финальной волны, находка A): boot под passcode-
      // локом пропускает `fillMirror()` целиком (`client/boot.ts`, `locked`) —
      // зеркало ЭТОЙ вкладки ни разу не гидрировано владельцем. Обычный
      // `refresh()` тут не гарантия: он публикует операцию, только если сеть
      // разошлась с памятью владельца, а на аккаунте с нулём диалогов пустой
      // ответ сети совпадает с ещё не гидрированным пустым кэшем — операции
      // нет, `chatsStore.loaded` остаётся `false` навсегда (скелетон висит
      // вечно, см. `ChatList.tsx`). Досюда (`run()` уже прошёл `runWhenUnlocked`)
      // лок точно снят, поэтому явно закрываем пробел тем же приёмом, что
      // холодный старт: `fillDialogsMirror(managers, false)` — гарантированный
      // `reset` (см. докблок `dialogsManager.fillMirror` — announce
      // безусловный) — и `applyDialogsMirror` для применения и сетевого
      // догона поверх, БЕЗ повторного `refresh()` из ветки ниже.
      const dialogsReady = prefetch
        ? prefetch.dialogsReady
        : bootWasLocked()
          ? fillDialogsMirror(managers, false).then((op) => applyDialogsMirror(op, managers, false))
          : managers.dialogs.refresh()
      // `.catch` до loadPresence (Minor #3): refresh() пробрасывает HttpError, а
      // тут он идёт `void`-ом — 401/5xx не должны стать unhandled rejection и не
      // должны отменять сид презенса по тому, что уже есть в зеркале.
      void dialogsReady.catch(() => {}).then(() => loadPresence(managers)).catch(() => {})
      void loadStories(managers)
      void loadNotifySettings(managers)
      void loadFolders(managers)
      void loadPrivacy(managers)
      void loadStars(managers)
      void primeMediaToken() // cache the media token so media bubbles build URLs sync
      // SW чистит медиакэш по TTL/лимиту при получении настроек (tweb clearOldCache)
      const { cacheTTL, cacheSize } = useSettingsStore.getState()
      syncCacheSettingsToSW(cacheTTL, cacheSize)
      startRealtime()
      initAppBadge() // счётчик непрочитанных: title/favicon/PWA-бейдж
      // Деградация присутствия по `expires` — порт интервала оригинала
      // (`appUsersManager.ts:68`). Без него потерянный кадр «ушёл в оффлайн»
      // оставлял бы зелёную точку навсегда: срок годности приезжает с провода,
      // гасит его КЛИЕНТ.
      stopPresenceDegradation = startPresenceDegradation()
      // offline-уведомления (web push) подписываем только если не выключены в настройках
      if (useSettingsStore.getState().notifyPush) void setupPush()
    }
    const stopWhenUnlocked = runWhenUnlocked(run)
    return () => {
      stopWhenUnlocked()
      stopPresenceDegradation?.()
      stopPresenceDegradation = undefined
    }
  }, [managers])
}
