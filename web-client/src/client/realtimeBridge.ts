// src/client/realtimeBridge.ts
// Точка сборки realtime: поднимает «насос» smp → rootScope и регистрирует подписчиков
// шины. Сам мост больше не содержит обработчиков событий — они живут в модулях-
// подписчиках (storeProjection / soundSubscriber / notificationSubscriber).
import { startClient } from './bootstrap'
import { RT } from '../core/realtime/events'
import rootScope from '@lib/rootScope'
import { primeMediaToken } from '../core/mediaUrl'
import { registerStoreProjection } from './realtime/storeProjection'
import { registerSoundSubscriber } from './realtime/soundSubscriber'
import { registerNotificationSubscriber } from './realtime/notificationSubscriber'
import { registerCallSubscriber } from './realtime/callSubscriber'
import { registerRefetchSubscriber } from './realtime/refetchSubscriber'

let started = false

// Полный каталог событий, которые может прислать воркер. Насос перекачивает каждое
// в rootScope; новое событие достаточно добавить в RT — оно будет транслироваться.
//
// СПИСОК ЯВНЫЙ, И ЭТО ЛОВУШКА, на которую задача 9 уже наступила. Исходящий путь
// (`rootScope.dispatchEvent` → порт → воркер → соседние вкладки) работает для
// ЛЮБОГО имени события; входящий — только для перечисленных здесь. Событие, которое
// шлют, но не принимают, выглядит как работающее у отправителя и молчащее у всех
// остальных, и живая проверка нашла ровно это: `language_change` (смена языка в
// соседней вкладке) уходила в воркер, доезжала до соседей и там пропадала.
//
// `language_change` — не `RT.*`: его порождает не воркер, а ВКЛАДКА
// (`lib/langPack.ts::applyLangPack`, порт tweb :325), воркер только ретранслирует.
const WORKER_EVENTS: string[] = [...Object.values(RT), 'rt:resync', 'media:upload_progress', 'state:mirror', 'language_change']

// Subscribe to worker realtime events exactly once per page.
export function startRealtime(): void {
  if (started) return
  started = true
  const { smp, managers } = startClient()

  // Единственный потребитель smp: ре-эмитит события воркера в rootScope СТРОГО
  // локально (tweb apiManagerProxy.ts:347-352 — dispatchEventSingle), иначе
  // событие ушло бы обратно в воркер и закольцевалось.
  for (const ev of WORKER_EVENTS) {
    smp.on(ev, (p, m) => {
      (rootScope.dispatchEventSingle as any)(ev, p, m)
    })
  }
  // Порт для событий, порождённых этой вкладкой (rootScope.dispatchEvent).
  rootScope.setPort(smp)

  // Всё, что воркер публиковал ДО этой строки, мимо вкладки: SuperMessagePort
  // кадры не буферизует, а насос выше только что поднялся. Для медиа-токена это
  // дыра с зубами: под passcode-локом startRealtime() отложен runWhenUnlocked,
  // при этом Shell под экраном блокировки отрисован и медиа-баблы токен уже
  // спраймили (useMediaTokenVersion) — сменись за это время активная сессия,
  // сбрасывающий кадр rt:logging_out до зеркала не долетит, и оно останется с
  // ключом прошлого пользователя до самого истечения. Поэтому накопленный до
  // подъёма насоса снимок перепроверяем у владельца принудительно: он
  // единственный знает текущую сессию. Отзывчивость не страдает — зеркало
  // продолжает отдавать удержанный снимок синхронно, а на обычном старте этот
  // вызов склеивается с primeMediaToken() из useAppBootstrap (тот же priming,
  // тот же единственный RPC).
  void primeMediaToken(true)

  // Подписчики шины (порядок не важен — события независимы).
  registerStoreProjection(managers)
  registerSoundSubscriber()
  registerNotificationSubscriber()
  registerCallSubscriber()
  registerRefetchSubscriber(managers)

  void managers.realtime.start()
}
