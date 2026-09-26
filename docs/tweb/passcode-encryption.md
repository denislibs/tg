# Код-пароль: шифрование хранилищ клиента

Снято 2026-09-27 по tweb `812502980` (`/Users/denisurevic/Documents/tweb`). Ключевые коммиты:
`5f4ebfba5`/`0bed3f94f` «Encrypt the stores», `8e85f9250` «Encrypt cache storage», `5447102ef`
«Save crypto key instead of passcode hash», `07f416f0b` (блокировка убивает SharedWorker),
`65c6ea8f8` «Keep the passcode-derived key out of localStorage», `eff3c59fa` «Encrypt the stores
nobody had opened when the passcode was enabled». UI экрана блокировки и вкладок настроек —
в [`settings-rows.md`](settings-rows.md) (задача 18 волны 2D); здесь — только механизм хранения.

Задача у нас — S10 в [`delta/security-and-bugs.md`](delta/security-and-bugs.md).

## 1. Ключ: вывод, проверка, где живёт

| Что | Где в tweb |
|---|---|
| PBKDF2-SHA-256, 100 000 итераций, соль 16 байт; `hashPasscode` → 256 бит для сверки | `lib/passcode/utils.ts:5-19`, `constants.ts:1-2` |
| `deriveEncryptionKey` → AES-GCM-256, **extractable** (нужно для передачи через `sessionStorage`) | `utils.ts:21-34` |
| `createEncryptionArtifactsForPasscode`: две независимые соли — `verificationSalt` (хеш сверки) и `encryptionSalt` (ключ) | `utils.ts:36-45` |
| На диске только `{verificationHash, verificationSalt, encryptionSalt}` (`commonStateStorage` ключ `passcode`), сам ключ — никогда | `actions.ts:48-54`, `commonStateStorage.ts:11-38` |
| Сверка кода — `bytesCmpConstTime` | `actions.ts:81-89` |
| `EncryptionKeyStore` — ключ в памяти своего реалма (окно, воркер, SW — у каждого свой); `get()` ждёт deferred до первого `save` | `keyStore.ts:5-45` |
| `DeferredIsUsingPasscode` — «код включён», deferred до первого ответа; в воркере/окне разрешается из `settings.passcode.enabled` | `deferredIsUsingPasscode.ts:6-35`, `commonStateStorage.ts:49-51` |
| Шифр данных: AES-GCM, IV 12 байт, на диске `iv ‖ ciphertext` | `lib/crypto/utils/aesLocal.ts` (`encryptLocalData`/`decryptLocalData`) |

## 2. Что шифруется

| Хранилище | Как | Где |
|---|---|---|
| Ключи авторизации всех аккаунтов (`account1..4`, легаси `dc*_auth_key`, `user_auth`, `dc`) | `LocalStorageController` с набором encryptable-ключей: при включённом коде читает/пишет `EncryptedStorageLayer` вместо localStorage | `sessionStorage.ts:67-75`, `localStorage.ts:189-266` |
| Слой шифрования | весь набор ключей — **один** JSON-блоб, шифруется целиком и кладётся в IDB `tweb-common/localStorage__encrypted` под ключом `data`; пустой набор — блоб удаляется | `encryptedStorageLayer.ts:65-97`, `:137-171`, `config/databases/state.ts:33-45` |
| БД аккаунта (`users`, `chats`, `messages`, `dialogs`, …) | у каждого стора пара `name`/`encryptedName`; под кодом `AppStorage` открывает `EncryptedStorageLayer` | `storage.ts:112-132`, `config/databases/state.ts:47-82` |
| Корзины CacheStorage | `encryptable: true` у `cachedFiles`, `cachedStreamChunks`, `cachedHls*`; `false` у `cachedAssets`, `cachedBackgrounds`. `get`/`save` шифруют тело, заголовки (в т.ч. `Content-Length` исходника) сохраняются | `files/cacheStorage.ts:28-47`, `:112-146`, `:215-262` |
| **Не** шифруются | `commonStateStorage` (настройки, langpack, запись `passcode`), `number_of_accounts` (нужен экрану блокировки до разблокировки) | `sessionStorage.ts:32`, `passcodeLockScreen.tsx:64` |

Шифрование и перешифровка — **только в воркере** (`localStorage.ts:272-277`
`warnAboutEncrypting`); окно читает зашифрованные ключи прокси-вызовом
`localStorageEncryptedProxy` (`localStorage.ts:208-220`, `index.worker.ts:318-320`).

## 3. Действия (`lib/passcode/actions.ts`)

| Действие | Порядок | Адрес |
|---|---|---|
| **Включить** | артефакты → запись `passcode` → `settings.passcode.enabled=true` → корзины на паузу (окно, воркер, SW) → очистка шифруемых корзин + `reset` открытых → воркеру `toggleUsingPasscode{true,key}` (шифрует, рассылает остальным) → SW `{type:'full'}` → `rootScope toggle_using_passcode` → ключ в своё `EncryptionKeyStore` → корзины с паузы → `updateStorageForLegacy(null)` (стереть открытые легаси-ключи) | `actions.ts:42-79` |
| **Выключить** | `enabled=false` → пауза → очистка корзин → воркеру `toggleUsingPasscode{false}` (расшифровывает обратно, чистит слой) → SW → ключ `null` → с паузы → удалить запись `passcode` → `updateStorageForLegacy(account1)` | `actions.ts:91-111` |
| **Сменить** | новые артефакты (перешифровка всегда, даже при том же коде) → пауза → очистка корзин → воркеру `changePasscode{toStore,key}` → SW `saveEncryptionKey` → ключ себе → с паузы → запись `passcode` | `actions.ts:116-143` |
| **Разблокировать** | вывести ключ из `encryptionSalt` → себе → воркеру `saveEncryptionKey` → SW → `toggleLockOthers(false)` | `actions.ts:148-161` |

Корзины: `temporarilyToggle(false)` ставит deferred, который ждут `get`/`save`
(`cacheStorage.ts:148-159`, `:370-377`); очистка — `caches.delete` по именам шифруемых корзин
(`:394-421`), открытые экземпляры сбрасывают `openDbPromise` (`:423-430`).

## 4. Воркер (`mainWorker/index.worker.ts`)

| Хендлер | Что делает | Адрес |
|---|---|---|
| `isLocked` (старт — `true`) | код включён и ключ есть → сначала шлёт ключ вкладке `saveEncryptionKey`, отвечает `false`; нет ключа → `true`; кода нет → `false` | `:54`, `:295-305` |
| `toggleUsingPasscode` | при включении сначала сохраняет ключ; `encryptEncryptable`/`decryptEncryptable` (+ сторы аккаунта); при выключении ключ `null` только **после** расшифровки; рассылка остальным вкладкам; `isLocked=false` | `:250-274` |
| `changePasscode` | пишет запись, читает всё **старым** ключом (`loadEncryptable`), меняет ключ, перешифровывает, рассылает ключ | `:276-293` |
| `saveEncryptionKey` | ключ в память, `isLocked=false`, рассылка остальным | `:312-316` |
| `toggleLockOthers` | `isLocked=value`, остальным `toggleLock` → их экран блокировки | `:307-310`, `apiManagerProxy.ts:521-527` |
| `toggleCacheStorage`, `resetEncryptableCacheStorages` | пауза/сброс корзин в воркере + рассылка | `:322-329` |
| `forceLogout` | «забыл код»: `ApiManager.forceLogOutAll` — всё стирается **без** ключа и без сервера | `:331-333`, `apiManager.ts:372-388` |
| `terminate` | `selfTerminate()` — ключ уходит вместе с воркером | `:246-248` |
| вкладок не осталось и код включён | воркер сам завершается | `:397-404` |

Слой шифрования сам ждёт ключ (`EncryptionKeyStore.get()` в `encrypt`/`decrypt`), поэтому до
разблокировки воркер **физически не может** достать ключи авторизации — сеть с ними не стартует.

Миграция «хвостов» (`eff3c59fa`): направление переноса берётся из аргумента, а не из текущего
слоя; стор, открытый уже под кодом, вливает оставшееся в открытом виде в зашифрованный слой
(`storage.ts:134-153` `encryptLeftovers`, `:466-499` `toggleEncrypted`); `clear()` чистит оба
слоя без открытия зашифрованного — выход с экрана блокировки не ждёт ключа (`storage.ts:395-406`).

## 5. Старт и блокировка

| Шаг | Адрес |
|---|---|
| До построения UI: `await PasscodeLockScreenController.waitForUnlock(cb)` — ДО `loadAllStates` | `index.ts:453-467` |
| `checkLockState`: сперва ключ из передачи (`takeEncryptionKeyHandoff`), иначе `invoke('isLocked')`; заперто → колбэк (настройки, тема, langpack из кэша) и экран блокировки | `passcodeLockScreenController.tsx:29-76` |
| Экран: сверка → `unlockWithPasscode` → `unlock()`; 5 попыток → таймаут; «забыли» → попап → `forceLogout` | `passcodeLockScreen.tsx:138-244` |
| Кнопка замка / сочетание: экран с анимацией, затем `apiManagerProxy.lock()` = `terminate` воркера + `reload` всем вкладкам по BroadcastChannel + свой `reload` | `lockButton.tsx:53-54`, `useLockScreenShortcut.ts:70-71`, `apiManagerProxy.ts:1466-1470` |
| Автоблокировка — в воркере: все вкладки простаивают N минут → `reload` + `selfTerminate` | `mainWorker/useAutoLock.ts:18-83`, `index.worker.ts:381-395` |

## 6. Передача ключа (`65c6ea8f8`, `lib/passcode/keyHandoff.ts`)

Переключение аккаунта и выход при нескольких аккаунтах перезагружают вкладку; чтобы не
спрашивать код посреди перехода, ключ (raw → base64) кладётся в **`window.sessionStorage`**
(`encryption_key_handoff`), а не в localStorage-контроллер: тот на диске и расшифровывает все
ключи авторизации. Пишет окно (`sidebarLeft/index.ts:906-913`, только если открыта одна
вкладка — иначе воркер переживёт перезагрузку), воркер — через `passcodeKeyHandoff`
(`apiManager.ts:353-356`). Читает `takeEncryptionKeyHandoff` на старте и сразу удаляет; заодно
стирает старый `encryption_key` с диска (`keyHandoff.ts:45-58`).

## 7. Service worker

Своё `EncryptionKeyStore`/`DeferredIsUsingPasscode`, только в памяти; браузер перезапускает SW
когда хочет, поэтому вкладка присылает состояние на каждый `hello` — с ключом, если она
разблокирована, иначе `{type:'init'}` без ключа (`apiManagerProxy.ts:774-781`, `:900-905`;
`index.service.ts:143-162`). Нет окон — состояние сбрасывается (`index.service.ts:225-239`).

---

## У нас

### Карта файлов (до порта)

| Наше | Что было |
|---|---|
| `core/passcode.ts` | PBKDF2-хеш сверки, запись `passcode` в `msgr/kv`; включение стирало офлайн-стор; ключа шифрования не было |
| `core/auth/tokenStore.ts`, `core/auth/accounts.ts` | `session_token` и `accounts` (с токенами) — открытым текстом в IndexedDB `msgr/kv` |
| `client/boot.ts` | главный поток сам читал `session_token` из `msgr/kv`; «под локом» рисовал приложение с экраном поверх |
| `core/store/persist.ts` | офлайн-стор `msgr-store` под кодом не пишется (гард `locked()`), но `meta.token` писался открытым текстом |
| `core/files/cacheStorage.ts`, `public/sw.js` | `cachedFiles` под кодом не чистилась и писалась открытым текстом (воркер и SW) |
| `stores/lockStore.ts`, `components/PasscodeLockScreen.tsx` | блокировка только интерфейса одной вкладки; воркер продолжал работать с токеном |
| `core/workerCore.ts::start` | `tokens.ready().then(auth.me)` — сеть с токеном на старте воркера и под локом |

### План порта (S10)

1. `lib/passcode/{constants,utils,keyStore,deferredIsUsingPasscode,keyHandoff}.ts` +
   `lib/crypto/aesLocal.ts` — 1:1.
2. `lib/encryptedStorageLayer.ts` — 1:1 над нашим `msgr/kv`: блоб под ключом `kv__encrypted`
   (отдельный object store потребовал бы апгрейда версии `msgr`, а старые соединения его
   блокируют).
3. `core/store/sessionKv.ts` — порт `LocalStorageController` (+ `encryptLeftovers` из
   `eff3c59fa`), encryptable: `session_token`, `accounts`, `outbox`. Только воркер. `TokenStore`,
   `accounts.ts`, outbox — через него. `DeferredIsUsingPasscode` в воркере — из наличия записи
   `passcode` в `msgr/kv` (наш аналог `commonStateStorage`; настройки у нас в localStorage,
   воркеру недоступном).
4. Воркер: канал `passcode` на каждом порту (`isLocked`, `toggleUsingPasscode`, `changePasscode`,
   `saveEncryptionKey`, `toggleLockOthers`, `toggleCacheStorage`, `resetEncryptableCacheStorages`,
   `forceLogout`, `terminate`) с рассылкой «кроме источника»; вкладка слушает `saveEncryptionKey`,
   `toggleLock`, `toggleUsingPasscode`, `toggleCacheStorage`.
5. `lib/passcode/actions.ts` (вместо `core/passcode.ts`) — enable/isMy/disable/change/unlock 1:1.
6. `core/files/cacheStorage.ts` — `encryptable`, шифрование `get`/`save`, пауза, очистка/сброс.
   `public/sw.js` — состояние кода из записи `passcode` + ключ сообщением (и на `sw-hello` после
   перезапуска); нет ключа при включённом коде — кэш в обход.
7. Старт: `waitForUnlock` до чтения токена/стейта; главный поток токен больше не читает —
   `persist.scopeToSession()` в воркере. Замок и сочетание — `lock()` (terminate + reload всем).
8. Миграция: у старой записи нет `encryptionSalt` — при первой разблокировке создать соль,
   дописать запись, воркер вливает открытые `session_token`/`accounts` в слой и стирает их,
   `cachedFiles` чистится. Выключение — `decryptEncryptable`.
9. Передача ключа: перед перезагрузкой перехода аккаунта — в `window.sessionStorage`.

### Расхождения (после порта)

| # | Что | Почему |
|---|---|---|
| П-1 | Офлайн-стор `msgr-store` (диалоги/сообщения/юзеры) под кодом не шифруется, а стирается и не пишется (гард `locked()`); tweb шифрует БД аккаунта | прежнее поведение сохранено, отдельная задача (порт `AppStorage.toggleEncryptedForAll`) |
| П-2 | Флаг «код включён» для воркера и SW — наличие записи `passcode` в `msgr/kv`, а не `settings.passcode.enabled` | наши настройки в localStorage, воркеру и SW недоступном |
| П-3 | Автоблокировка — в окне (UI-замок одной вкладки, ключ остаётся в памяти); у tweb — в воркере по простою всех вкладок с `terminate` | перенос требует учёта простоя вкладок в воркере; открытый вопрос |
| П-4 | Передачу ключа пишет каждая перезагружающаяся вкладка, не только единственная | у нас активный аккаунт один на все вкладки, переход перезагружает все, и SharedWorker может не пережить |
| П-5 | «Забыли код» — прежние тексты экрана (`PasscodeLock.ForgotPasscode.Text`), а выход — уже всех аккаунтов (`forceLogout`) | порт экрана блокировки — отдельная UI-задача (ключи tweb `ForgotPasscode.OneAccount/MultipleAccounts`) |
| П-6 | Шифрование в своём реалме через WebCrypto, без крипто-воркера | у нас нет `cryptoMessagePort` |

### Проверка после порта (стенд)

1. Включить код → в DevTools `IndexedDB msgr/kv`: нет `session_token`, `accounts`; есть
   `kv__encrypted` (Uint8Array) и `passcode` c `encryptionSalt`; `localStorage`/`sessionStorage` без ключа.
2. Cache Storage `cachedFiles` пуст сразу после включения; открыть чат с фото — записи есть, тело
   не читается как картинка (зашифровано), в ленте картинки видны.
3. F5 → экран блокировки; в Network до ввода кода нет ни одного запроса к `/api` с токеном и нет WS.
4. Ввод кода → приложение поднимается, `kv__encrypted` на месте, открытых токенов нет.
5. Две вкладки (SharedWorker): замок в одной → обе перезагружаются на экран блокировки;
   разблокировка в одной снимает экран во второй.
6. `?noSharedWorker=1`: каждая вкладка разблокируется сама, данные те же.
7. Смена кода → старый код не подходит, новый подходит; данные на месте.
8. Выключение → `session_token`/`accounts` снова открытым текстом, `kv__encrypted` нет.
9. Переключение аккаунта под кодом → без повторного ввода; после — `sessionStorage` вкладки пуст.
10. «Забыли код» → выход из всех аккаунтов, кода нет, `cachedFiles` пуст.
