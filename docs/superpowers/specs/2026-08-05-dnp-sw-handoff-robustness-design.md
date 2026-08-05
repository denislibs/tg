# DNP SW-мост: робастность handoff'а — дизайн

**Дата:** 2026-08-05
**Статус:** дизайн на ревью
**Контекст:** [[dnp-noise-transport]]; вскрыто первым браузерным stand-e2e (см. память
`dnp-noise-transport`, раздел «STAND-E2E L5 в браузере»). Подпроект L5, follow-up к PR-2a/2c.

## Проблема

Мост SW↔SharedWorker (для `/dnp-stream/` 206) устанавливается **одноразовым push из
окна** (`installBridgeHandoff` на `serviceWorker.ready` + `controllerchange`). Service
Worker **эфемерный** — браузер завершает его при простое/нагрузке и перезапускает по
событию. При рестарте:

- in-memory `dnpBridge.port` (и `dnpStreamHandler`) в SW **теряются**;
- регистрация остаётся `active` → `controllerchange` **не фаерит**;
- окно **не переотдаёт** порт → все `/dnp-stream/` падают `bridge: no port` **до reload**.

Стриминг **само-дестабилизируется**: большая нагрузка сама провоцирует рестарт SW.
Воспроизведено на стенде: одиночный range даёт 206; после ~14 конкурентных стримов SW
рестартует, порт теряется, восстановление — только reload.

Плюс мелочь **first-load timing**: сразу после установки SW `controller`=null когда
`trySend` фаерит → handoff не завершается до лишнего reload.

## Эталон tweb (сверено 1:1)

`src/lib/serviceWorker/index.service.ts`:
- `onWindowConnected(source)` → `sendMessagePortIfNeeded(source)`: **если порта ещё нет**,
  SW минтит `MessageChannel`, attaches port1, шлёт port2 клиенту-источнику
  (`invokeVoid('port', …, source, [port2])`).
- **Восстановление рестарта — SW-инициатива на старте** (стр. ~195-215, `'startup check'`):
  SW на старте делает `clients.matchAll()`, шлёт каждому окну `hello`, и по ответу —
  `onWindowConnected` → переустанавливает порт. Т.е. SW **сам** дотягивается до
  существующих окон при каждом своём запуске.
- Клиент тоже шлёт `hello` SW на boot (стр. 135) → тот же путь.

Вывод: связь **connect-based**, но ключ робастности — **SW на своём старте контактирует
окна**. Это покрывает рестарт посреди сессии (пока есть хоть одно окно), без lazy-логики
в fetch-обработчике.

## Решение

Переустановка порта по триггерам, переиспользуя протестированный `handoffBridgePort`
(окно-mints; направление порта не меняем — минимум изменений к смёрженному коду).

### Поток

1. **SW при старте** (top-level `sw.js`, исполняется при КАЖДОМ запуске, включая рестарт):
   `clients.matchAll({type:'window', includeUncontrolled:true})` → если у моста **нет
   порта**, шлёт активным окнам `{type:'dnp-request-port'}`.
2. **Окно** (слушатель `message` от SW): на `{type:'dnp-request-port'}` → выполняет
   `handoffBridgePort(controller, ep)` (минтит `MessageChannel`, `{type:'dnp-bridge-port'}`
   +port1→SW, `{t:'dnp-bridge-port'}`+port2→SharedWorker) — как сейчас.
3. **Окно** также инициативно пингует SW `{type:'dnp-hello'}` на: boot (после
   `serviceWorker.ready`), `controllerchange`, `visibilitychange→visible`. SW на `dnp-hello`
   отвечает так же, как на старте (`request-port` если порта нет). Это чинит first-load
   (окно догоняет свежеустановленный SW) и покрывает возврат на вкладку после реклейма SW.
4. **SharedWorker** (`worker.ts`) — без изменений: принимает `{t:'dnp-bridge-port'}`+порт →
   `attachStreamBridge`.

`dnpBridge` (в `sw-bridge.js`) получает предикат `hasPort()` — SW спрашивает порт только
когда его нет (tweb `sendMessagePortIfNeeded`). Идемпотентно: лишние `dnp-hello`/повторные
старты не плодят каналы, если порт уже есть.

### Свёрнутые follow-ups (#3)

- **3a — close() вытесняемого порта.** Если `setPort` вызван при уже существующем порте
  (форс-реотдача), старый `MessagePort` закрывается (`port.close()`) до замены — иначе
  медленная утечка в SW и в SharedWorker (осиротевший конец). Контракт PR-2a.
- **3b — отмена in-flight по таймауту.** `requestPart` при таймауте (45с) сейчас только
  реджектит и чистит `pending` в SW, но SharedWorker продолжает ждать `file_req` в канале.
  Добавляем отмену **по мосту** (intra-bridge control-сообщение, НЕ backend-кадр):
  1. `sw-bridge.js`: таймаут → помимо reject, шлёт по порту `{t:'file_part_cancel', reqId}`.
  2. `streamBridge.ts` (`attachStreamBridge`): на `file_part_cancel` — abort'ит in-flight
     `fetchFilePartWithTotal` через `AbortController`.
  3. `fileDownload.ts`: `fetchFilePartWithTotal`/`fetchFilePart` принимают `AbortSignal` —
     по abort снимают корреляцию `req_id` и реджектят ожидание.
  **DNP-wire (backend) НЕ меняем** — `file_cancel`-кадра к серверу нет; поздний
  `file_chunk`, если придёт, просто игнорируется (корреляция уже снята; ограниченная
  разовая трата трафика, без протокольных правок и правок бэкенда).

## Что НЕ делаем (YAGNI / вне scope)

- **Lazy-порт в fetch-обработчике** (SW ждёт порт внутри `respondWith`) — не нужен:
  SW-startup-matchAll покрывает рестарт. Residual-зазор (SW рестартует, вкладка на
  переднем плане, до следующего `dnp-hello`) — крайне редок; при нём один stream-fetch
  может отдать ошибку до восстановления. Осознанный трейд-офф connect-based (выбор
  подтверждён).
- **Backend `file_cancel`-кадр** — вне scope (3b решается клиентски).
- **Смена направления mint (SW-mints вместо window-mints)** — не требуется; сохраняем
  текущее направление ради минимума изменений.
- **L2-мультиплексор / HoL** — отдельный подпроект (localhost замер невозможен; не блокер).

## Затрагиваемые файлы

- `web-client/public/sw-bridge.js` — `hasPort()`; `setPort` закрывает старый порт (3a).
- `web-client/public/sw.js` — top-level `clients.matchAll` → `request-port` если нет порта;
  обработчик `dnp-hello` → то же; существующий приём `dnp-bridge-port` без изменений.
- `web-client/src/client/dnpBridgeHandoff.ts` — слушатель `dnp-request-port` от SW →
  `handoffBridgePort`; инициативные `dnp-hello` на boot/controllerchange/visibilitychange.
- `web-client/src/core/net/dnp/fileDownload.ts` — отмена ожидания `file_req` по сигналу (3b).
- `web-client/src/core/net/dnp/streamBridge.ts` — проброс отмены в `fetchFilePartWithTotal`
  (если требуется сигнатурой); либо таймаут-cancel инкапсулирован в мосте.

## Тестирование

- **Юнит (sw-bridge.js через Function-лоадер):** `hasPort()` false→true после `setPort`;
  повторный `setPort` закрывает старый порт (мок `close`); таймаут `requestPart` чистит
  `pending` и шлёт отмену.
- **Юнит (dnpBridgeHandoff):** `dnp-request-port` от SW → вызывает `handoffBridgePort`;
  `dnp-hello` шлётся на смоделированных boot/controllerchange/visibility.
- **Юнит (fileDownload 3b):** отмена снимает корреляцию `req_id`, поздний `file_chunk`
  игнорируется без ошибки.
- **Стенд-e2e (ручной, msgrverify DNP-ON):** (1) видео стримится (206); (2) **форс-рестарт
  SW** (DevTools → Service Workers → Stop, либо нагрузка) → повтор стрима **без reload** даёт
  206 (порт переустановлен); (3) first-load: свежая установка SW → стрим работает без
  лишнего reload.

## Открытые вопросы

Нет — развилки (подход connect-based, свёртка #3) подтверждены.
