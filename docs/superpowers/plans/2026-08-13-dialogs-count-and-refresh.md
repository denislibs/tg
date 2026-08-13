# Размер набора и `refresh()` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оживить пагинацию списка диалогов — научить `/chats` реальным папкам, а владельца —
считать размер набора и «загружено целиком» по выборке, и сделать `refresh()` ограниченным
удерживаемым окном вместо всего списка.

**Architecture:** Модель tweb: реальных папок две (`0` — всё кроме архива, `1` — архив),
пользовательская папка — клиентский фильтр поверх глобального набора. Бэкенд режет выборку до
подсчёта, поэтому `count`/`is_end` относятся к запрошенной папке. Владелец держит `serverCount` и
биты «загружено» по трём выборкам (`global`/`all`/`archive`) с решёткой
`global ⟺ all && archive` — дословный порт `isDialogsLoaded`/`setDialogsLoaded`.

**Tech Stack:** Go 1.25 (chi, чистая архитектура `domain → usecase → adapter`), TypeScript strict,
vitest, React 19. Референс — tweb (`/Users/denisurevic/Documents/tweb`).

## Global Constraints

- **Спека — `docs/superpowers/specs/2026-08-13-dialogs-count-and-refresh-design.md`**, раздел
  «Отступления» читать ПЕРЕД правкой ядра.
- Референс 1:1 с tweb: `lib/storages/dialogs.ts:276-299` (решётка загруженности), `:1646-1649`
  (`realFolderId`), `:1691-1753` (`getDialogs`), `:1728` (счётчик фильтра),
  `lib/appManagers/constants.ts:37-39` (`FOLDER_ID_ALL`/`FOLDER_ID_ARCHIVE`/`REAL_FOLDERS`).
- Своя ветка вместо оригинальной — только с комментарием-обоснованием у строки.
- **Норма покрытия построчная:** мутация обязана краснить. Приводить реальный вывод vitest/go test,
  не пересказывать. Непокрытая строка — только с пометкой ПРЯМО У НЕЁ и причиной.
- Мёртвый код удалять; заглушек не оставлять.
- Комментарии на русском, как в окружающем коде.
- Проверки перед коммитом: `go vet ./... && gofmt -l .` (backend), `npm run typecheck` и
  `npm test` (web-client).
- Не заводить второй источник порядка/списка/правила мьюта — пины
  `stores/noManualOrder.test.ts`, `stores/noDuplicateDialogs.test.ts`,
  `stores/noDuplicateMuteRule.test.ts`.

---

### Task 1: Выборка реальной папки в домене и usecase

**Files:**
- Modify: `backend/internal/domain/chat.go:130-148` (тип `DialogFolder`, поле в `DialogPage`)
- Modify: `backend/internal/usecase/chat/dialogpage.go`
- Test: `backend/internal/usecase/chat/dialogpage_test.go`

**Interfaces:**
- Consumes: `domain.Dialog{ChatID int64; Archived bool}`, `domain.DialogPage{Limit int; OffsetChatID int64}`,
  `domain.DialogPageResult{Dialogs []Dialog; Count int; IsEnd bool}` — существуют.
- Produces: `domain.DialogFolder` с константами `domain.FolderGlobal` (нулевое значение),
  `domain.FolderAll`, `domain.FolderArchive`; поле `domain.DialogPage.Folder DialogFolder`;
  поведение `sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult` —
  фильтрует по `p.Folder` ДО подсчёта.

- [ ] **Step 1: Написать падающий тест**

Дописать в `backend/internal/usecase/chat/dialogpage_test.go`:

```go
// archivedFixture — набор со смешанными архивными: 10,30,50 в архиве.
func archivedFixture() []domain.Dialog {
	return []domain.Dialog{
		{ChatID: 10, Archived: true},
		{ChatID: 20},
		{ChatID: 30, Archived: true},
		{ChatID: 40},
		{ChatID: 50, Archived: true},
	}
}

func TestSliceDialogPageFolder(t *testing.T) {
	all := archivedFixture()

	t.Run("нулевое значение Folder — весь набор, как до появления папок", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 {
			t.Fatalf("count=%d, want 5", r.Count)
		}
	})

	t.Run("FolderAll — без архива, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: domain.FolderAll})
		eq(t, chatIDs(r.Dialogs), []int64{20, 40})
		if r.Count != 2 || !r.IsEnd {
			t.Fatalf("count=%d isEnd=%v, want 2 true", r.Count, r.IsEnd)
		}
	})

	t.Run("FolderArchive — только архив, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: domain.FolderArchive})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30, 50})
		if r.Count != 3 {
			t.Fatalf("count=%d, want 3", r.Count)
		}
	})

	// Курсор ищется ВНУТРИ выборки: chat_id 30 в архиве — второй, а в полном
	// наборе третий. Мутация «фильтровать после нарезки» краснит здесь.
	t.Run("курсор считается внутри выборки", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: domain.FolderArchive, Limit: 1, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{50})
		if r.Count != 3 || !r.IsEnd {
			t.Fatalf("count=%d isEnd=%v, want 3 true", r.Count, r.IsEnd)
		}
	})

	// Чат из ДРУГОЙ выборки курсором не является — страница идёт с начала
	// (то же правило, что у неизвестного id: домен не различает эти случаи).
	t.Run("курсор из другой выборки — страница с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: domain.FolderArchive, Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30})
	})
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что он падает**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestSliceDialogPageFolder`
Expected: FAIL — компиляция, `undefined: domain.FolderAll`.

- [ ] **Step 3: Тип выборки в домене**

В `backend/internal/domain/chat.go`, непосредственно перед `type DialogPage struct`:

```go
// DialogFolder — РЕАЛЬНАЯ папка выборки диалогов. Порт tweb REAL_FOLDER_ID
// (lib/appManagers/constants.ts:37-39): на сервере существуют ровно две папки,
// «все чаты» и «архив»; пользовательские папки — клиентский фильтр поверх них
// и до бэкенда не доходят.
type DialogFolder int

const (
	// FolderGlobal — запрос без папки: весь набор. Нулевое значение выбрано
	// сознательно — уже существующие domain.DialogPage{} без явного поля
	// обязаны означать «как раньше», а не «всё, кроме архива». Порт tweb
	// GLOBAL_FOLDER_ID (dialogs.ts:68).
	FolderGlobal DialogFolder = iota
	// FolderAll — всё, кроме архива (на проводе folder_id=0, tweb FOLDER_ID_ALL).
	FolderAll
	// FolderArchive — только архив (на проводе folder_id=1, tweb FOLDER_ID_ARCHIVE).
	FolderArchive
)
```

Добавить поле в `DialogPage` (после `OffsetChatID`):

```go
	// Выборка, внутри которой считаются Count, IsEnd и курсор. FolderGlobal
	// (нулевое значение) — весь набор.
	Folder DialogFolder
```

- [ ] **Step 4: Фильтрация до подсчёта в usecase**

В `backend/internal/usecase/chat/dialogpage.go` добавить перед `sliceDialogPage`:

```go
// scopeDialogs — оставить диалоги запрошенной реальной папки. Порт tweb
// getFolderDialogs (dialogs.ts:433): выборка режется ДО подсчёта, поэтому
// Count и IsEnd относятся к папке, а не к полному набору, — без этого у
// клиента нет размера набора архива и его список не догружается вовсе
// (спека, «Размер набора известен только для Всех чатов»).
func scopeDialogs(all []domain.Dialog, f domain.DialogFolder) []domain.Dialog {
	if f == domain.FolderGlobal {
		return all
	}
	want := f == domain.FolderArchive
	out := make([]domain.Dialog, 0, len(all))
	for _, d := range all {
		if d.Archived == want {
			out = append(out, d)
		}
	}
	return out
}
```

И первой строкой тела `sliceDialogPage`:

```go
	all = scopeDialogs(all, p.Folder)
	count := len(all)
```

- [ ] **Step 5: Прогнать тесты пакета**

Run: `cd backend && go test ./internal/usecase/chat/`
Expected: PASS (включая существующий `TestSliceDialogPage` — он ходит с
`domain.DialogPage{}`, то есть `FolderGlobal`).

- [ ] **Step 6: Проверить, что мутация краснит**

Временно заменить в `sliceDialogPage` первую строку на `all = all` (то есть снять фильтрацию),
прогнать `go test ./internal/usecase/chat/ -run TestSliceDialogPageFolder`, убедиться в FAIL,
вернуть строку. Реальный вывод привести в отчёте.

- [ ] **Step 7: Коммит**

```bash
cd backend && go vet ./... && gofmt -l .
git add internal/domain/chat.go internal/usecase/chat/dialogpage.go internal/usecase/chat/dialogpage_test.go
git commit -m "feat(dialogs): выборка реальной папки в странице диалогов"
```

---

### Task 2: `folder_id` в `GET /chats`

**Files:**
- Modify: `backend/internal/adapter/delivery/http/chat_handler.go:292-317` (`ListDialogs`)
- Test: `backend/internal/adapter/delivery/http/chat_handler_test.go`

**Interfaces:**
- Consumes: `domain.DialogFolder`/`domain.FolderAll`/`domain.FolderArchive`, поле
  `domain.DialogPage.Folder` (Task 1); `queryInt(r *http.Request, key string, def int64) int64`
  (`chat_handler.go:2130`).
- Produces: HTTP-контракт `GET /chats?limit=&offset_chat_id=&folder_id=`, где `folder_id=0` —
  всё кроме архива, `folder_id=1` — архив, параметр отсутствует — весь набор.

- [ ] **Step 1: Написать падающий тест**

Дописать в `backend/internal/adapter/delivery/http/chat_handler_test.go` (сетап взять у
существующего теста `ListDialogs` в этом же файле — свой не изобретать; фикстуру дополнить
архивным диалогом):

```go
// folder_id режет выборку на бэкенде: без него клиент не знает размера набора
// архива и его виртуальный список не создаёт дырок, то есть не догружается.
func TestListDialogsFolderID(t *testing.T) {
	// ... сетап хендлера и фикстуры — как в существующем тесте ListDialogs,
	// с диалогами: 2 обычных и 1 архивный.

	t.Run("folder_id=1 — только архив и его count", func(t *testing.T) {
		rr := doGet(t, h, "/chats?folder_id=1")
		var body struct {
			Chats []map[string]any `json:"chats"`
			Count int              `json:"count"`
			IsEnd bool             `json:"is_end"`
		}
		decode(t, rr, &body)
		if len(body.Chats) != 1 || body.Count != 1 || !body.IsEnd {
			t.Fatalf("chats=%d count=%d isEnd=%v, want 1 1 true", len(body.Chats), body.Count, body.IsEnd)
		}
		if body.Chats[0]["archived"] != true {
			t.Fatalf("отдан не архивный диалог: %v", body.Chats[0])
		}
	})

	t.Run("folder_id=0 — всё, кроме архива", func(t *testing.T) {
		rr := doGet(t, h, "/chats?folder_id=0")
		var body struct {
			Chats []map[string]any `json:"chats"`
			Count int              `json:"count"`
		}
		decode(t, rr, &body)
		if len(body.Chats) != 2 || body.Count != 2 {
			t.Fatalf("chats=%d count=%d, want 2 2", len(body.Chats), body.Count)
		}
	})

	// Отсутствие параметра — прежний контракт: весь набор. Мутация «по
	// умолчанию FolderAll» краснит здесь.
	t.Run("без folder_id — весь набор", func(t *testing.T) {
		rr := doGet(t, h, "/chats")
		var body struct {
			Count int `json:"count"`
		}
		decode(t, rr, &body)
		if body.Count != 3 {
			t.Fatalf("count=%d, want 3", body.Count)
		}
	})
}
```

Хелперы `doGet`/`decode` — те, что уже есть в файле; если их нет, использовать приём соседнего
теста (`httptest.NewRequest` + `httptest.NewRecorder` + `json.Unmarshal`), нового сетапа не заводить.

- [ ] **Step 2: Прогнать тест — убедиться, что он падает**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run TestListDialogsFolderID`
Expected: FAIL — `folder_id=1` отдаёт 3 диалога и `count=3`.

- [ ] **Step 3: Разбор параметра в хендлере**

В `chat_handler.go` заменить докблок и тело сборки `page` в `ListDialogs`:

```go
// ListDialogs — GET /chats?limit=&offset_chat_id=&folder_id=: без параметров
// отдаёт весь список (обратная совместимость), с ними — страницу по курсору
// chat_id внутри реальной папки.
func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 0)
	if limit < 0 {
		// Отрицательный limit — не 400: клиента с таким запросом нет,
		// тихая деградация к «весь список» безопаснее.
		limit = 0
	}
	page := domain.DialogPage{
		Limit:        int(limit),
		OffsetChatID: queryInt(r, "offset_chat_id", 0),
		Folder:       dialogFolder(r),
	}
```

Рядом с `dialogRow` добавить:

```go
// dialogFolder — реальная папка из query. Значения на проводе — как у tweb
// (FOLDER_ID_ALL=0, FOLDER_ID_ARCHIVE=1); отсутствие параметра и любое другое
// значение означают «весь набор»: это прежнее поведение эндпоинта, и деградация
// к нему безопаснее 400 — клиент с неизвестным номером папки увидит больше
// диалогов, а не пустой список.
func dialogFolder(r *http.Request) domain.DialogFolder {
	switch queryInt(r, "folder_id", -1) {
	case 0:
		return domain.FolderAll
	case 1:
		return domain.FolderArchive
	default:
		return domain.FolderGlobal
	}
}
```

- [ ] **Step 4: Прогнать тесты пакета**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run TestListDialogs`
Expected: PASS — и новый тест, и существующий.

- [ ] **Step 5: Проверить, что мутация краснит**

Временно вернуть `Folder: domain.FolderGlobal` вместо `dialogFolder(r)`, прогнать
`go test ./internal/adapter/delivery/http/ -run TestListDialogsFolderID`, убедиться в FAIL,
вернуть. Реальный вывод привести в отчёте.

- [ ] **Step 6: Коммит**

```bash
cd backend && go vet ./... && gofmt -l . && go test ./internal/...
git add internal/adapter/delivery/http/chat_handler.go internal/adapter/delivery/http/chat_handler_test.go
git commit -m "feat(dialogs): GET /chats принимает folder_id реальной папки"
```

---

### Task 3: Счётчик и «загружено целиком» — по выборке

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts` (объявления `loadedAll`/`serverCount`
  на строках 119-128, `countFor` на 369-384, использования в `fetchPage`/`doRefresh`/`getDialogs`,
  сброс в `resetForLogout` на 714-715)
- Test: `web-client/src/core/managers/dialogsManager.pagination.test.ts`

**Interfaces:**
- Consumes: `ALL_FOLDER_ID`, `ARCHIVE_FOLDER_ID` (`core/folderIds.ts`); `forFilter(filterId): DialogItem[] | null`.
- Produces (внутри модуля, наружу не экспортируется): `type Scope = 'global' | 'all' | 'archive'`,
  `scopeFor(filterId: number): Scope`, `WIRE_FOLDER: Record<Scope, number | undefined>`,
  `isLoaded(scope: Scope): boolean`, `setLoaded(scope: Scope): void`,
  `serverCount: Record<Scope, number | null>`. Внешний контракт `getDialogs` не меняется.

- [ ] **Step 1: Написать падающий тест**

Дописать в `dialogsManager.pagination.test.ts`:

```ts
describe('размер набора по выборке (порт dialogs.ts:1706,1728)', () => {
  // Пользовательская папка серверного набора не имеет: её размер — ЗАВЫШЕННАЯ
  // глобальная оценка (tweb dialogs.ts:1728), и именно она даёт дырку.
  it('пользовательская папка берёт глобальный count', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    mgr.setContactIds([])
    mgr.setFolders([folder({ id: 7, groups: true })])

    const page = await mgr.getDialogs({ limit: 1, filterId: 7 })
    expect(page.count).toBe(40)
  })

})
```

Сценарии, различающие выборки по `folder_id` (счётчик архива, решётка загруженности), в этой
задаче поставить НЕЛЬЗЯ: запрос ещё уходит без папки, и обе выборки неотличимы. Они целиком
принадлежат Task 4 — отключённых тестов здесь не оставлять.

Если у менеджера нет метода `setFolders`, использовать тот, которым папки заводятся сегодня
(искать по `folders =` в `dialogsManager.ts`), — нового API не вводить.

- [ ] **Step 2: Прогнать тест — убедиться, что он падает**

Run: `cd web-client && npx vitest run src/core/managers/dialogsManager.pagination.test.ts -t 'размер набора по выборке'`
Expected: FAIL — `page.count` равен длине кэша (1), а не 9/40.

- [ ] **Step 3: Ввести выборку и решётку загруженности**

Заменить в `dialogsManager.ts` объявления `loadedAll` (строки 119-125) и `serverCount` (126-128) на:

```ts
  /**
   * Выборка запроса — порт tweb `realFolderId` (dialogs.ts:1646-1649).
   * Реальных папок на сервере две, «все чаты» и «архив»; пользовательская
   * папка — клиентский фильтр, её страницы вычерпывают ГЛОБАЛЬНЫЙ набор.
   */
  type Scope = 'global' | 'all' | 'archive'
  const scopeFor = (filterId: number): Scope =>
    filterId === ALL_FOLDER_ID ? 'all' : filterId === ARCHIVE_FOLDER_ID ? 'archive' : 'global'
  /** Номер папки НА ПРОВОДЕ — значения tweb FOLDER_ID_ALL/FOLDER_ID_ARCHIVE
   *  (constants.ts:37-38), а не наши ALL_FOLDER_ID/ARCHIVE_FOLDER_ID: у нас
   *  архив это -1 (Postgres раздаёт id папок с единицы), на проводе — 1. */
  const WIRE_FOLDER: Record<Scope, number | undefined> = { global: undefined, all: 0, archive: 1 }

  /**
   * Выборка загружена ЦЕЛИКОМ — порт `allDialogsLoaded` (dialogs.ts:272-299).
   * Хранятся только две реальные папки, глобальная выводится: у tweb под неё
   * есть отдельное поле, поддерживаемое в согласии с двумя реальными, — то же
   * значение, лишнее состояние (спека, «Отступления» №2).
   */
  const dialogsLoaded: Record<'all' | 'archive', boolean> = { all: false, archive: false }
  const isLoaded = (scope: Scope): boolean =>
    scope === 'global' ? dialogsLoaded.all && dialogsLoaded.archive : dialogsLoaded[scope]
  /** Порт `setDialogsLoaded` (dialogs.ts:276-288): GLOBAL поднимает обе реальные. */
  function setLoaded(scope: Scope): void {
    if (scope === 'global') { dialogsLoaded.all = true; dialogsLoaded.archive = true }
    else dialogsLoaded[scope] = true
  }

  /** `count` последнего сетевого ответа ПО ВЫБОРКЕ (аналог tweb
   *  `getFolder(filterId).count`); `null` — этой выборки сеть ещё не видела. */
  const serverCount: Record<Scope, number | null> = { global: null, all: null, archive: null }
```

- [ ] **Step 4: Переписать `countFor`**

Заменить тело и докблок `countFor` (строки 369-384):

```ts
  /**
   * Размер набора для страницы — порт `count: loadedAll ? curDialogStorage.length
   * : this.getFolder(filterId).count` (dialogs.ts:1706).
   *
   * Выборка загружена целиком — размер это длина кэша. Иначе берём серверный
   * `count` СВОЕЙ выборки, а если её сеть ещё не видела — глобальный: это
   * ЗАВЫШЕННАЯ оценка, и она здесь не компромисс, а механизм. Размер набора
   * рождает дырку в виртуальном списке, дырка дёргает `requestItemForIdx`, и
   * только он запускает догрузку; равный длине кэша размер дырок не даёт
   * никогда, и список не наполняется вовсе. Пользовательская папка живёт на
   * этой оценке постоянно — ровно как в оригинале, где `folder.count` фильтра
   * присваивается из ответа по ГЛОБАЛЬНОЙ папке (dialogs.ts:1728).
   */
  function countFor(filterId: number, cached: readonly DialogItem[]): number {
    const scope = scopeFor(filterId)
    if (isLoaded(scope)) return cached.length
    return serverCount[scope] ?? serverCount.global ?? cached.length
  }
```

- [ ] **Step 5: Перевести существующие использования**

В `fetchPage`, `doRefresh`, `getDialogs` и `resetForLogout` заменить скалярные `loadedAll`/
`serverCount` на выборочные. В этой задаче — минимально, через глобальную выборку (папку в запрос
добавляет Task 4):

- `fetchPage`: `if (typeof r.count === 'number') serverCount.global = r.count`;
  `if (isEnd && (!offsetChatId || items.length >= (serverCount.global ?? Infinity))) setLoaded('global')`
- `doRefresh`: `if (r.is_end) setLoaded('global')`
- `getDialogs`: `loadedAll` → `isLoaded(scopeFor(filterId))` во всех трёх местах
  (условие ветки кэша, `isEnd` ветки кэша, `isEnd` сетевой ветки)
- `resetForLogout`: вместо `loadedAll = false; serverCount = null`:

```ts
      dialogsLoaded.all = false
      dialogsLoaded.archive = false
      serverCount.global = serverCount.all = serverCount.archive = null
```

- [ ] **Step 6: Прогнать тесты и типы**

Run: `cd web-client && npx vitest run src/core/managers/ && npm run typecheck`
Expected: PASS — весь прогон пакета, включая новый describe. Отключённых (`it.skip`) тестов
после задачи остаться не должно.

- [ ] **Step 7: Коммит**

```bash
cd web-client && npm run typecheck && npx vitest run src/core/managers/
git add src/core/managers/dialogsManager.ts src/core/managers/dialogsManager.pagination.test.ts
git commit -m "feat(dialogs): счётчик набора и loadedAll по выборке (порт allDialogsLoaded)"
```

---

### Task 4: Страница уходит в свою выборку

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts` (`fetchPage` на строках 434-466,
  вызов и фолбэк залипшего курсора в `getDialogs` на 591-611)
- Test: `web-client/src/core/managers/dialogsManager.pagination.test.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeFor`, `WIRE_FOLDER`, `isLoaded`, `setLoaded`, `serverCount` (Task 3);
  `forFilter(filterId): DialogItem[] | null`; `mergePage(dialogs: Dialog[]): number`.
- Produces: новая сигнатура `fetchPage(filterId: number, limit: number, useCursor?: boolean):
  Promise<{ isEnd: boolean; added: number } | null>` — курсор и папку она вычисляет сама.

- [ ] **Step 1: Написать падающий тест**

Дописать в тот же describe «размер набора по выборке», который завела Task 3:

```ts
  // Архив без собственного счётчика не создаёт дырок, а без дырок
  // requestItemForIdx не зовётся никогда — список не догружается вовсе.
  it('архив берёт count своей выборки, а не длину загруженного', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q?: Record<string, string | number>) =>
        q?.folder_id === 1
          ? { chats: [raw(1, 1, { archived: true })], count: 9, is_end: false }
          : { chats: [raw(2, 2)], count: 40, is_end: false }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 1, filterId: ARCHIVE_FOLDER_ID })
    expect(page.count).toBe(9)
  })

  // Решётка setDialogsLoaded (dialogs.ts:276-299): обе реальные загружены —
  // загружен и глобальный набор, значит папка отвечает из памяти.
  it('загруженные ALL и ARCHIVE делают загруженным глобальный набор', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q?: Record<string, string | number>) =>
        q?.folder_id === 1
          ? { chats: [raw(1, 1, { archived: true })], count: 1, is_end: true }
          : { chats: [raw(2, 2)], count: 1, is_end: true }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    mgr.setContactIds([])
    mgr.setFolders([folder({ id: 7, groups: true })])

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })
    await mgr.getDialogs({ limit: 5 })
    rest.get.mockClear()

    const page = await mgr.getDialogs({ limit: 5, filterId: 7 })
    expect(rest.get).not.toHaveBeenCalled()
    expect(page.isEnd).toBe(true)
  })

  it('страница архива уходит с folder_id=1 и курсором из архивной выборки', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(5, 5, { archived: true })], count: 9, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(1, 1, { archived: true }), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })

    // Курсор — хвост АРХИВНОЙ выборки (chat_id 1), а не всего кэша (2):
    // бэкенд ищет offset_chat_id внутри выборки и чужой id трактует как
    // «с начала» (dialogpage.go), то есть страница повторилась бы вечно.
    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ folder_id: 1, offset_chat_id: 1 }))
  })

  it('страница пользовательской папки уходит БЕЗ folder_id (глобальный набор)', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(5, 5)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    mgr.setContactIds([])
    mgr.setFolders([folder({ id: 7, groups: true })])

    await mgr.getDialogs({ limit: 5, filterId: 7 })

    const q = rest.get.mock.calls[0][1] as Record<string, unknown>
    expect(q.folder_id).toBeUndefined()
  })

  // is_end архивной страницы не имеет права объявить загруженным весь набор.
  it('is_end архивной страницы не поднимает загруженность «Всех чатов»', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(5, 5, { archived: true })], count: 1, is_end: true })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })
    rest.get.mockClear()
    await mgr.getDialogs({ limit: 5 }) // «Все чаты» — обязаны пойти в сеть

    expect(rest.get).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Прогнать тест — убедиться, что он падает**

Run: `cd web-client && npx vitest run src/core/managers/dialogsManager.pagination.test.ts -t 'размер набора по выборке'`
Expected: FAIL — запрос уходит без `folder_id`, с курсором `2`.

- [ ] **Step 3: Переписать `fetchPage`**

```ts
  /**
   * Сетевая страница — порт `appMessagesManager.getTopMessages` из ветки
   * догрузки (dialogs.ts:1712-1717). Курсор к серверу — `chatId` последнего
   * элемента ТОЙ ЖЕ выборки, а не `offsetIndex`: у бэкенда своего понятия
   * `dialogIndex` нет (отступление №1 спеки этапа 2), а чат из другой папки он
   * внутри выборки не нашёл бы и отдал страницу с начала (`dialogpage.go`).
   *
   * `useCursor === false` — страница НАМЕРЕННО без курсора (фолбэк залипшего
   * курсора, см. `getDialogs`). `null` — ответ применять нельзя (офлайн либо
   * сменившаяся сессия).
   */
  async function fetchPage(filterId: number, limit: number, useCursor = true): Promise<{ isEnd: boolean; added: number } | null> {
    const gen = sessionGen
    const scope = scopeFor(filterId)
    // Пользовательская папка вычерпывает глобальный набор (tweb: realFolderId
    // = GLOBAL для фильтра), поэтому её курсор — хвост всего кэша.
    const cursorList = scope === 'global' ? items : (forFilter(filterId) ?? [])
    const offsetChatId = useCursor && cursorList.length ? cursorList[cursorList.length - 1].dialog.chatId : 0
    const wire = WIRE_FOLDER[scope]
    const query: Record<string, string | number> = { limit, offset_chat_id: offsetChatId }
    if (wire !== undefined) query.folder_id = wire
    try {
      const r = await rest.get<ChatsResponse>('/chats', query)
      const dialogs = (r.chats ?? []).map(mapDialog)
      await decryptSecretPreviews(dialogs)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount[scope] = r.count
      const isEnd = !!r.is_end
      const added = mergePage(dialogs)
      // Полной выборка считается, когда конец ДОСТИГНУТ и мы держим её
      // ЦЕЛИКОМ: либо страница шла без курсора (значит покрыла выборку от
      // начала), либо кэш выборки дорос до серверного `count`. Порт tweb: там
      // `dialogsLoaded` поднимает любая дошедшая до конца страница
      // (appMessagesManager.ts:3639), потому что страницы идут строго сверху;
      // у нас курсор — `chatId`, и при исчезнувшем опорном чате бэкенд отдаёт
      // с начала (`dialogpage.go`), поэтому одного `is_end` мало — сверяем с
      // размером выборки, как это же делает tweb в `dialogsLength >= count`.
      const held = scope === 'global' ? items.length : (forFilter(filterId) ?? []).length
      if (isEnd && (!offsetChatId || held >= (serverCount[scope] ?? Infinity))) setLoaded(scope)
      return { isEnd, added }
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null // офлайн — остаёмся на кэше, как в refresh()
    }
  }
```

- [ ] **Step 4: Перевести вызов и фолбэк в `getDialogs`**

Заменить блок вызова (строки 591-611):

```ts
      // Порт dialogs.ts:1712-1752 — одна страница из сети, затем пересчёт курсора.
      let res = await fetchPage(filterId, limit)
      // Гвард сессии здесь СОЗНАТЕЛЬНО НЕ ПОКРЫТ мутацией: `resetForLogout()`
      // синхронно опустошает `items`, а `fetchPage` под сменившимся поколением
      // ничего не сливает, поэтому нижняя ветка и так соберёт пустую страницу —
      // обе ветки дают один результат. Гвард держит инвариант «ответ прошлой
      // сессии не собирается из кэша НОВОЙ» (регидратация могла успеть
      // наполнить `items` между сбросом и этой строкой) и обязан пережить
      // появление такой регидратации.
      if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      // Страница по курсору не принесла НИ ОДНОГО нового диалога и концом
      // выборки себя не объявила — курсор залип: опорный чат на сервере исчез,
      // и бэкенд отдаёт с начала (`dialogpage.go`), а хвост кэша не сдвинулся,
      // значит следующий запрос уйдёт с ТЕМ ЖЕ `offset_chat_id` — список не
      // продвинулся бы никогда. Выход — одна страница БЕЗ курсора, заведомо
      // накрывающая удерживаемое окно целиком: она и пересобирает голову, и
      // приносит хвост. Полным `refresh()` это лечить больше нельзя — он
      // ограничен тем же удерживаемым окном (Task 5) и списка не продвигает.
      if (res && !res.isEnd && !res.added) {
        res = await fetchPage(filterId, cached.length + limit, false)
        if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      }
```

- [ ] **Step 5: Прогнать тесты и типы**

Run: `cd web-client && npx vitest run src/core/managers/ && npm run typecheck`
Expected: PASS, включая тесты залипшего курсора из этапа 2 (они проверяют выход из цикла, а не
конкретно `refresh()`; если тест пинит именно вызов `refresh()` — переписать его на новое
поведение, сценарий сохранив).

- [ ] **Step 6: Проверить, что мутации краснят**

По очереди: (а) убрать `query.folder_id = wire`; (б) заменить `cursorList` на `items` безусловно;
(в) заменить `setLoaded(scope)` на `setLoaded('global')`. Каждая обязана дать красный тест.
Реальный вывод vitest привести в отчёте; непокрытую мутацию — либо покрыть, либо пометить у строки.

- [ ] **Step 7: Коммит**

```bash
cd web-client && npm run typecheck && npx vitest run src/core/managers/
git add src/core/managers/dialogsManager.ts src/core/managers/dialogsManager.pagination.test.ts
git commit -m "feat(dialogs): страница уходит в свою реальную папку со своим курсором"
```

---

### Task 5: `refresh()` перечитывает удерживаемое окно

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts` (`doRefresh` на строках 468-500)
- Modify: `web-client/src/client/boot.ts:70-92` (докблок `applyDialogsMirror` — снять описание
  полной загрузки)
- Test: `web-client/src/core/managers/dialogsManager.pagination.test.ts`
- Test: `web-client/src/client/boot.fullList.test.tsx` (переписать сценарии)

**Interfaces:**
- Consumes: `DIALOG_LOAD_COUNT` (`core/dialogs/loadCount.ts`); `setLoaded`, `serverCount`, `Scope` (Task 3).
- Produces: `refresh()` сохраняет сигнатуру `() => Promise<DialogOp | null>`; меняется только
  объём запроса.

- [ ] **Step 1: Написать падающий тест**

```ts
describe('refresh перечитывает удерживаемое окно, а не весь список', () => {
  // Холодный старт: держим ноль — просим первую страницу. Без этого boot
  // тянет всю ленту диалогов одним ответом и глушит пагинацию на весь сеанс.
  it('на пустом кэше просит одну страницу', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ limit: DIALOG_LOAD_COUNT }))
  })

  it('на прогретом кэше просит ровно столько, сколько держит', async () => {
    const cached = Array.from({ length: 37 }, (_, i) => dialog(i + 1, 1))
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => cached,
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ limit: 37 }))
  })

  // Ответ без is_end больше не считается полным набором — иначе первый же из
  // девятнадцати колсайтов refresh() глушил бы догрузку до конца сеанса.
  it('ответ без is_end не объявляет набор загруженным', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()
    rest.get.mockClear()
    await mgr.getDialogs({ limit: 5 })

    expect(rest.get).toHaveBeenCalled()
  })
})
```

Импорт `DIALOG_LOAD_COUNT` из `../dialogs/loadCount` добавить в шапку файла.

- [ ] **Step 2: Прогнать тест — убедиться, что он падает**

Run: `cd web-client && npx vitest run src/core/managers/dialogsManager.pagination.test.ts -t 'удерживаемое окно'`
Expected: FAIL — `rest.get` зовётся с одним аргументом (`'/chats'`), без query.

- [ ] **Step 3: Ограничить `doRefresh`**

```ts
  /**
   * Тело `refresh()` отдельной функцией: его зовёт не только RPC-метод, но и
   * `getDialogs` — фолбэком (см. там же). Ссылаться из объекта на его
   * собственный метод (`this`/замыкание на литерал) владелец не может: он
   * раздаётся по RPC поштучно, `this` на той стороне не существует.
   *
   * Перечитывает РОВНО удерживаемое окно, а не весь список. Три следствия, и
   * все три — цель правки (спека, «`refresh()` тянет весь список»):
   *  - холодный старт держит ноль, значит просит одну страницу: `boot.ts`
   *    становится страничным сам по себе, без правок в нём;
   *  - все девятнадцать колсайтов остаются верными — они получают свежий вид
   *    того же окна, и `setAll` над ним корректен: это набор той же мощности в
   *    том же серверном порядке (выпавший диалог заменяется тем, что поднялся
   *    на его место, а не оставляет дыру);
   *  - `loadedAll` поднимается только по `is_end`, то есть когда окно
   *    действительно накрыло набор, — раньше безлимитный запрос поднимал его
   *    ВСЕГДА и глушил догрузку до конца сеанса.
   *
   * Выборка — глобальная: `refresh()` обслуживает кэш целиком, а не папку.
   */
  async function doRefresh(): Promise<DialogOp | null> {
    const gen = sessionGen
    await hydrate()
    const limit = Math.max(items.length, DIALOG_LOAD_COUNT)
    try {
      const r = await rest.get<ChatsResponse>('/chats', { limit })
      const dialogs = (r.chats ?? []).map(mapDialog)
      await decryptSecretPreviews(dialogs)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount.global = r.count
      // Запрос идёт БЕЗ курсора, поэтому `is_end` означает «окно накрыло набор
      // от начала», то есть кэш держит его целиком.
      if (r.is_end) setLoaded('global')
      const op = setAll(dialogs)
      // Ответ совпал с памятью — ни операции, ни записи на диск (Important #4).
      if (op) publish([op])
      return op
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null
    }
  }
```

Добавить импорт: `import { DIALOG_LOAD_COUNT } from '../dialogs/loadCount'`.

- [ ] **Step 4: Снять описание полной загрузки в `boot.ts`**

В докблоке `applyDialogsMirror` (`web-client/src/client/boot.ts`) удалить абзацы про обязательную
полную первичную загрузку и заменить на:

```
 * Первичная сетевая загрузка — `refresh()`, и она страничная: на пустом кэше
 * владелец просит одну страницу (`dialogsManager.ts::doRefresh`). Дальше список
 * догружает сам сайдбар через `getDialogs` + `helpers/sequentialCursorFetcher`,
 * опираясь на размер набора своей выборки (`countFor`).
```

- [ ] **Step 5: Переписать `boot.fullList.test.tsx`**

Файл пинит отменяемое поведение («первичная загрузка полная»). Сценарии сохранить, ожидания
инвертировать: первичный `refresh()` уходит с `limit`, строка «Архив» присутствует, папки не
усечены. Файл переименовать в `boot.firstPage.test.tsx` (`git mv`), докблок переписать под новую
модель со ссылкой на эту спеку.

- [ ] **Step 6: Прогнать весь фронтовый прогон**

Run: `cd web-client && npm run typecheck && npm test`
Expected: PASS. Тесты, падающие из-за `rest.get('/chats')` без query, — чинить по существу
(ожидание query), а не ослаблением проверки.

- [ ] **Step 7: Проверить, что мутация краснит**

Заменить `Math.max(items.length, DIALOG_LOAD_COUNT)` на `0`, прогнать
`npx vitest run src/core/managers/dialogsManager.pagination.test.ts`, убедиться в FAIL, вернуть.
Реальный вывод привести в отчёте.

- [ ] **Step 8: Коммит**

```bash
cd web-client && npm run typecheck && npm test
git add src/core/managers/dialogsManager.ts src/core/managers/dialogsManager.pagination.test.ts src/client/boot.ts src/client/boot.firstPage.test.tsx
git commit -m "feat(dialogs): refresh перечитывает удерживаемое окно, первичная загрузка страничная"
```

---

### Task 6: Проверка на стенде и запись в память

**Files:**
- Modify: `/Users/denisurevic/.claude/projects/-Users-denisurevic-Documents-messenger-denis/memory/dialogs-virtual-list-program.md`

**Interfaces:**
- Consumes: всё, что собрано в Task 1-5.
- Produces: отчёт о проверке; долг «пагинация фактически мертва» из памяти снимается либо
  переформулируется по факту увиденного.

- [ ] **Step 1: Поднять стенд**

```bash
cd web-client && npx vite build --outDir ../client-build
cd .. && docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend
```

- [ ] **Step 2: Проверить пагинацию «Всех чатов»**

Открыть `https://localhost:38443/`, в DevTools-сети убедиться: первый `/chats` уходит с `limit=20`;
при прокрутке списка уходят следующие страницы с растущим `offset_chat_id`; строки не остаются
скелетонами. Приложить скриншот.

- [ ] **Step 3: Проверить архив**

Открыть оверлей архива. Убедиться: запрос уходит с `folder_id=1`; высота скроллбара после первой
страницы соответствует числу архивных чатов (не общему); строка «Архив» в сайдбаре присутствует.

- [ ] **Step 4: Проверить пользовательскую папку**

Переключиться на папку с числом чатов больше страницы, прокрутить до конца — список обязан
наполниться полностью. Проверить, что каждая папка сохраняет свой `scrollTop` при переключении.

- [ ] **Step 5: Обновить память**

В `dialogs-virtual-list-program.md` заменить абзац «Главный открытый долг — пагинация фактически
мертва» на фактическое состояние. Явно записать отменённую гипотезу: счётчик по пользовательской
папке на бэкенде НЕ нужен, у tweb его тоже нет (`dialogs.ts:1646-1649`, `:1728`). Обновить строку
про непроверенный стенд.

- [ ] **Step 6: Коммит**

```bash
git add docs/superpowers/specs/2026-08-13-dialogs-count-and-refresh-design.md docs/superpowers/plans/2026-08-13-dialogs-count-and-refresh.md
git commit -m "docs(dialogs): спека и план оживления пагинации"
```

---

## Самопроверка плана

**Покрытие спеки.** Бэкендовая выборка — Task 1-2; счётчик и решётка загруженности по выборке —
Task 3; курсор и `folder_id` в запросе страницы — Task 4; ограниченный `refresh()` и страничный
boot — Task 5; отступление №3 (новый фолбэк залипшего курсора) — Task 4, Step 4; критерии приёмки
со стенда — Task 6. Непокрытых требований спеки нет.

**Согласованность имён.** `domain.DialogFolder`/`FolderGlobal`/`FolderAll`/`FolderArchive` вводятся
в Task 1 и используются в Task 2 в тех же написаниях. `Scope`/`scopeFor`/`WIRE_FOLDER`/`isLoaded`/
`setLoaded`/`serverCount` вводятся в Task 3 и используются в Task 4-5 в тех же написаниях.
`fetchPage` меняет сигнатуру ровно один раз — в Task 4, и единственный её колсайт правится там же.

**Риск, который план не снимает.** `refresh()` с `limit = items.length` на аккаунте с очень
длинным прогретым списком стоит столько же, сколько сегодняшний безлимитный запрос. Это сознательно:
задача — убрать безусловную полную загрузку на старте и разблокировать догрузку, а не
переписать девятнадцать колсайтов на точечные обновления. Последнее — отдельная работа, и её
стоит завести в бэклоге после Task 6.

---

## Дополнение: вход в архив (решение человека, 2026-08-13)

Task 5 упёрлась в блокер, которого план не предвидел: **страничный `refresh()` делает архив
недостижимым**. Строка «Архив» гейтится составом зеркала (`ChatList.tsx`, `archived.length > 0`),
архивные диалоги в первую страницу глобальной выборки обычно не попадают, страницы «Всех чатов»
после Task 4 уходят с `folder_id=0` и архив не принесут никогда, а собственной пагинации у архива
нет — `ArchiveList` ходит с `NO_ITEM_REQUEST`, и `/chats?folder_id=1` из UI не запрашивается ни
разу. Нет строки ⇒ нет входа ⇒ нечем загрузить.

Это тот же блокер, из-за которого страничный старт откатывали коммитом `f2a89330`. Тогда причину
списали на отсутствие счётчика по папке — настоящая причина оказалась другой.

**Выбранное решение — портировать вход в архив из tweb целиком**, вместе с ограниченным
`refresh()`, одной задачей (иначе ветка между двумя коммитами заведомо красная):

1. **Гейт входа — по загруженности, а не по составу.** tweb показывает вход в архив, пока
   `!isDialogsLoaded(FOLDER_ID_ARCHIVE)` (`sidebarLeft/index.ts:653-655`): пока про архив
   неизвестно, вход показывается, и только достоверно пустой архив его убирает. У нас признак
   живёт во владельце (`isLoaded('archive')`) и обязан доехать до витрины **объявлением владельца**,
   а не выводом на главном потоке — правило «владение фактами» (`web-client/CLAUDE.md`). Если
   способ доставки неочевиден — спросить, а не изобретать второй источник факта.
2. **Архив листается сам.** `ArchiveList` переводится с `NO_ITEM_REQUEST` на собственный курсор и
   `requestItemForIdx` — порт `archivedTab.tsx:19,80-96`. Инфраструктура уже есть:
   `useDialogListSource(ARCHIVE_FOLDER_ID, chats)` + `getDialogs({filterId: ARCHIVE_FOLDER_ID})`
   владельца, который после Task 4 уходит с `folder_id=1` и приносит настоящий `count` архива.

Критерии приёмки дополнения: на холодном старте со страничным `refresh()` строка «Архив»
присутствует независимо от того, попали ли архивные чаты в первую страницу; открытый архив
догружается прокруткой; `boot.firstPage.test.tsx` зелёный без ослабления сценариев.
