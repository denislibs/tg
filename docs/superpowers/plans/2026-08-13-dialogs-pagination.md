# Пагинация диалогов — план реализации (этап 2)

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги — чекбоксами (`- [ ]`).

**Цель:** дать виртуальному списку контракт `{dialogs, count, isEnd}` с курсором —
на бэкенде (`GET /chats`) и во владельце списка (`dialogsManager.getDialogs`).

**Архитектура:** бэкенд материализует полный упорядоченный список (как сейчас,
через Redis-кэш) и нарезает страницу по курсору `offset_chat_id`; воркер
портирует `dialogsStorage.getDialogs` tweb 1:1 — отдаёт из кэша, в сеть идёт
только при нехватке, сливает страницу операцией `upsert`.

**Стек:** Go 1.25 / chi / pgx (бэк); TypeScript strict / vitest (фронт).

**Спека:** `docs/superpowers/specs/2026-08-13-dialogs-pagination-design.md` —
читать перед началом, в ней зафиксированы отступления от tweb и их причины.

## Global Constraints

- **Отвечать по-русски**, комментарии в коде — по-русски.
- **Референс — tweb** (`/Users/denisurevic/Documents/tweb`). Логику брать 1:1;
  ссылка на файл:строку оригинала — комментарием у порта.
- **Мёртвый код удалять** агрессивно: заглушек и неиспользуемых веток не оставлять.
- **Норма тестов:** строка проводки без теста, чья мутация краснеет, — нарушение.
  Проверять это буквально: временно сломать строку, убедиться, что тест краснеет,
  вернуть. Тест, который не краснеет ни на одной мутации, — не тест.
- **Обратная совместимость `GET /chats`:** без query-параметров ответ обязан
  содержать тот же массив `chats` в том же порядке, что и сейчас.
- **Курсор — `offset_chat_id`** (не offset, не date). Значение `0` — с начала.
- **`limit = 0` или отсутствует** — весь список, `is_end: true`.
- **Известный красный тест до наших правок:** `TestWS_RevokeClosesSocket` в
  `backend/internal/adapter/delivery/ws` падает на чистом `main`. Не чинить, не
  считать своей регрессией, но и не маскировать.
- Рабочая директория — worktree
  `/Users/denisurevic/Documents/messenger-denis/.claude/worktrees/dialogs-virtual-list`.
  Все пути ниже — от неё.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/internal/domain/chat.go` | + `DialogPage`, `DialogPageResult` |
| `backend/internal/usecase/chat/dialogpage.go` | **создать** — чистая `sliceDialogPage` |
| `backend/internal/usecase/chat/dialogpage_test.go` | **создать** — таблица кейсов нарезки |
| `backend/internal/usecase/chat/chat.go` | + `ListDialogsPage` поверх `ListDialogs` |
| `backend/internal/adapter/repo/postgres/chatsrepo.go` | тайбрейк `c.id DESC` в `ORDER BY` |
| `backend/internal/adapter/delivery/http/chat_handler.go` | парс `limit`/`offset_chat_id`, ответ `{chats,count,is_end}` |
| `web-client/src/helpers/sequentialCursorFetcher.ts` | **создать** — вендор tweb 1:1 |
| `web-client/src/core/folderFilter.ts` | `matchesFolder` на структурном типе |
| `web-client/src/core/managers/dialogsManager.ts` | `getDialogs`, `fetchPage`, слияние `upsert`, `setContactIds`, зеркало `folders` |

---

### Task 1: детерминированный порядок выдачи чатов

**Файлы:**
- Modify: `backend/internal/adapter/repo/postgres/chatsrepo.go:225-227`
- Test: `backend/internal/adapter/repo/postgres/chatrepos_test.go`

**Интерфейсы:**
- Consumes: ничего.
- Produces: гарантия — `ListDialogs` возвращает строгий тотальный порядок
  `(pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, c.id DESC)`.
  На неё опираются Task 2 (курсор) и Task 3.

**Почему:** без третьего ключа порядок двух диалогов с одинаковым
`lm.created_at` (или двух без сообщений — у обоих `NULL`) не определён, и
страница по курсору невоспроизводима между запросами.

- [ ] **Шаг 1: написать падающий тест**

В `chatrepos_test.go` рядом с `TestChatsRepo_ListDialogs`:

```go
// Порядок выдачи обязан быть строго тотальным: без тайбрейка по c.id два
// диалога без сообщений (lm.created_at = NULL у обоих) сортируются
// произвольно, и курсор пагинации по такому порядку невоспроизводим.
func TestChatsRepo_ListDialogs_StableOrderWithoutMessages(t *testing.T) {
	ctx := context.Background()
	pool := storepostgres.NewTestDB(t)
	repo := postgres.NewChatsRepo(pool)

	me := seedUser(t, ctx, pool)
	// три пустых приватных чата — у всех lm.created_at IS NULL
	for i := 0; i < 3; i++ {
		other := seedUser(t, ctx, pool)
		createPrivate(t, ctx, pool, me, other)
	}

	first, err := repo.ListDialogs(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 3 {
		t.Fatalf("want 3 dialogs, got %d", len(first))
	}
	ids := make([]int64, len(first))
	for i, d := range first {
		ids[i] = d.ChatID
	}
	// по убыванию c.id
	for i := 1; i < len(ids); i++ {
		if ids[i-1] <= ids[i] {
			t.Fatalf("order is not by chat id desc: %v", ids)
		}
	}
	// и повторный запрос даёт ровно тот же порядок
	for attempt := 0; attempt < 3; attempt++ {
		again, err := repo.ListDialogs(ctx, me)
		if err != nil {
			t.Fatal(err)
		}
		for i := range again {
			if again[i].ChatID != ids[i] {
				t.Fatalf("attempt %d: order changed: %v vs %v", attempt, again, ids)
			}
		}
	}
}
```

Сигнатуры хелперов `seedUser`/`createPrivate` и импорты — посмотреть в начале
`chatrepos_test.go` и использовать те, что там уже есть (не заводить свои).

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
cd backend && go test ./internal/adapter/repo/postgres/ -run TestChatsRepo_ListDialogs_StableOrderWithoutMessages -v
```
Ожидание: FAIL на «order is not by chat id desc» (порядок произвольный).
Если тест ПРОШЁЛ с первого раза — значит Postgres случайно вернул нужный
порядок; прогнать `-count=5`, и если всё равно зелено, усилить тест
(больше чатов), пока мутация не станет видимой. Зелёный тест до правки —
не повод пропустить шаг.

- [ ] **Шаг 3: добавить тайбрейк**

`chatsrepo.go`, конец SQL в `ListDialogs`:

```sql
 -- закреплённые сверху (свежий пин — первым), затем по дате последнего
 -- сообщения; c.id — тайбрейк, без него порядок при равных ключах не
 -- определён и курсор пагинации невоспроизводим (см. спеку этапа 2)
 ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, c.id DESC
```

- [ ] **Шаг 4: тесты зелёные**

```bash
cd backend && go test ./internal/adapter/repo/postgres/ ./internal/usecase/chat/ ./internal/adapter/delivery/http/
```

- [ ] **Шаг 5: коммит**

```bash
git add backend/internal/adapter/repo/postgres/
git commit -m "fix(chats): тайбрейк по c.id в порядке выдачи диалогов"
```

---

### Task 2: нарезка страницы — домен и usecase

**Файлы:**
- Modify: `backend/internal/domain/chat.go`
- Create: `backend/internal/usecase/chat/dialogpage.go`
- Create: `backend/internal/usecase/chat/dialogpage_test.go`
- Modify: `backend/internal/usecase/chat/chat.go` (рядом с `ListDialogs`, ~:287-344)

**Интерфейсы:**
- Consumes: `ChatRepo.ListDialogs(ctx, userID) ([]domain.Dialog, error)`,
  `DialogsCache.Get/Set` — уже есть, не менять.
- Produces:
  ```go
  type DialogPage struct { Limit int; OffsetChatID int64 }
  type DialogPageResult struct { Dialogs []Dialog; Count int; IsEnd bool }
  func sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult
  func (i *Interactor) ListDialogsPage(ctx context.Context, userID int64, p domain.DialogPage) (domain.DialogPageResult, error)
  ```
  Их зовёт Task 3.

- [ ] **Шаг 1: написать падающий тест**

`backend/internal/usecase/chat/dialogpage_test.go`:

```go
package chat

import (
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func pageFixture(ids ...int64) []domain.Dialog {
	out := make([]domain.Dialog, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.Dialog{ChatID: id})
	}
	return out
}

func chatIDs(ds []domain.Dialog) []int64 {
	out := make([]int64, 0, len(ds))
	for _, d := range ds {
		out = append(out, d.ChatID)
	}
	return out
}

func eq(t *testing.T, got, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestSliceDialogPage(t *testing.T) {
	all := pageFixture(10, 20, 30, 40, 50)

	t.Run("без лимита — весь список и конец", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 || !r.IsEnd {
			t.Fatalf("count=%d isEnd=%v", r.Count, r.IsEnd)
		}
	})

	t.Run("первая страница", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
		if r.Count != 5 || r.IsEnd {
			t.Fatalf("count=%d isEnd=%v", r.Count, r.IsEnd)
		}
	})

	t.Run("страница по курсору", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{30, 40})
		if r.IsEnd {
			t.Fatal("не конец")
		}
	})

	t.Run("последняя страница помечена концом в том же ответе", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{40, 50})
		if !r.IsEnd {
			t.Fatal("должен быть конец: остатка нет")
		}
	})

	t.Run("курсор на последнем — пустая страница и конец", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 50})
		if len(r.Dialogs) != 0 || !r.IsEnd || r.Count != 5 {
			t.Fatalf("%v count=%d isEnd=%v", chatIDs(r.Dialogs), r.Count, r.IsEnd)
		}
	})

	t.Run("неизвестный курсор — с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 999})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
	})

	t.Run("лимит больше остатка", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 100})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if !r.IsEnd {
			t.Fatal("должен быть конец")
		}
	})

	t.Run("count не зависит от лимита и курсора", func(t *testing.T) {
		for _, p := range []domain.DialogPage{{}, {Limit: 1}, {Limit: 1, OffsetChatID: 30}, {Limit: 1, OffsetChatID: 999}} {
			if got := sliceDialogPage(all, p).Count; got != 5 {
				t.Fatalf("%+v: count=%d", p, got)
			}
		}
	})

	t.Run("пустой список", func(t *testing.T) {
		r := sliceDialogPage(nil, domain.DialogPage{Limit: 10})
		if len(r.Dialogs) != 0 || r.Count != 0 || !r.IsEnd {
			t.Fatalf("%v count=%d isEnd=%v", chatIDs(r.Dialogs), r.Count, r.IsEnd)
		}
	})

	t.Run("проход курсором собирает весь список без дублей и пропусков", func(t *testing.T) {
		var got []int64
		var cursor int64
		for {
			r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: cursor})
			got = append(got, chatIDs(r.Dialogs)...)
			if r.IsEnd {
				break
			}
			cursor = r.Dialogs[len(r.Dialogs)-1].ChatID
		}
		eq(t, got, []int64{10, 20, 30, 40, 50})
	})
}
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
cd backend && go test ./internal/usecase/chat/ -run TestSliceDialogPage
```
Ожидание: не компилируется — `undefined: sliceDialogPage`, `domain.DialogPage`.

- [ ] **Шаг 3: домен**

`backend/internal/domain/chat.go`, рядом с `Dialog`:

```go
// DialogPage — запрос страницы списка диалогов.
//
// Курсор — chat_id последнего полученного диалога, а не смещение: список
// переупорядочивается между запросами (новое сообщение поднимает чат наверх),
// и позиционный offset дал бы пропуски и дубли. Порядок задаёт ChatsRepo.
// ListDialogs (pinned_at, last message date, chat_id) и он строго тотальный.
type DialogPage struct {
	// 0 — без пагинации: весь список.
	Limit int
	// 0 — с начала. Неизвестный id трактуется как «с начала» (чат мог уехать
	// в архив или быть удалён между страницами); клиент сливает страницы по
	// chat_id, поэтому последствие — повторная страница, а не дыра.
	OffsetChatID int64
}

// DialogPageResult — страница плюс метаданные для виртуального списка:
// Count даёт высоту списка и число плейсхолдеров, IsEnd останавливает догрузку.
type DialogPageResult struct {
	Dialogs []Dialog
	// Размер ПОЛНОГО набора, не страницы; от Limit и курсора не зависит.
	Count int
	IsEnd bool
}
```

- [ ] **Шаг 4: чистая нарезка**

`backend/internal/usecase/chat/dialogpage.go`:

```go
package chat

import "github.com/messenger-denis/backend/internal/domain"

// sliceDialogPage режет уже упорядоченный полный список на страницу по курсору.
//
// Порт модели tweb `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1691-1710):
// там курсор — значение сортировочного ключа и позиция ищется линейным поиском
// по кэшу; у нас сортировочный ключ наружу не выходит, поэтому опорой служит
// chat_id (см. докблок domain.DialogPage).
func sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult {
	count := len(all)

	from := 0
	if p.OffsetChatID != 0 {
		for i, d := range all {
			if d.ChatID == p.OffsetChatID {
				from = i + 1
				break
			}
		}
	}
	if from > count {
		from = count
	}

	to := count
	if p.Limit > 0 && from+p.Limit < to {
		to = from + p.Limit
	}

	return domain.DialogPageResult{
		Dialogs: all[from:to],
		Count:   count,
		IsEnd:   to >= count,
	}
}
```

- [ ] **Шаг 5: usecase**

`backend/internal/usecase/chat/chat.go`, сразу после `ListDialogs`:

```go
// ListDialogsPage — страница списка диалогов по курсору.
//
// Надстройка над ListDialogs, а не отдельный запрос в БД: единица кэширования
// (dialogscache, TTL 15с) — полный список, и нарезка идёт после чтения кэша.
// Тяжёлую часть запроса (LATERAL на каждый диалог) пагинация не разгружает —
// её сняла бы только денормализация last_message_at, это отдельная задача;
// здесь пагинация решает контракт клиента, см. спеку этапа 2.
func (i *Interactor) ListDialogsPage(ctx context.Context, userID int64, p domain.DialogPage) (domain.DialogPageResult, error) {
	all, err := i.ListDialogs(ctx, userID)
	if err != nil {
		return domain.DialogPageResult{}, err
	}
	return sliceDialogPage(all, p), nil
}
```

- [ ] **Шаг 6: тесты зелёные**

```bash
cd backend && go build ./... && go test ./internal/usecase/chat/ ./internal/domain/
```

- [ ] **Шаг 7: проверить норму тестов**

Сломать `from = i + 1` → `from = i` и убедиться, что тест краснеет; вернуть.
Сломать `IsEnd: to >= count` → `IsEnd: false` — краснеет; вернуть.

- [ ] **Шаг 8: коммит**

```bash
git add backend/internal/domain/chat.go backend/internal/usecase/chat/
git commit -m "feat(chats): страница списка диалогов по курсору chat_id"
```

---

### Task 3: `GET /chats` учится пагинации

**Файлы:**
- Modify: `backend/internal/adapter/delivery/http/chat_handler.go:256-298` (`ListDialogs`)
- Test: `backend/internal/adapter/delivery/http/chat_handler_test.go`

**Интерфейсы:**
- Consumes: `Interactor.ListDialogsPage(ctx, userID, domain.DialogPage) (domain.DialogPageResult, error)` (Task 2).
- Produces: HTTP-контракт `GET /chats?limit=&offset_chat_id=` → `{"chats":[...],"count":N,"is_end":bool}`.
  Его потребляет Task 6.

**Осторожно:** `h.svc` в хендлере — интерфейс или конкретный тип? Посмотреть
объявление `ChatHandler` в начале `chat_handler.go`; если это интерфейс —
добавить туда `ListDialogsPage`. Формирование `row`/`lastMsg`/`peer` НЕ
переписывать: вынести в функцию `dialogRow(d domain.Dialog) map[string]any`
ровно тем же кодом и звать её в цикле — чтобы диф читался как перенос.

- [ ] **Шаг 1: написать падающий тест**

В `chat_handler_test.go` рядом с `TestChatFlow_HTTP`:

```go
// Пагинация /chats: проход курсором обязан собрать ровно тот же набор в том же
// порядке, что и выдача без параметров, и ни разу не повторить чат.
func TestListDialogs_Pagination_HTTP(t *testing.T) {
	// сетап: тот же, что в TestChatFlow_HTTP — newMessagingRouter + три чата
	// пользователя A с разными собеседниками (создать POST /chats).
	// ... (использовать хелперы этого файла)

	// 1) выдача без параметров: прежняя форма + count/is_end
	full := getChats(t, srv, tokenA, "")
	if full.Count != 3 || !full.IsEnd {
		t.Fatalf("count=%d is_end=%v", full.Count, full.IsEnd)
	}
	if len(full.Chats) != 3 {
		t.Fatalf("want 3 chats, got %d", len(full.Chats))
	}

	// 2) проход курсором по одному
	var walked []int64
	var cursor int64
	for {
		p := getChats(t, srv, tokenA, fmt.Sprintf("?limit=1&offset_chat_id=%d", cursor))
		if p.Count != 3 {
			t.Fatalf("count на странице=%d", p.Count)
		}
		if len(p.Chats) > 1 {
			t.Fatalf("limit=1 нарушен: %d", len(p.Chats))
		}
		for _, c := range p.Chats {
			walked = append(walked, c.ChatID)
		}
		if p.IsEnd {
			break
		}
		cursor = walked[len(walked)-1]
	}

	// 3) совпадает с полной выдачей — порядок и состав
	if len(walked) != len(full.Chats) {
		t.Fatalf("прошли %v, полная выдача %v", walked, full.Chats)
	}
	for i := range walked {
		if walked[i] != full.Chats[i].ChatID {
			t.Fatalf("порядок разошёлся: %v vs %v", walked, full.Chats)
		}
	}
}
```

Хелпер `getChats` написать в этом же файле: делает `GET /chats`+`query` с
токеном, декодирует в
```go
struct {
	Chats []struct{ ChatID int64 `json:"chat_id"` } `json:"chats"`
	Count int  `json:"count"`
	IsEnd bool `json:"is_end"`
}
```
и проверяет код 200. Сетап роутера/токенов — скопировать из `TestChatFlow_HTTP`
(там уже есть всё нужное: `newMessagingRouter`, регистрация пользователей,
создание приватных чатов).

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
cd backend && go test ./internal/adapter/delivery/http/ -run TestListDialogs_Pagination_HTTP
```
Ожидание: FAIL — `count=0 is_end=false` (полей в ответе нет).

- [ ] **Шаг 3: реализация**

`chat_handler.go`:

```go
func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	page := domain.DialogPage{
		Limit:        int(queryInt(r, "limit", 0)),
		OffsetChatID: queryInt(r, "offset_chat_id", 0),
	}
	res, err := h.svc.ListDialogsPage(r.Context(), h.meID(r), page)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	out := make([]map[string]any, 0, len(res.Dialogs))
	for _, d := range res.Dialogs {
		out = append(out, dialogRow(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chats":   out,
		"count":   res.Count,
		"is_end":  res.IsEnd,
	})
}
```

`dialogRow` — вынесенное тело прежнего цикла, БЕЗ изменений в наборе ключей.

Отрицательный `limit` привести к 0 (без пагинации) — не отдавать 400: клиента с
таким запросом нет, а тихая деградация к прежнему поведению безопаснее.

- [ ] **Шаг 4: тесты зелёные**

```bash
cd backend && go build ./... && go test ./internal/adapter/delivery/http/ ./internal/usecase/chat/
```

- [ ] **Шаг 5: проверить норму**

Сломать `OffsetChatID: queryInt(r, "offset_chat_id", 0)` → `0` и убедиться,
что тест краснеет (цикл зациклится/соберёт дубли). Вернуть.

- [ ] **Шаг 6: коммит**

```bash
git add backend/internal/adapter/delivery/http/
git commit -m "feat(api): GET /chats — limit/offset_chat_id и count/is_end в ответе"
```

---

### Task 4: вендор `SequentialCursorFetcher`

**Файлы:**
- Create: `web-client/src/helpers/sequentialCursorFetcher.ts`
- Create: `web-client/src/helpers/sequentialCursorFetcher.test.ts`

**Интерфейсы:**
- Consumes: ничего.
- Produces:
  ```ts
  export type SequentialCursorFetcherResult<T> = { cursor: T; count: number; totalCount?: number }
  export class SequentialCursorFetcher<T> {
    constructor(fetcher: (cursor: T | undefined) => Promise<SequentialCursorFetcherResult<T>>)
    fetchUntil(neededCount: number, currentCount?: number): void
    tryToFetchMore(): void
    setFetchedItemsCount(count: number): void
    setNeededCount(count: number): void
    setCursor(cursor: T): void
    reset(): void
  }
  ```
  Его использует этап 3 (виртуальный список), не Task 6.

**Источник:** `/Users/denisurevic/Documents/tweb/src/helpers/sequentialCursorFetcher.ts`
(74 строки). Перенести **как есть**, кроме: шапка-комментарий по-русски со
ссылкой на оригинал; форматирование под наш eslint/prettier. Логику не
«улучшать» — ни порядок присваиваний, ни `catch(() => {})`.

- [ ] **Шаг 1: написать падающий тест**

`web-client/src/helpers/sequentialCursorFetcher.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { SequentialCursorFetcher } from './sequentialCursorFetcher'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('SequentialCursorFetcher', () => {
  it('тянет страницы, пока не наберёт нужное количество', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(25)
    await flush()
    expect(calls).toEqual([undefined, 10, 20])
  })

  it('конкурентные вызовы не запускают второй цикл', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await flush()
      inFlight--
      return { cursor: (cursor ?? 0) + 1, count: 1 }
    })
    f.fetchUntil(3)
    f.fetchUntil(3)
    f.fetchUntil(3)
    await flush()
    await flush()
    await flush()
    await flush()
    expect(maxInFlight).toBe(1)
  })

  it('пустая страница останавливает цикл', async () => {
    const fetcher = vi.fn(async () => ({ cursor: 1, count: 0 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(100)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('totalCount из ответа замещает накопленный счётчик', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 1, count: 1, totalCount: 50 }
    })
    f.fetchUntil(10)
    await flush()
    expect(calls.length).toBe(1)
  })

  it('setCursor/setFetchedItemsCount откатывают курсор после обрезки списка', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(10)
    await flush()
    f.setCursor(5)
    f.setFetchedItemsCount(5)
    f.fetchUntil(15)
    await flush()
    expect(calls).toEqual([undefined, 5])
  })

  it('reset обнуляет курсор и счётчики', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(10)
    await flush()
    f.reset()
    f.fetchUntil(10)
    await flush()
    expect(calls).toEqual([undefined, undefined])
  })

  it('tryToFetchMore тянет ещё одну страницу поверх набранного', async () => {
    const fetcher = vi.fn(async (cursor?: number) => ({ cursor: (cursor ?? 0) + 10, count: 10 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(10)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    f.tryToFetchMore()
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
```

Ожидаемые значения выше выведены из кода оригинала; если реальный порт даёт
другое — **сначала перечитать оригинал** и понять, кто прав, и только потом
править ожидание. Расхождение с оригиналом — дефект порта, а не теста.

- [ ] **Шаг 2: убедиться, что тест падает** — `npx vitest run src/helpers/sequentialCursorFetcher.test.ts` → модуля нет.

- [ ] **Шаг 3: перенести файл** из tweb с русской шапкой:

```ts
// Вендор tweb src/helpers/sequentialCursorFetcher.ts 1:1 — сериализатор
// постраничной догрузки: держит курсор, не пускает второй цикл, пока крутится
// первый, и тянет страницы, пока не наберёт нужное количество.
```

- [ ] **Шаг 4: тесты зелёные** — `npx vitest run src/helpers/sequentialCursorFetcher.test.ts`

- [ ] **Шаг 5: коммит**

```bash
git add web-client/src/helpers/sequentialCursorFetcher.ts web-client/src/helpers/sequentialCursorFetcher.test.ts
git commit -m "feat(dialogs): вендор SequentialCursorFetcher из tweb"
```

---

### Task 5: правила папок становятся доступны воркеру

**Файлы:**
- Modify: `web-client/src/core/folderFilter.ts`
- Modify: места вызова `matchesFolder` (`core/hooks/useSidebarFolders.tsx`, и всё,
  что найдётся грепом)
- Test: `web-client/src/core/folderFilter.test.ts` (создать или дополнить)

**Интерфейсы:**
- Consumes: `Folder` из `core/managers/foldersManager`.
- Produces:
  ```ts
  export type FolderMatchable = {
    chatId: number
    type: string
    unread?: number | null
    muted?: boolean
    peerId?: number | null
  }
  export function matchesFolder(item: FolderMatchable, folder: Folder, contactIds: ReadonlySet<number>): boolean
  ```
  Её зовёт Task 6 из воркера, передавая `Dialog`.

**Почему:** сейчас `matchesFolder` принимает `Chat` — вью-модель main. Воркеру
нужен тот же ответ на `Dialog`. Вторая реализация правил папок = чаты в разных
папках на разных экранах, поэтому реализация остаётся ОДНА, а тип входа
сужается до фактически используемых полей.

**Осторожно:**
- `Chat.id` сейчас `string | number` (есть draft-чаты с нечисловым id) — на
  границе вызова с main приводить и отбрасывать нечисловые, как делает нынешняя
  первая строка `matchesFolder`. Эта проверка переезжает В АДАПТЕР на стороне
  `Chat`, а не в общую функцию: у `Dialog.chatId` тип уже `number`.
- `folderCounts` в том же файле тоже зовёт `matchesFolder` — привести.
- Поведение НЕ менять ни на йоту: те же ветки, тот же порядок проверок.

- [ ] **Шаг 1: написать падающий тест**

`web-client/src/core/folderFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesFolder, type FolderMatchable } from './folderFilter'
import type { Folder } from './managers/foldersManager'

const folder = (over: Partial<Folder>): Folder => ({
  id: 1, title: 'F', pos: 0,
  includeChats: [], excludeChats: [],
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeRead: false, excludeMuted: false,
  ...over,
} as Folder)

// Один и тот же чат, описанный как Chat (main) и как Dialog (воркер), обязан
// давать один ответ — иначе список папки на экране и страница из воркера
// разъедутся.
describe('matchesFolder: один ответ для Chat и Dialog', () => {
  const cases: { name: string; item: FolderMatchable; f: Folder; want: boolean }[] = [
    { name: 'exclude бьёт include', item: { chatId: 5, type: 'group' }, f: folder({ excludeChats: [5], includeChats: [5], groups: true }), want: false },
    { name: 'include без флагов типов', item: { chatId: 5, type: 'group' }, f: folder({ includeChats: [5] }), want: true },
    { name: 'без флагов типов — не попадает', item: { chatId: 5, type: 'group' }, f: folder({}), want: false },
    { name: 'группы', item: { chatId: 5, type: 'group' }, f: folder({ groups: true }), want: true },
    { name: 'каналы', item: { chatId: 5, type: 'channel' }, f: folder({ broadcasts: true }), want: true },
    { name: 'контакт', item: { chatId: 5, type: 'private', peerId: 7 }, f: folder({ contacts: true }), want: true },
    { name: 'не-контакт', item: { chatId: 5, type: 'private', peerId: 9 }, f: folder({ nonContacts: true }), want: true },
    { name: 'excludeRead отсекает прочитанные', item: { chatId: 5, type: 'group', unread: 0 }, f: folder({ groups: true, excludeRead: true }), want: false },
    { name: 'excludeMuted отсекает заглушённые', item: { chatId: 5, type: 'group', muted: true }, f: folder({ groups: true, excludeMuted: true }), want: false },
  ]
  const contacts = new Set([7])
  for (const c of cases) {
    it(c.name, () => {
      expect(matchesFolder(c.item, c.f, contacts)).toBe(c.want)
    })
  }
})
```

Плюс тест-скан «правила папок описаны в одном файле»: пройти по `src/**/*.ts(x)`
и убедиться, что `excludeRead`/`nonContacts` встречаются в реализации только в
`core/folderFilter.ts` (образец скана — `src/stores/noManualOrder.test.ts:76-84`).

Поля `Folder` в фикстуре выше — предположение; посмотреть реальный тип в
`core/managers/foldersManager.ts` и привести фикстуру к нему.

- [ ] **Шаг 2: убедиться, что тест падает** (сигнатура принимает `Chat`).

- [ ] **Шаг 3: обобщить сигнатуру**, адаптировать колсайты.

- [ ] **Шаг 4: тесты зелёные**

```bash
cd web-client && npx vitest run src/core/ src/stores/ && npx tsc --noEmit
```

- [ ] **Шаг 5: коммит**

```bash
git add web-client/src/core/folderFilter.ts web-client/src/core/folderFilter.test.ts web-client/src/core/hooks/
git commit -m "refactor(folders): matchesFolder на структурном типе — доступна воркеру"
```

---

### Task 6: `dialogsManager.getDialogs` — порт `dialogsStorage.getDialogs`

**Файлы:**
- Modify: `web-client/src/core/managers/dialogsManager.ts`
- Modify: `web-client/src/core/workerCore.ts` (ветка `folders` в `setStateKey`, если нужна)
- Modify: `web-client/src/stores/foldersStore.ts` (`loadFolders` отдаёт контакты воркеру)
- Test: `web-client/src/core/managers/dialogsManager.pagination.test.ts` (создать)

**Интерфейсы:**
- Consumes: HTTP `GET /chats?limit&offset_chat_id` → `{chats, count, is_end}` (Task 3);
  `matchesFolder(item, folder, contactIds)` (Task 5); `DialogOp.upsert` (уже есть).
- Produces:
  ```ts
  type DialogsPage = { dialogs: Dialog[]; count: number; isEnd: boolean }
  getDialogs(options?: { offsetIndex?: number; limit?: number; filterId?: number }): Promise<DialogsPage>
  setContactIds(ids: number[]): void
  ```
  Их зовёт этап 3. Менеджеры экспонируются в RPC целиком (`workerCore.ts:527`) —
  дополнительной проводки метода не требуется, но это надо **проверить**, а не
  предположить.

**Порт:** `/Users/denisurevic/Documents/tweb/src/lib/storages/dialogs.ts:1691-1753`.
Прочитать оригинал целиком перед реализацией.

**Осторожно:**
1. **`syncPinnedOrder` только на полном списке.** Он выводит порядок пинов из
   ПОЛНОГО списка (докблок в `dialogsManager.ts`); слияние страницы обязано его
   НЕ звать, иначе первая частичная страница затрёт порядок остальных пинов.
   Это заявленный хвост этапа 1 — закрыть здесь, с тестом.
2. **Слияние публикует `upsert`, а не `reset`.** `reset` остаётся за `refresh()`
   и гидрацией.
3. **`sessionGen`.** Сетевой ответ страницы применять только при
   `gen === sessionGen` — тем же гвардом, что в `refresh()`.
4. **Неизвестная папка** (определения ещё не приехали) → пустая страница с
   `isEnd: false`. Показать не тот список хуже, чем показать скелетоны.
5. **`loadedAll`** — флаг владельца: последний сетевой ответ пришёл с `is_end`
   и без курсора (то есть покрыл весь набор). `refresh()` его тоже выставляет.
6. **`serverCount`** — `count` из последнего сетевого ответа; до первой сети
   отдаём длину отфильтрованного кэша (отступление №3 спеки).

**Скелет** (докблоки писать полные, со ссылками на оригинал):

```ts
export type DialogsPage = { dialogs: Dialog[]; count: number; isEnd: boolean }

const DEFAULT_LIMIT = 20

// внутри newDialogsManager:
let loadedAll = false
let serverCount: number | null = null
let contactIds: ReadonlySet<number> = new Set()
let folders: Folder[] = []

/** Элементы кэша, прошедшие фильтр папки, в текущем порядке. */
function forFilter(filterId: number): DialogItem[] | null {
  if (filterId === ALL_FOLDER_ID) return items.filter((i) => !i.dialog.archived)
  if (filterId === ARCHIVE_FOLDER_ID) return items.filter((i) => i.dialog.archived)
  const folder = folders.find((f) => f.id === filterId)
  if (!folder) return null // папка ещё не приехала
  return items.filter((i) => !i.dialog.archived && matchesFolder(i.dialog, folder, contactIds))
}

async function fetchPage(limit: number, offsetChatId: number): Promise<void> { /* rest.get + слияние + upsert */ }
```

`ARCHIVE_FOLDER_ID` — посмотреть, есть ли уже константа архива на фронте
(`stores/foldersStore.ts` знает `ALL_FOLDER_ID = 0`); если нет — завести рядом
с `ALL_FOLDER_ID` в `dialogsManager.ts` и объяснить комментарием.

- [ ] **Шаг 1: написать падающие тесты**

`dialogsManager.pagination.test.ts`. Взять за образец существующий
`dialogsManager.test.ts` (фабрика менеджера, фейковый `rest`) — **не изобретать
свой сетап**. Кейсы:

1. `getDialogs({limit: 2})` при 5 диалогах в кэше и `loadedAll` — сеть НЕ дёргается,
   возвращаются первые два, `count: 5`, `isEnd: false`.
2. `getDialogs({offsetIndex: <index 2-го>, limit: 2})` — возвращает 3-й и 4-й.
3. `offsetIndex` последнего — пустой список, `isEnd: true`.
4. Кэш короче нужного и `!loadedAll` → ровно ОДИН вызов `rest.get` с
   `limit`/`offset_chat_id`; ответ слит, страница отдана.
5. Слияние публикует `{op:'upsert'}` и НЕ публикует `reset`.
6. Повторная страница с теми же чатами не плодит дублей в `getSnapshot()`.
7. `count` берётся из ответа сервера, пока `!loadedAll`; после — длина кэша.
8. Фильтр папки: диалог, не проходящий `matchesFolder`, в страницу не попадает.
9. Неизвестный `filterId` → `{dialogs: [], count: 0, isEnd: false}`, сеть не дёргается.
10. **`syncPinnedOrder` не зовётся на слиянии страницы**: закрепить два диалога,
    выдать страницу, содержащую только один из них, — `pinnedOrders` не изменился.
    (Проверять через мок `savePinnedOrders`: он не вызван.)
11. `resetForLogout()` во время сетевого запроса страницы → ответ не применён
    (тот же сценарий, что для `refresh` в `dialogsManager.test.ts`).

- [ ] **Шаг 2: убедиться, что тесты падают.**

- [ ] **Шаг 3: реализация** (по одному кейсу за раз, не всё сразу).

- [ ] **Шаг 4: зеркало папок и контактов**
- `dialogsManager.setStateKey` — ветка `'folders'`;
- проверить грепом, что `AppState.folders` пишется через тот же
  `persistManager.stateKey`, что `pinnedOrders`/`drafts` (`workerCore.ts:262`).
  Если нет — довести, а не обходить;
- `setContactIds` вызывается оттуда же, откуда `foldersStore.setContacts`
  (`stores/foldersStore.ts::loadFolders`). Один источник, два потребителя.

- [ ] **Шаг 5: весь набор тестов зелёный**

```bash
cd web-client && npx vitest run --reporter=dot && npx tsc --noEmit
```
Ожидание: 252+ файла, всё зелёное. Красный `chatsStore`/`storeProjection` —
признак, что слияние публикует не ту операцию.

- [ ] **Шаг 6: проверить норму тестов**

Сломать по очереди: гвард `filterId`-неизвестной папки (вернуть весь список),
условие `isEnoughDialogs`, гвард `syncPinnedOrder`, `sessionGen`. Каждая мутация
обязана красить свой тест. Вернуть.

- [ ] **Шаг 7: коммит**

```bash
git add web-client/src/core/ web-client/src/stores/
git commit -m "feat(dialogs): getDialogs — страница из кэша владельца с догрузкой"
```
