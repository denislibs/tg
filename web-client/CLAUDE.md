# CLAUDE.md — frontend

React/TS-клиент (Telegram Web K remake). Общие мандаты — в корневом [`../CLAUDE.md`](../CLAUDE.md).
Структура и связь с бэком — в [`README.md`](README.md).

## Команды

```bash
npm run dev        # watch-сборка в ../client-build (dev-сервера нет; раздаёт nginx :38080)
npm test           # vitest
npm run typecheck  # tsc --noEmit на TS7 native (@typescript/native)
npm run lint       # oxlint (typeAware); lint:fix — с автофиксом
npm run build      # tsc --noEmit + vite build (типы должны проходить)
# разовая прод-сборка для nginx (из этой папки):
npx vite build --outDir ../client-build
```

## Главное правило: 1:1 с tweb

Вёрстку, размеры, отступы, переменные css анимации поведение брать **из исходников tweb**, не выдумывать. 
Перед «в Telegram так» — открыть tweb и проверить. Не уверен в оригинале — сначала изучи tweb, потом пиши. 
Без отсебятины. Не выдумывай 

## Стек и стиль

- **React 19 + Vite 8 (Rolldown) + TS strict.** Тайпчек — **TS7 native** (`@typescript/native`,
  нативный `tsc`); линт — **Oxlint** (typeAware, `.oxlintrc.json`). Воркеры собираются как отдельные
  ESM-чанки (`worker.format: 'es'` в `vite.config.ts` + `new Worker(new URL(..., import.meta.url), {type:'module'})`).
  Стилизация — **SCSS-модули** (`*.module.scss` + `sass`); глобальные дизайн-токены (CSS custom properties)
  в `src/styles/_tokens.scss`, тема через атрибут `data-theme` на `<html>`. **MUI убран** — не добавлять
  `@mui`/`sx`/emotion, только SCSS-модули.
- **Zustand** — глобальное состояние. Отдельно стоящие сущностные сторы — в `src/stores/*`;
  маленький стор, колокейтед со своей фичей (`settings`, `i18n`, `pip`, `pwa`, `webapp`), живёт
  рядом с ней — это норма (не растаскивать по `stores/` в ущерб когезии). Не плодить
  React-контексты под то, что уже в сторах.
- **Анимации — только CSS-классами tweb**; JS их лишь переключает. **framer-motion убран** — не возвращать
  (как и MUI). Механика: `core/hooks/useSetTransition` (порт `singleTransition.ts` — классы
  `forwards`/`backwards`/`animating`) и `core/hooks/useMountTransition` (роль `AnimatePresence`: узел живёт
  в DOM, пока играет exit). Гейт — `body.animation-level-0/2`, ставит `App.tsx` по настройке «Без анимаций».
  Тяжёлые переходы объявлять через `core/dom/heavyAnimation` — на их время `animationIntersector` глушит
  стикеры/видео. **TS strict** — без `any`, неиспользуемые переменные не пройдут сборку.
- **Ловушка CSS-модулей:** Vite хеширует любое имя в `animation`, включая ссылку на глобальный кейфрейм
  партиала — `animation: fade-in-opacity` внутри `*.module.scss` станет `_fade-in-opacity_xxx` и молча
  ничего не сыграет (ни сборка, ни тайпчек не поймают). Нужен локальный `@keyframes`-дубль;
  `animation: :global(name)` не компилируется.
- Тяжёлые списки: `MessageRow`/`ChatFeed` мемоизированы — не ломай стабильность пропсов/рефов.
- **Импорт-алиасы** (tsconfig + vite + vitest, держать синхронно): `@core @stores @shared @rpc
  @lib @helpers @components @config @environment @vendor @customEmoji @types @/*`. Раскладка кросс-каттинга:
  `shared/lib` — чистые переиспользуемые утилиты; `lib` — толстые вендор-подсистемы (lottie,
  customEmoji, `twebMessagePort`); `helpers` — легаси-корзина, новое туда не класть.

## Архитектура клиента (инварианты — НЕ нарушать)

Однонаправленный поток. Подробности и обоснование — в
[`../docs/research/2026-06-29-frontend-refactor-plan.md`](../docs/research/2026-06-29-frontend-refactor-plan.md).

```
вверх (данные):  сервер → smp → rootScope → {Store-проектор, Sound, Notifications, Call, Refetch, …} → селектор → View
вниз (команды):  View → хук (use*) → managers → сервер
```

Воркерная сторона (`сервер →`) собрана в `core/workerCore.ts` (фабрика `createWorkerCore()`:
менеджеры, funnel, реестр RPC, `bind()`) — `core/worker.ts` лишь вызывает её и `.start()`,
это не место для логики.

Порты закрытых вкладок снимаются не по событию `close`, а Web Locks-механикой (порт tweb):
вкладка держит лок (`attachLock` в `client/bootstrap.ts`), воркер запрашивает тот же лок и
получает его только когда вкладка реально умерла (включая крэш/kill, не только штатный
`beforeunload`). Аварийный рубильник — константа `USE_LOCKS` в `rpc/superMessagePort.ts`.

**Слои и кто за что:**
- **View** (`components/*`) — только рендер + колбэки. Не фетчит, не слушает сокет, не держит данные.
- **ViewModel-хуки** (`core/hooks/use*`) — presentation logic: читают стор селектором, отдают данные + действия.
- **Store** (`stores/*`) — нормализованное хранилище сущностей по id, единственный источник истины.
- **rootScope** (`src/lib/rootScope.ts`) — вендорный (порт tweb) каталог realtime-событий
  (`BroadcastEvents`/`BroadcastEventsListeners`) + шина поверх `EventListenerBase`
  (`src/helpers/eventListenerBase.ts`, вендор 1:1). Насос в `realtimeBridge` (единственный
  потребитель `smp`) ре-эмитит принятое от воркера через `dispatchEventSingle`; кросс-каттинг-
  подписчики (`client/realtime/storeProjection`, `soundSubscriber`, `notificationSubscriber`,
  `callSubscriber`, `refetchSubscriber`) подписываются на неё через `rootScope.addEventListener`
  (пачкой — `addMultipleEventsListeners`). Порождённое вкладкой событие (`dispatchEvent`) уходит
  и локальным подписчикам, и в воркер — тот ретранслирует его остальным вкладкам.
- **realtimeBridge** (`client/realtimeBridge.ts`) — только насос `smp → rootScope` +
  регистрация подписчиков (`registerStoreProjection`/`registerSoundSubscriber`/
  `registerNotificationSubscriber`/`registerCallSubscriber`/`registerRefetchSubscriber`);
  сам обработчиков не содержит.
- **managers** (`core/managers/*`) — команды/запросы к бэку; не знают про React/DOM.

**НЕЛЬЗЯ:**
- Разбирать кадр `new_message` на главном потоке, чтобы применить его к окну.
  Входящее сообщение применяется к окну ОДИН раз: воркер порождает операцию
  (`core/realtime/messageOps`, событие `rt:message_op`), проектор её переигрывает
  через `applyOps`. Кадр `rt:new_message` по-прежнему рассылается, но только для
  того, что операциями не покрывается (превью в списке чатов, звук, нотификации,
  read-marker) — не для записи в окно сообщений. **Исключений больше нет.**
  Раньше здесь стояло одно: обработчик `RT.newMessage` мог порождать точечный
  `replace` ради резолва превью ответа (`replyTo`) из уже загруженного окна —
  снимок оригинала ехал плоскими полями, и собрать его мог только тот, у кого
  есть окно. Предмет исчез вместе с портом сообщения на TL: `reply_to` стало
  ССЫЛКОЙ (`messageReplyHeader`), превью строит РЕНДЕРЕР, разрешая номер в своём
  окне, и переписывать ради этого сообщение в сторе больше незачем.

  Stage 1B.3 перевела на операции ещё восемь типов кадров: `media_read`,
  `web_page_update`, `factcheck_update`, `paid_media_unlock` → `patch`;
  `delete_message` → `remove`; `poll_update`, `checklist_update`,
  `giveaway_update` → `patch` (для poll/giveaway — с исключением в `patch()`
  из `core/realtime/messageOps.ts`, которое безусловно подставляет вложенный
  локальный выбор ОКНА — `poll.myVotes`, `giveaway.participating`/`iWon` —
  поверх значения из операции, а не наоборот).

  **Этап «один писатель окна» закрыл остаток: применений мимо операций больше
  НЕТ ВОВСЕ, и таблицы исключений тоже нет.** Переведено:

  | Факт | Кто объявляет операцию | Что правило окно раньше |
  |---|---|---|
  | `edit_message` | `messages.cacheEdit` → `patch` всеми параметрами сообщения (`patch`, а не `replace`: у окна поверх правки живёт `localUrl`/`random_id`/`failed`, которых у SSOT воркера нет) | `APPLY[RT.editMessage]` → `applyEdit` на витрине |
  | `geo_live_update` | `messages.cacheGeoLive` → `patch {media, edit_date}`; кадр эфемерный (без `pts`, `core/realtime/transportFrames.ts:35`), поэтому владелец перехватывает его в `workerCore.ts::onFrame` рядом с `message_ack` | `APPLY[RT.geoLiveUpdate]` → `applyGeoLive`; сам `cacheGeoLive` не звался НИОТКУДА |
  | `reaction` (вместе с платным чипом `reactionPaid` — своего кадра у него нет) | `messages.cacheReaction` → `patch {reactions}` | отдельный `addEventListener(RT.reaction)` → `applyReaction` |
  | свой клик по реакции | `messages.react`/`unreact` → `patch {reactions}`, включая откат на ошибке сети | НИЧЕГО не объявляли вовсе — двигали только SSOT воркера |
  | ⭐-реакция | `messages.sendStarReaction` → `patch {reactions}` | `components/stars/StarReactionPopup.tsx` → `applyStarReaction` (события `RT.starReaction` не существует — прежняя строка таблицы описывала несуществующую подписку) |
  | свой голос в опросе | `messages.votePoll` → `patch {media}` | вызыватель → `setPollMedia` |
  | своя отметка в чек-листе | `messages.toggleChecklistItem`/`addChecklistItems` → `patch {media}` | вызыватель → `setChecklistMedia` |
  | «проверка фактов» своим действием | `messages.setFactCheck`/`removeFactCheck` → `patch {factcheck}` | вызыватель → `applyFactCheck` |
  | просмотры поста канала | `messages.cacheViews`, которую зовёт `channels.viewCounts` в воркере → `patch {views}` | `core/hooks/useChannelExtras.ts` → `patchViews` |
  | расшифровка голосового/кружка | `messages.transcribe` → `patch {transcription}` | НИЧЕГО не объявляли: параметр ложился только в SSOT воркера и доезжал до окна лишь перезагрузкой чата, хотя бабл рисует именно его (`components/messages/Transcription.tsx:20-21`) |

  Удаление своего сообщения в эту таблицу не попало: `messages.deleteMessage`
  объявлял `remove` и раньше, и веер владельца (`core/realtime/workerScope.ts`
  → `RootScope.dispatchEvent` → `port.emit` по ВСЕМ портам) источник не
  исключает — исключает только `receiveFrom`, а это другой путь. Комментарий у
  метода утверждал обратное («вкладка-инициатор чинит своё окно сама, поэтому
  себе не шлём») и был неверен; он исправлен, а поведение закреплено тестом.

  Про реакции отдельно, потому что прежняя причина «не операцией» звучала
  структурно и оказалась неверной. Она говорила: деривация `mine` — это
  поэлементное слияние массива двумя сигналами ВНЕ агрегата, значением поля не
  выражается. Верно это было ровно пока слияние делала ВИТРИНА. В оригинале его
  делает ВЛАДЕЛЕЦ: `appReactionsManager.sendReaction` считает весь агрегат у
  себя и объявляет его абсолютным `updateMessageReactions`
  (tweb `src/lib/appManagers/appReactionsManager.ts:895-901`), а применяющий
  делает голое присваивание `message.reactions = reactions`
  (tweb `src/lib/appManagers/appMessagesManager.ts:7807-7810`) — ни слияния на
  стороне потребителя, ни дельты на проводе. У нас теперь так же:
  `mergeReactions` (`core/reactions/messageReactions.ts`) вызывается в воркере, и
  в операцию уезжает ГОТОВОЕ значение поля вместе с `chosen_order`. Второй довод
  («операция навяжет вкладке чужую версию поверх её оптимистики») отпал по
  факту: клик ЛЮБОЙ вкладки идёт ЧЕРЕЗ воркер (`managers.messages.react`),
  поэтому его SSOT и есть та копия, где сведены клики всех вкладок. Заводить
  свой тип операции с семантикой дельты было бы отступлением от оригинала, а не
  портом.

  Пин на всё перечисленное — `client/realtime/storeProjection.windowWriters.test.ts`:
  настоящий менеджер воркера, настоящий проектор, проверяется ЗЕРКАЛО
  (`core/history/messagesMirror.ts`), потому что именно из него рисует
  императивная лента — факт, доехавший до zustand-копии, но не до зеркала, для
  неё не существует. Проводка эфемерного гео-кадра —
  `core/workerCore.geoLiveFrame.test.ts`, проводка просмотров —
  `core/managers/channelsManager.test.ts`.

  **Долг, а не исключение:** в React-ленте остались ПОВТОРНЫЕ применения тех же
  уже объявленных фактов — `core/hooks/useMessageActions.tsx`
  (`applyReactionOptimistic`/`applyDelete`/`applyFactCheck`/`setPollMedia`),
  `components/messages/PollBubble.tsx`, `components/messages/ChecklistBubble.tsx`,
  `components/stars/StarReactionPopup.tsx`, `core/hooks/useChatPopups.tsx` и
  `core/hooks/useScheduledMessages.ts` (`applyIncoming` поверх приходящего
  WS-эха `new_message` — бэкенд фанит его и автору,
  `backend/internal/usecase/chat/fanout.go:163`). С владельцем они не
  расходятся (значение абсолютное и то же самое), но это лишние писатели
  zustand-копии, и уходят они вместе с React-лентой (этап 7). В ЗЕРКАЛО не
  пишет никто, кроме проектора и `putMirrorPage`.

  **Исключения для оптимистичной отправки больше нет.** Жизненный цикл
  неотправленного («отправляется…») сообщения живёт в менеджере воркера —
  `core/managers/messages/pending.ts` (порт формы tweb `appMessagesManager`:
  `beforeMessageSending`/`finalizePendingMessage`/`checkPendingMessage`/
  `cancelPendingMessage`), временный бабл лежит в ТОМ ЖЕ SSOT и в том же срезе
  окна, что и настоящие сообщения. Наружу он объявляется теми же `MessageOp`:
  появление бабла — `insert`, ack — `insert` финального (слияние по `clientId`
  живёт в `messageOps.insert`), ошибка отправки — `patch {failed}`, отмена —
  `remove`. Пяти кадров `rt:pending_*` и сторных мутаторов
  (`appendOptimistic`/`reconcileAck*`/`failOptimistic*`/`removeOptimistic*`) больше
  нет. **Отправка тоже там** — `messages.sendText` / `messages.sendFile` (порт
  tweb `sendText`/`sendFile`): `beforeMessageSending` заканчивается вызовом
  транспорта, как `message.send()` в оригинале. Транспорт (`conn.sendMessage`),
  аплоад (`media.upload`), отмена аплоада, typing-пинг и канал прогресса
  приходят в менеджер **инъекцией при сборке** (`workerCore.ts`) — так же, как
  tweb раздаёт зависимости через реестр `AppManagers`; именно это, а не вынос
  отправки наружу, снимает кольцо импортов. `sendFile` владеет аплоадом целиком
  (бабл → байты → `attachPendingMedia` → **один** кадр с `media_id`), поэтому
  двухфазной отправки (`awaitMedia`) больше нет, а `localUrl` — обычное поле
  SSOT: blob-URL минтит воркер (воркерный blob виден всем вкладкам, ровно как у
  `downloadMediaURL`), вкладочных обогащений над операциями не осталось.
  Второй вход владельца — `workerCore.ts::onFrame`, который перехватывает
  `message_ack`/`message_error` (эфемерные, без `pts`) и применяет их один раз —
  сырой кадр при этом летит дальше, у него остались потребители (звук отправки,
  тост `paid_required`). Пути, идущие мимо WS-отправки, зовут владельца сами
  через `beforeSending` (`workerCore.ts`): пост канала (`channelsManager.post`,
  REST) и секретный чат (`secretManager.sendText/sendMedia`, по проводу
  шифртекст; шифрование и локальное превью — тоже в воркере, ключи живут там).
  На вкладке осталась только мета файла (`scaleImageForSend`,
  `probeMediaDuration`) — ей нужен DOM, и tweb считает её там же
  (`width`/`height`/`duration` в `SendFileArgs`).
- Подписываться на сокет (`smp.on`) где-либо, кроме насоса в `realtimeBridge`. Нужны realtime-события
  в новом модуле — подписывайся на `rootScope.addEventListener`, а не на `smp`. Компоненты/хуки
  **читают из стора**.
- Ре-эмитить принятое из воркера событие через `dispatchEvent` — только
  `dispatchEventSingle` (иначе событие уйдёт обратно в воркер и закольцуется;
  инвариант tweb: `apiManagerProxy` ре-эмитит принятое строго локально).
- Сочинять `meta` события вне funnel'а воркера. Происхождение кадра
  (`pts`, `catchUp`) знает только он; подписчику, которому важно отличать живой
  кадр от catch-up (звук, нотификации), читать `meta.catchUp`, а не полагаться
  на побочный эффект дедупа по pts.
- Читать персист (`core/store/persist`) из `stores/`, `components/`, `core/hooks/`. Модель tweb: одно
  батч-чтение `State` до первого рендера (`client/boot.ts` → `loadStateOnce`), дальше только
  синхронные чтения из `stores/appState` и write-through записи через `setAppState`. Асинхронное
  чтение после первого кадра = рваная гидрация: список уже есть, папки приезжают позже, вёрстка
  прыгает. Держит `core/state/noAdHocReads.test.ts`. Менеджеры воркера (`core/managers/*`) —
  исключение: там чтение кэша это офлайн-фолбэк внутри RPC, который UI и так ждёт.
- Класть в `AppState` сущности (диалоги, сообщения, юзеров, `me`). `setAppState` пишет значение
  ключа целиком, поэтому там только конфиг — как и в tweb, где сущности лежат в отдельных
  сторах IndexedDB.
- Задавать порядок списка позицией в массиве или ручным `splice`. Порядок диалогов — производная
  от данных (`core/dialogs/dialogIndex.ts`, порт tweb `generateDialogIndex`), считается в
  единственном месте — `applyDialogs`. Два правила сортировки = список перетасовывается между
  кэшем и ответом сети. Держит `stores/noManualOrder.test.ts`.
- Применять ответ сети полной подменой коллекции. Сводить через `core/store/reconcile`:
  неизменившиеся записи сохраняют ссылки, а совпавший с памятью ответ не даёт ни перерисовки,
  ни записи в IDB (порт tweb `saveDialogFilter`).
- Опрашивать сеть на каждом старте за тем, что уже есть в памяти. Cache-first: сеть только при
  пустой памяти или по апдейту сервера (порт tweb `getDialogFilters`). Если событие несёт
  абсолютный снимок — применять его, а не ходить за списком (`folder_update`, `chat_update`).
- Дублировать realtime-данные: одна сущность живёт в сторе один раз (нормализовано по id).
  `connectionManager.outbox` (worker) — **только** транспортный буфер resend, не источник для UI.
- Держать в `useState` копию того, что уже в сторе. Производные значения — мемо-селектором, не дублем поля.
- Складывать бизнес-логику в `useEffect` ради синхронизации состояния (эффект — для честных side-effect'ов:
  DOM-listener, императивный скролл).

**МОЖНО:**
- Фетчить через `managers` (REST) из хука — это read/command-путь, не подписка на сокет.
- `store.getState()/.setState()` из не-React кода (worker/`realtimeBridge`).
- Вынести кластер логики в свой `core/hooks/useChat*.ts` (как `useChatSelection`/`useChatInfoCard`/`usePinnedBar`).
- **Грузить медиа-bytes НЕ-картинок прямым `fetch` к аутентифицированному media-эндпоинту**
  (токен-URL строит `core/mediaUrl`: `mediaContentUrl`/`primeMediaToken`), НЕ через `managers`.
  Бинарь идёт на main-thread, а не сериализуется через worker-RPC (SuperMessagePort) — как в tweb
  (`wrapSticker`, загрузка файлов). Так делают `StickerMedia.loadStickerContent` (инспекция
  Content-Type → lottie/video/image + кэш), `messages/RealMediaBubble` (стрим файла-документа с
  прогрессом/отменой через `ReadableStream`), `core/audio/waveform` и `core/secret/mediaCache`
  (шифртекст E2E). Это про **bytes**; КАРТИНКИ (фото/превью/аватарки) с медиа-суперпорта токен-URL
  больше не ходят — их владелец воркерный конвейер `downloadMediaURL` (см. «Медиа» ниже), витрина
  берёт готовый objectURL из зеркала (`core/hooks/useMediaUrl`/`useMediaThumb`); хука
  `useMediaContentUrl` больше нет.

**Асинхронщина и актуальность (middleware):**
- Любой асинхронный результат (RPC `.then`, `img.onload`, таймер), который пишет в
  `useState`/стор, обязан проверяться на актуальность через `@helpers/middleware`
  (вендор tweb 1:1) — React-адаптер `core/hooks/useMiddlewareHelper`. Паттерны:
  несколько независимых эффектов — дочерний scope `helper.get().create()` на прогон
  с `scope.destroy()` в cleanup; весь компонент — одна зона актуальности —
  `helper.get()` + `helper.clean()` в cleanup. Для await-цепочек —
  `@helpers/middlewarePromise` (бросает `{type:'MIDDLEWARE'}` после протухшего await).
- `.get()` берётся **в момент запуска** асинхронной операции — внутри эффекта или
  обработчика, а не в теле компонента и не в замыкании прошлого рендера. React
  рендерит с новыми пропсами ДО cleanup предыдущего эффекта, поэтому токен, взятый
  на рендере, принадлежит уже гасимому поколению: собственные запросы нового ключа
  молча перестают писать. Если поздний вызов нужно отбросить по смене сущности —
  сверяй её явно (`forChat !== chatIdRef.current` в `TopicsPanel`), а не полагайся
  на токен.
- Ручные `alive`-флаги в новом коде не заводить; существующие мигрируют при
  ближайшем касании файла.
- Примитивы (`helpers/middleware.ts`, `helpers/middlewarePromise.ts`) — дословный
  tweb, не форкать; расширения — только тонкими адаптерами поверх.

**Известное исключение (не копировать):** `useChatScroll` слушает `RT.newMessage` ради UI read-marker —
markRead живого сообщения, когда вьюпорт прижат к низу и вкладка в фокусе (это решение зависит от
scroll/focus, которых нет в сторе). Счётчик unread-below при этом **производный из стора**
(`newestSeq − lastReadSeq`), а не накапливается из потока событий. Осознанный трейд-офф — новый код так не делает.

## Владение фактами (воркер публикует, витрина зеркалит)

Один факт — один владелец, и это воркер. Он вычисляет значение и **объявляет** его событием;
витрина применяет объявленное и своего вывода того же факта не держит. Каталог событий —
`core/realtime/events.ts` (`RT`), типы payload — `src/lib/rootScope.ts`, веер по вкладкам —
`core/realtime/workerScope.ts`, единственная точка применения — `client/realtime/storeProjection.ts`.

| Факт | Владелец | Что объявляет | Зеркало | Пин |
|---|---|---|---|---|
| `me`/`meId` | `core/workerCore.ts::setMe` (кэш + веер); меняют `core/managers/authManager.ts`, `profileManager.ts`, `premiumManager.ts` | `rt:me` — **значение** (полный `User`, `null` = разлогинен); `rt:logging_out {migrateTo}` и `rt:logged_in {userId}` — **намерение** перехода сессии (порт tweb `logging_out`/`account_logged_in`) | значение — `stores/chatsStore.ts::setMe` из проектора; намерение исполняет `core/hooks/useAuthGate.ts` | `stores/noDuplicateMe.test.ts` |
| карточки пиров | `core/managers/peersManager.ts` | `rt:peer_op` — **операцию** (`upsert`/`patch`), не снимок кэша | `core/peerCache.ts` — обычный модуль, а НЕ zustand: карточку читает синхронно и императивная лента (`components/chat/peerTitle.ts`, порт tweb `PeerTitle`), которой стор запрещён, а второе зеркало того же факта — дубль. Единственный писатель — проектор; React берёт зеркало через `core/hooks/usePeers.ts` (`useSyncExternalStore`), пробел объявляют оба читателя (`peers.fillMirror`) | `core/noDuplicatePeers.test.ts`, `client/realtime/storeProjection.peers.test.ts` |
| медиа-токен (только стрим DNP-OFF и байтовые пути — см. «Медиа») | `core/managers/mediaManager.ts` — получение и **единственное** расписание обновления (`TOKEN_MARGIN`) | `rt:media_token` (`MediaTokenInfo`) | `core/mediaUrl.ts::applyMediaToken`; своего таймера нет, `URL_SAFETY_MARGIN` — окно на полёт запроса, не расписание | `core/noDuplicateMediaToken.test.ts`, `core/mediaUrl.test.ts` |
| URL медиа (objectURL картинок/превью) | `core/managers/mediaManager.ts::downloadMediaURL` — байты → CacheStorage `cachedFiles` → `blob:`-URL минтится в воркере | `rt:media_url` (`MediaUrlEvt`) — **значение**; пробел объявляет витрина RPC-вызовом `downloadMediaURL` (поздняя вкладка стартовый бродкаст пропустила) | `core/mediaCache.ts` (потребление — `core/hooks/useMediaUrl`/`useMediaThumb`); пишут проектор и RPC-ответ владельца | `core/noDuplicateMediaUrl.test.ts` |

**НЕЛЬЗЯ:**
- **Выводить намерение из значения.** Снимок факта отвечает «что сейчас», а не «что происходит»:
  `me === null` одинаков у логаута, у «данных ещё нет» и у офлайн-старта, а не-null id — у чужого
  переезда и у собственного boot-подтверждения. Любая эвристика поверх этого («первое событие не
  считаем», «сравним с прошлым id») промахивается — это стоило трёх заходов и воспроизведённого
  дефекта. Владелец обязан объявить намерение ОТДЕЛЬНЫМ каналом (`rt:logging_out`/`rt:logged_in`),
  вкладка — исполнить объявленное (`useAuthGate.ts`), а не гадать по `rt:me`. Новый факт с
  переходами состояния заводится так же: канал значения + канал намерения.
- **Писать в зеркало мимо проектора.** Прямая запись — второй независимый вывод факта. Для `me`
  есть allow-list (гидрация с диска, запрос на холодном старте, три места мгновенного отклика на
  своё же действие) — он в `stores/noDuplicateMe.test.ts`, и каждое исключение обязано нести
  обоснование комментарием ПРЯМО У ВЫЗОВА. У пиров и токена исключений нет.
- **Проверять владение пином, который читает только витрину.** Такой тест смотрит на обе стороны
  одним глазом: зеркало сходится само с собой и при разъехавшемся владельце. Сравнивать надо
  **ответ владельца с состоянием зеркала напрямую** — образец в
  `client/realtime/storeProjection.peers.test.ts` (упавший до-фетч аватара:
  `mgr.getUsers([2])` против `usePeersStore.getState().byId[2]`). Именно этот дефект — у воркера
  карточки нет, у витрины старый `avatarUrl`, и навсегда — пин «через витрину» пропускал.
- **Считать «уже публиковали» доставкой.** Доставка — свойство вкладки, а не история владельца:
  `SuperMessagePort` события не буферизует, веер читает `ports` в момент отправки
  (`core/realtime/workerScope.ts`), и вкладка, открытая позже (или с ещё не поднятым насосом —
  под passcode-локом), задним числом не получает ничего. Поэтому пробел объявляет тот, кто его
  переживает: зеркало (`usePeers` → `peers.fillMirror`), а владелец отвечает на объявленный пробел
  ВСЕГДА, включая попадание в свой кэш. «Публиковать только изменения» без этого канала = карточка
  не доезжает никогда.

## Безопасность (критично)

- **НИКОГДА не рендерить пользовательский контент как сырую HTML-строку** (ни raw-HTML React-пропами,
  ни присваиванием разметки в DOM). Сущности и код — только React-нодами (`RichText.tsx`, `CodeBlock.tsx`);
  DOM строить через `createElement`/`createTextNode`.
- Ссылки — только по allow-list схем (`http/https/mailto/tel/tg`); остальное отбрасывать.
- Лимит длины кода в prism (ReDoS), лимит числа entities (O(n²) рендер) — не убирать.

## Rich-text (`src/core/richtext/markdown.ts`)

- Модель `MessageEntity` совпадает с бэком: offset/length в **UTF-16** (обычные индексы JS-строки).
- Инпут хранит **сырые** markdown-маркеры; разбор — на **отправке** (`parseMarkdown`), как в tweb.
  Не делать live-WYSIWYG для блоков кода.
- Язык блока кода = текст **до первого перевода строки** во fence (точное правило tweb), не угадывать по содержимому.
- Большая вставка — одним text-node через Range, **не** `execCommand('insertText', …)` (иначе фриз на тысячах нод).

## Скролл

Этап 2.1 заменил самодельные скролл-механики портированными из tweb 1:1. Позицией
скролла владеют:

- **`components/scrollable.ts`** (`Scrollable`/`ScrollableX`, порт
  `TWEB/src/components/scrollable.ts`) — throttled `onScroll`,
  `onScrolledTop`/`onScrolledBottom` (триггеры пагинации по `onScrollOffset`),
  `setScrollPositionSilently`/`ignoreNextScrollEvent` (корректирующая запись
  `scrollTop`, которая не рождает своё же `scroll`-событие — иначе программный
  пин к низу выглядел бы как ручной скролл пользователя). Пишет `scrollTop` НЕ
  буквальным присваиванием, а через динамическое свойство
  (`this.container[this.scrollPositionProperty] = value` — один класс
  обслуживает и вертикальный, и горизонтальный скролл). **Инстанцирован
  РОВНО в двух местах — и оба это ОДНА И ТА ЖЕ лента сообщений в двух её
  реализациях**, живущих под взаимоисключающим флагом сборки
  `VITE_VANILLA_FEED` (`config/app.ts::readVanillaFeed`, по умолчанию ВЫКЛЮЧЕН;
  развилка — `Chat.tsx`, пин — `components/Chat.vanillaFeed.test.ts`):
  - `core/hooks/useChatScroll.ts` — React-лента (`ChatFeed`), живая при
    выключенном флаге;
  - `components/chat/bubbles.ts::setScroll` — императивная лента (порт tweb
    `ChatBubbles`, этапы 2-7), живая при включённом.

  Обоснование правила от этого не изменилось и остаётся прежним: у ленты
  сообщений ОДИН владелец позиции скролла, второго конкурирующего писателя в
  ней нет. Два инстанса не сосуществуют в рантайме — флаг рендерит ровно одну
  ветку, и когда этап 7 снесёт React-ленту вместе с `useChatScroll.ts`, число
  вернётся к одному. `grep -rn "new Scrollable(" src` держит это число: **два**
  вхождения в продакшн-коде (плюс `components/scrollable.test.ts` — сам тест
  вендорного класса). Рост числа = новый владелец скролла, это осознанное
  решение, а не побочный эффект — правь правило руками.

  `MessageInput.tsx` несёт
  только классы `scrollable scrollable-y no-scrollbar` в разметке (комментарий
  над JSX: «в tweb приходят от `new Scrollable(...)`») — визуальный слепок
  чужого инстанса, не свой; как и ещё ~14 других `.scrollable`-элементов
  приложения (`ChatList`, `EmojiDropdown`/`StickersTab`/`GifsTab`,
  `MentionsHelper`, `TopbarSearch`, `StoriesRow`, …), это часть TODO в
  `core/dom/rootClasses.ts` — «Scrollable для остальных скроллеров», отдельная
  задача.
- **`helpers/scrollSaver.ts`** (`ScrollSaver`, порт `TWEB/src/helpers/scrollSaver.ts`)
  — сохранение/восстановление позиции при подгрузке контента НАД вьюпортом
  (`loadOlder`): якорится по `DOMRect` первого видимого сообщения, а не по
  дельте `scrollHeight` — остаётся верным, если во время доводки резайзится
  что-то, кроме самого добавленного чанка (например, media ниже по ленте).
  Подключён в обеих реализациях ленты — и по обе стороны флага это ОДНА и та же
  лента: `useChatScroll.ts` (React: `onScrolledTop` → `save()`, коммит нового
  окна → `restore()`) и `components/chat/bubbles.ts` (императивная:
  `createScrollSaver(reverse)` → `prepareToSaveScroll` внутри `processBatch`,
  порт tweb 1:1 — `save()` до `mountUnmountGroups`, `restore()` сразу после).
  Параметр `reverse` — направление якоря: `true` = «контент дописывается
  сверху» (якорь — первый видимый бабл, держим его верх), `false` = снизу.
- **`components/stickyIntersector.ts`** (порт `TWEB/src/components/stickyIntersector.ts`)
  — sticky-даты в ленте, на IntersectionObserver, не на ручном скролл-листенере.
  Два владельца по обе стороны флага `VITE_VANILLA_FEED`:
  `components/chatStickyDates.ts` (обвязка React-ленты: класс считается наверху
  и едет пропом, потому что React затирает императивную запись) и
  `components/chat/bubbles.ts` (императивная лента — как в tweb: наблюдатель
  пишет `is-sticky` ПРЯМО на узел дата-бабла, лента при этом не
  перерисовывается). Секцию наблюдает `observeStickyHeaderChanges`, и он же
  кладёт в неё третий узел — `.sticky_sentinel--top`; на этом стоит
  `STICKY_OFFSET === 3` (абсолютный индекс первой серии внутри секции), поэтому
  второй вызов на ту же секцию сдвинул бы все серии.
- **`helpers/fastSmoothScroll.ts`** (порт `TWEB/src/helpers/fastSmoothScroll.ts`)
  — JS-анимированный скролл с учётом паузы тяжёлых анимаций
  (`dispatchHeavyAnimationEvent`); используется `Scrollable.scrollIntoViewNew`.
  Перевод остальных плавных скроллов приложения (`scrollTo({behavior:'smooth'})`)
  на него — отдельная, ещё не начатая работа, вне периметра этапа 2.1.

**Единственный владелец прямой (числовой, event-bypassing) записи `scrollTop`
— Scrollable/ScrollSaver.** Держит `core/scrollWriters.test.ts` (по образцу
`core/state/noAdHocReads.test.ts` / `stores/noManualOrder.test.ts`): считает
буквальные `.scrollTop = `/`+=`/`-=`/`*=`/`/=` по исходникам и падает на новом
писателе или росте числа записей у известного. Обоснованные исключения
(каждое разобрано и не дублирует Scrollable/ScrollSaver по задаче — тест
держит их число):

| Файл | Что делает | Почему не через Scrollable/ScrollSaver |
|---|---|---|
| `core/hooks/useChatScroll.ts:95` | Фолбэк `setScrollTopSilently` в единственном кадре между монтированием React-узла и коммитом эффекта, создающего `Scrollable` | Как только `scrollableRef.current` появляется, вся корректирующая запись уходит в `Scrollable.setScrollPositionSilently` |
| `core/dom/smoothScrollToElement.ts:15` | Cap-прыжок перед нативным `scrollTo({behavior:'smooth'})` при центрировании бабла (jump-to-message) | Одноразовая анимация к цели, не хранение/восстановление позиции; свести к `fastSmoothScroll` — отдельная работа (см. выше) |
| `components/DatePickerPopup.tsx:195` | Начальная позиция (месяц `initDate`) при открытии попапа календаря | Одноразовая установка до первого показа; попап, не лента |
| `components/conversation/TopbarSearch.tsx:219` | Центрирование активной строки выдачи поиска по стрелкам | Формула 1:1 из tweb (`topbarSearch.tsx:678-681`); изолированный дропдаун, не лента |
| `components/virtual/useShouldAnimate.ts` (`createScrollShiftCompensator`) | Компенсация `scrollTop` вместо анимации, когда ВСЕ видимые строки виртуального списка сдвинулись на одинаковое число позиций | Порт побочного эффекта `verticalVirtualList.tsx:49-53`; список чатов не ходит через Scrollable/ScrollSaver — конкурировать за корректирующую запись не с кем |

Сброс списка чатов на верх при смене папки (`useSidebarFolders.tsx`) из этого
списка ушёл вместе со строкой: у каждой папки теперь свой `.folders-scrollable`
со своим `scrollTop` (как в tweb), и позиция не сбрасывается, а сохраняется.

**Вне скана `scrollWriters.test.ts` намеренно**: `scrollTo(...)`/`scrollIntoView(...)`
(по приложению — 12/8 вызовов, восьмой `scrollIntoView` — вендорный
`helpers/fastSmoothScroll.ts:109`). Это другая категория писателя — нативные API,
которые сами рождают настоящие `scroll`-события по ходу анимации, поэтому
`Scrollable.onScroll` видит их как обычный скролл (throttled
`onAdditionalScroll`/`checkForTriggers` отрабатывают штатно, в т.ч. в самой
ленте — `useChatScroll.ts`'s `scrollToBottom`/`smoothCenterToSeq`). Они не
тихие и не конкурируют за корректирующую запись с
`setScrollPositionSilently`/`ScrollSaver.restore()`, которые тихие по
построению, — поэтому не тот класс писателя, который держит этот пин.

## Медиа

### Вьювер — vanilla-ядро (`components/mediaViewer/`)

Медиавьювер — НЕ React-компонент, а порт vanilla-ядра tweb: `base.ts` (порт
`tweb/src/components/mediaViewer/base.ts` — DOM-дерево, полёт мувера,
зум/пан/поворот, свайпы, прелоадер), `appMediaViewer.ts` (message-вариант,
порт tweb `mediaViewer/index.ts`: топбар-кнопки, ⋮-меню, листание через
`listLoader`), `openMediaViewer.ts` (контроллер: один живой инстанс — аналог
tweb-глобали `window.appMediaViewer`; Esc — `core/hotkeys.pushEsc`, Back —
`navigationStack.pushLayer`). Видеоплеер — vanilla `lib/mediaPlayer` (порт tweb
`lib/mediaPlayer`), прелоадер — vanilla `components/preloader.ts` (порт tweb
`components/preloader.ts`). React живёт в ядре только ОСТРОВАМИ через
`createRoot`: аватарка автора (`.media-viewer-userpic`) и caption
(`RichText` в `.media-viewer-caption`).
**Правило изменений ядра: сначала tweb, порт 1:1**; своя ветка — только с
комментарием-обоснованием у строки. Карта непортированного (HLS/RTMP,
SVG-хвосты, profile-avatars-морф и т.п.) — отчёты
`docs/superpowers/plans/2026-08-12-task*-report.md` (сводная — task17).

### Медиа-слой: владелец URL — воркер

Картинки (фото, превью, аватарки) НЕ ходят токен-URL'ом. Модель tweb: воркер
(`core/managers/mediaManager.ts::downloadMediaURL`) качает байты → пишет в
CacheStorage-корзину `cachedFiles` (`core/files/cacheStorage.ts`; сохраняются
файлы ≤ `MAX_FILE_SAVE_SIZE` = 20 МиБ, константа tweb) → минтит `blob:`-objectURL
прямо в воркере (blob-стор общий на origin) → объявляет `rt:media_url`. Витрина
зеркалит (`core/mediaCache.ts`, потребление — `core/hooks/useMediaUrl` /
`useMediaThumb`); поздняя вкладка объявляет пробел сама — RPC `downloadMediaURL`
и есть канал доставки её снимка. Logout/смена сессии (`onLoggingOut` в
`workerCore`) стирает корзину (`deleteAll`) и revoke'ает objectURL'ы
(`mediaManager::resetDownloads`).

Токен-механизм (`core/mediaUrl.ts`) остался РОВНО двум категориям потребителей:
- **стрим `<video>`/`<audio>` при DNP-OFF** — `resolveStreamUrl` (при DNP-ON
  уводит на `/dnp-stream`, SW-206 из Noise-канала): вьювер/аудио-плеер
  (`mediaPlaybackController`) и инлайн-автоплей видео в `RealMediaBubble`
  (прямой `mediaContentUrl` в `src`);
- **байтовые fetch'и** («МОЖНО: bytes прямым fetch» выше): `StickerMedia`,
  файл-документ `RealMediaBubble`/`DocRow` (href + стрим с прогрессом),
  `core/audio/waveform`, `core/secret/mediaCache` (шифртекст E2E).

Новых потребителей токен-URL для картинок не заводить.

## Связь с бэком

- REST + WS через `core/net/*`; реалтайм и outbox — `core/realtime/connectionManager.ts`.
- Оптимистичная отправка: бабл заводит воркер сразу (`client_msg_id`), по ответу WS он же
  реконсилит (`message_ack`/`message_error` → операции окна) — см. «Владение фактами» выше.
- Dev ходит на бэкенд `:38080` (за nginx) через прокси Vite.
- **Индикатор в поле поиска сайдбара показывает состояние соединения, а не загрузку списка
  диалогов.** Автомат — `src/components/connectionStatus.ts` (порт tweb
  `src/components/connectionStatus.ts`); хост — `Sidebar.tsx`, монтирует и уничтожает его
  layout-эффектом, показывает автомат через три метода `shared/ui/InputSearch`
  (`isLoading`/`toggleLoading`/`setPlaceholder`, приезжают пропом `statusRef`). Значение всегда
  берётся pull-ом — `realtime.getStatus()` → `{state, retryAt, syncing}`; события `RT.state`,
  `RT.stateSynchronizing`, `RT.stateSynchronized` — только уведомления «дёрни pull», их payload
  читать нельзя (причина — в докблоке `getStatus`, `core/realtime/realtime.ts`).
  Второй индикатор с тем же классом `is-connecting` — в `components/conversation/TopbarSearch.tsx`:
  это загрузка выдачи поиска ПО ЧАТУ (порт `toggleLoading` из tweb `chat/topbarSearch.tsx`),
  к состоянию соединения отношения не имеет.

## Тесты

- **Норма построчная, не пофайловая.** Она применяется к **строке проводки** —
  созданию порта/подписки, регистрации RPC-хендлера, подписке на отключение,
  ретрансляции кадра — где бы эта строка ни лежала. Список файлов ниже —
  навигационная подсказка (типичные места, где такая проводка скапливается: файл,
  который поднимает среду — воркер, вкладку, страницу), а не периметр нормы: она
  не «выключается» оттого, что строка лежит в файле не из списка, и не
  «включается» просто по факту нахождения в файле из списка. Решающая процедура,
  которой на практике и пользуемся: **если удаление строки не красит ни одного
  теста, а приложение при этом ломается — строка нарушает норму**, независимо от
  того, где она лежит и импортируется ли файл тестами. Любая такая строка обязана
  либо иметь тест, который краснеет на её удалении/порче, либо быть явно помечена
  комментарием ПРЯМО У НЕЁ как сознательно непокрытая, с причиной. «Уже давно так
  работает и покрыто интеграционно» — не довод: `registerManagers(smp, registry)`
  в `bind()` жила без единого теста на сам факт вызова с момента введения
  RPC-моста, пока весь прогон (177 файлов/1170 тестов) не остался зелёным на
  `void registerManagers` вместо неё — молчаливый мёртвый RPC-мост для всех 32
  менеджеров сразу. Тот же класс дыры нашёлся в точке монтирования `core.start()`
  (вырезание `if('onconnect' in g){…}else{bind(g)}` красило 0 тестов при зелёном
  полном прогоне) и повторно — уже в самой ветке `if` этого блока (см. пример
  мутации ниже): решающая процедура одна и та же на всех трёх уровнях.
- **Делегирующий вызов — тоже строка проводки.** Если строка сама не создаёт порт и
  не вешает подписку, а лишь зовёт функцию, которая это делает (`startClient()` в
  `client/boot.ts`, `core.start()` в `core/worker.ts`), покрытие вызываемого её не
  оправдывает: вырезать можно именно вызов, и тогда покрытая функция просто не
  выполнится. Норма применяется как обычно — тест на факт вызова либо пометка у
  строки. Прецедент: `attachLock` был покрыт целиком, но `bootstrap.lock.test.ts`
  отдельно пинит, что `startClient()` его **зовёт**, — без этого удаление вызова
  проходило зелёным.
- **Критерий приёмки действует для ЛЮБОЙ проводки, подпадающей под норму, — не
  только для той, что появилась в рамках задачи по выносу логики из корня
  бандла.** Старая, годами лежавшая без теста строка подчиняется норме ровно так
  же, как новая: дата появления строки не освобождает её от требования теста или
  пометки.
- Мутация обязана краснеть — приводить реальный вывод vitest, не пересказывать.
  Пример: `src/core/workerCore.ts` (`createWorkerCore().bind` и `.start`) +
  `src/core/workerCore.test.ts` — тест зовёт настоящие `bind()`/`start()` через
  фейковые эндпоинты и краснеет на порче `smp.onAny(...)`, на замене
  `smp.setOnPortDisconnect(...)` на no-op, на замене `registerManagers(smp,
  registry)` на `void registerManagers` и на вырезании блока `onconnect`/`bind` из
  `start()` целиком. `start()` устанавливает проводку ДВУМЯ независимыми ветками
  (`if`/`else` по `'onconnect' in self`) — реальный SharedWorker-путь (все
  десктопные браузеры) и фолбэк-путь без SharedWorker (Chrome for Android); в
  happy-dom (тестовое окружение) без стаба достижима только ветка `else`
  (`'onconnect' in self` там false), поэтому ветку `if` покрывает отдельный тест
  через `vi.stubGlobal('self', ...)`. Обе ветки краснеют по отдельности — не
  только на вырезании блока целиком, но и на мутации ВНУТРИ живой ветки `if`
  (путаница индекса `ports[0]` → `ports[1]` в обработчике `onconnect`, опустошение
  его тела) — первый прогон покрывал только `else`, вторая ветка была найдена
  повторным ревью тем же приёмом («мутация краснит?»). Пример
  непокрытой-но-помеченной строки — ветка DNP-моста
  `if (fileDownload) { ep.addEventListener(...) }` там же: комментарий рядом
  объясняет, что она активна только при DNP-ON и вне периметра теста.
- **Известная условность покрытия: аварийные рубильники дезактивируют и свой
  тест.** `USE_LOCKS` (`src/rpc/superMessagePort.ts`) при `false` гасит всю
  механику Web Locks — и производственный код, и тесты, которые его проверяют
  (`superMessagePort.lock.test.ts`, `bootstrap.lock.test.ts` целиком под
  `describe.skipIf(!USE_LOCKS)` — это осознанный выбор: тест выключенной механики
  не «зелёный», а без предмета проверки, см. комментарии в файлах). Следствие:
  строки `attachLock(smp)` (`bootstrap.ts`, единственный вызов внутри
  `startClient()`) и `smp.setOnPortDisconnect(...)` (`workerCore.ts`, внутри
  `bind()`) при `USE_LOCKS=false` теряют красный тест на своё удаление — при
  выключенном рубильнике защищаемый ими код действительно мёртв, так что по
  решающей процедуре выше в ЭТОМ состоянии константы удаление не ломает
  приложение и норму не нарушает. Переписывать тесты под это не нужно. Риск не в
  самом флипе, а в окне: если такую строку удалят, пока рубильник выключен, она
  не вернётся при обратном флипе — CI смолчит и тогда, и после отката. Держать в
  уме при ревью PR, тронувших `USE_LOCKS`-гейтированный код.

**Статус по файлам этой роли (навигационная подсказка, не периметр — см. норму выше):**
- `src/core/worker.ts` — соответствует. Обе строки (`createWorkerCore()` /
  `core.start()`) нельзя вызвать в тесте тем же путём, каким их вызывает браузер —
  это точка входа воркера, исполняемая при загрузке модуля браузером, а не
  библиотечный экспорт; обе помечены комментарием у себя с этой причиной. Вся
  проводка, которую они запускают, вынесена в `workerCore.ts` и покрыта
  поведенческими тестами `workerCore.test.ts` (`bind()` и обе ветки `start()`).
- `src/client/bootstrap.ts` — соответствует, но НЕ по формуле «только сборка и
  делегирование»: файл содержит реальную логику Web Locks (`attachLock`). Она
  импортируется и тестируется напрямую — `bootstrap.lock.test.ts` (describe
  `bootstrap.startClient — реальная проводка вызывает attachLock`) проверяет, что
  `startClient()` реально вызывает `attachLock`, а не только что функция где-то
  существует. Условность покрытия при `USE_LOCKS=false` — см. пункт выше.
- `src/components/Chat.tsx` — известное исключение и долг (точные размер файла и
  число `useEffect` здесь не приводим намеренно — они дрейфуют при каждой правке
  файла и протухают быстрее, чем кто-то успеет их поправить; ориентир — «самый
  большой компонент клиента, на порядок больше следующего по размеру»). Ни один
  тест её не импортирует. Не переписывать ради самой нормы прямо сейчас; при
  следующем содержательном касании файла — приводить затронутую проводку в
  соответствие (тест либо пометка с причиной), а не расширять непокрытую площадь
  дальше.
