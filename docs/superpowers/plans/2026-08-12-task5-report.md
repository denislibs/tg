# Task 5: CacheStorageController — отчёт

**Статус: выполнено.** Ветка `feat/tweb-media-core`, worktree
`.worktrees/media-viewer-touch`, коммит см. `git log` (не запушен).

## Что сделано

- `web-client/src/core/files/cacheStorage.ts` — порт tweb
  `src/lib/files/cacheStorage.ts` (класс `CacheStorageController(dbName)`)
  в нашем объёме, с tweb-API, чтобы будущие корзины (стрим-чанки) легли без
  переделки:
  - конфиг корзин: только `cachedFiles` (`cacheStorageDbNames`; от конфига
    tweb с флагом `encryptable` без шифрования остаются только имена);
  - ключи `'/' + entryName` во всех операциях (`get`/`save`/`has`/`delete`);
  - `getFile(name, method='blob')` (промах → `makeError('NO_ENTRY_FOUND')`),
    `saveFile(name, blob)` → `save` с заголовками `Time-Cached` (секунды,
    `Math.floor(Date.now() / 1000 | 0)`) + `Content-Length`/`Content-Type`
    (tweb cacheStorage.ts:226-231,247), `Uint8Array` → `blobConstruct`;
  - `deleteAll` — через `caches.delete(dbName)` (tweb :158-161), НЕ перебором
    ключей: на слишком большом кэше `cache.keys()` бросает (комментарий со
    ссылкой на tweb :390-394); статик `deleteAllStorages` — по всем именам
    конфига;
  - `timeoutOperation` с `defaultOperationTimeout = 15e3`: `useStorage=false`
    → мгновенный `Promise.reject(makeError('STORAGE_OFFLINE'))`; falsy
    результат `caches.open` → перманентное выключение (`useStorage = false`,
    сброс `openDbPromise`, `throw 'no cache?'` — tweb :283-301); статик
    `toggleStorage(enabled, _clearWrite)`;
  - `makeError` — наш существующий `@helpers/makeError` (тот же порт tweb),
    ничего нового не заводил.
- **Не портировано (обоснования в шапке файла):** passcode-шифрование
  содержимого (encrypt/decrypt, `waitToEnable`/`temporarilyToggle*`) — у нас
  нет пасскода с шифрованием кэша; `minimalBlockingIterateResponses`,
  `prepareWriting` (MemoryWriter), `forget`/`reset`, `_test`-суффикс имени
  (Modes.test) — нет потребителей.
- **Адаптации под strict/oxlint:** `openDbPromise` опционален; `getFile`
  типизирован дженериком по методу чтения вместо `Promise<any>`;
  `void this.openDatabase()` в конструкторе (fire-and-forget прогрев);
  одно подавление `eslint-disable-next-line no-async-promise-executor` у
  async-исполнителя `timeoutOperation` — структура tweb сохранена 1:1,
  reject у тела есть (catch), комментарий у строки.

## Тесты (TDD, vitest + happy-dom)

`src/core/files/cacheStorage.test.ts` — написан до реализации (первый прогон
красный: модуля нет). happy-dom не даёт Cache API — `globalThis.caches`
замокан Map-бэкендом (`FakeCache` match/put/delete, `FakeCacheStorage`
open/delete). 8 тестов: save→get то же содержимое + ключ `'/media_1'` +
заголовки `Time-Cached`/`Content-Length`; getFile несуществующего →
NO_ENTRY_FOUND; has/delete по ключу с префиксом; deleteAll →
`caches.delete('cachedFiles')` без перечисления ключей; deleteAllStorages;
toggleStorage(false) → мгновенный STORAGE_OFFLINE (fake timers не
проматываются — reject обязан прийти без таймеров, и open не зовётся);
таймаут 15 с на висящем `caches.open` (fake timers, reject без значения — как
tweb `reject()`); falsy `caches.open` → `'no cache?'`, повтор — мгновенный
STORAGE_OFFLINE без нового open.

```
 Test Files  216 passed (216)
      Tests  1488 passed | 2 skipped (1490)
```

`npx tsc --noEmit` — 0 ошибок. oxlint: 0 диагностик в новых файлах, общий
счёт 2673 = базлайн 2673.

## Мутационная проверка (реальный вывод vitest)

**Мутация 1** — сломан префикс `'/'` у ключа в `save`
(`cache.put(entryName, result)`):

```
 FAIL  src/core/files/cacheStorage.test.ts > CacheStorageController > saveFile → getFile: то же содержимое; ключ "/"+entryName; заголовки Time-Cached (секунды) и Content-Length
AssertionError: expected [ 'media_1' ] to deeply equal [ '/media_1' ]
      Tests  2 failed | 6 passed (8)
```

**Мутация 2** — снято перманентное выключение (`this.useStorage = false`
удалён из ветки falsy-open):

```
 FAIL  src/core/files/cacheStorage.test.ts > CacheStorageController > falsy результат caches.open выключает хранилище перманентно: повтор — STORAGE_OFFLINE без нового open
AssertionError: expected 'no cache?' to match object { type: 'STORAGE_OFFLINE' }
      Tests  1 failed | 7 passed (8)
```

Обе мутации откатаны, финальный полный прогон зелёный.

## Замечания

- Наследование `useStorage` новым инстансом идёт от `STORAGES[0]` (первого
  созданного) — как в tweb; перманентное выключение при falsy `caches.open`
  действует на конкретный инстанс (тоже как в tweb). Тест наследования
  «нового контроллера от выключенного» поэтому не писал — в tweb такой
  гарантии нет.
- `toggleStorage` возвращает `Promise.resolve()` (в tweb зовётся через
  message port) — сигнатура сохранена под ту же будущую проводку.
- Статический реестр `STORAGES` в тестах не сбрасывается (в tweb нет API
  сброса) — тесты нормализуют состояние `toggleStorage(true, false)` в
  `beforeEach`.
