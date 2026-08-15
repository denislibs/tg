# Зеркало поста канала в группе обсуждения — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** привести комментарии к Telegram-модели — каждый пост канала зеркалится в связанную группу обсуждения, комментарии становятся тредом на зеркале.

**Architecture:** зеркало — обычная строка `messages` в группе с `send_as_chat_id = канал`, `fwd_from_*` на пост и новым флагом `is_discussion_mirror`; создаётся в той же транзакции, что и пост, одним usecase-хелпером, который зовут все четыре пути вставки в канал; чтение комментариев резолвит зеркало по паре (канал, пост).

**Tech Stack:** Go 1.25, чистая архитектура `domain → usecase → adapter`, pgx/v5, goose-миграции, тесты — фейки на уровне usecase и testcontainers на уровне репозитория.

**Спека:** [`../specs/2026-08-14-discussion-mirror-design.md`](../specs/2026-08-14-discussion-mirror-design.md)

## Global Constraints

- Ворктри `.worktrees/discussion-mirror`, ветка `feat/discussion-mirror`. Команды бэкенда — из `backend/`.
- Отвечать по-русски, комментарии в коде — по-русски, как в остальном бэкенде.
- Чистая архитектура: `domain` без импортов фреймворков; `usecase` зависит только от интерфейсов из `ports.go`; конкретика (pgx, SQL) — только в `adapter/repo/postgres`. Не тащить `*pgxpool` в usecase.
- Новая зависимость usecase объявляется портом в `backend/internal/usecase/chat/ports.go`; при смене сигнатуры порта обновить фейки в `backend/internal/usecase/chat/fakes_test.go`, иначе пакет не соберётся.
- Миграции — `backend/internal/store/postgres/migrations/NNNN_name.sql`, следующий свободный номер **0093**. Уже применённые миграции не править.
- Ошибки домена — из `backend/internal/domain/errors.go` (`ErrNotFound`, `ErrForbidden`); сырые ошибки наружу не отдавать.
- Тесты уровня `usecase/chat` — на фейках (`newChannelTestInteractor(t)`); тесты репозитория и бэкфилла — на testcontainers через `storepostgres.NewTestDB(t)`, **нужен запущенный Docker**.
- Перед коммитом: `go build ./...`, `go vet ./...`, `gofmt -l .` (пусто), `go test ./internal/usecase/chat/... ./internal/adapter/repo/postgres/...`.
- Каждая строка проводки обязана краснить тест при удалении/порче — проверять мутацией и приводить реальный вывод `go test`, не пересказ.

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `backend/internal/store/postgres/migrations/0093_discussion_mirrors.sql` (создать) | колонка `is_discussion_mirror` + частичный уникальный индекс |
| `backend/internal/domain/message.go` (изменить) | поле `IsDiscussionMirror bool` |
| `backend/internal/adapter/repo/postgres/messagesrepo.go` (изменить) | колонка в `messageCols`, запись в `Insert`, чтение в `scanMessage`; `MirrorByPost`, `MirrorsByPosts` |
| `backend/internal/adapter/repo/postgres/discussionmirror_test.go` (создать) | индекс, резолв, «пересылка ≠ зеркало» |
| `backend/internal/usecase/chat/ports.go` (изменить) | `MirrorByPost`, `MirrorsByPosts` в порт сообщений |
| `backend/internal/usecase/chat/discussion_mirror.go` (создать) | `mirrorChannelPost` — единственное место, где рождается зеркало |
| `backend/internal/usecase/chat/discussion_mirror_test.go` (создать) | поведение хелпера и всех четырёх точек вызова |
| `backend/internal/usecase/chat/channel.go`, `message.go`, `message_forward.go`, `suggested.go` (изменить) | вызов хелпера после вставки поста |
| `backend/internal/usecase/chat/discussion.go` (изменить) | чтение комментариев через id зеркала |
| `backend/internal/store/postgres/backfill_mirrors.go` (создать) | идемпотентный `BackfillDiscussionMirrors` |
| `backend/internal/store/postgres/backfill_mirrors_test.go` (создать) | перенос старых тредов + идемпотентность |
| `backend/internal/app/providers.go` (изменить) | вызов бэкфилла после `Migrate` |

---

### Task 1: схема и поле домена

**Files:**
- Create: `backend/internal/store/postgres/migrations/0093_discussion_mirrors.sql`
- Modify: `backend/internal/domain/message.go` (рядом с блоком «Forward attribution»), `backend/internal/adapter/repo/postgres/messagesrepo.go` (`messageCols`, `Insert`, `scanMessage`)
- Test: `backend/internal/adapter/repo/postgres/discussionmirror_test.go`

**Interfaces:**
- Produces: поле `domain.Message.IsDiscussionMirror bool`; колонка `messages.is_discussion_mirror`; уникальный индекс `uq_messages_discussion_mirror`.

- [ ] **Step 1: Написать падающий тест**

```go
// backend/internal/adapter/repo/postgres/discussionmirror_test.go
package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Зеркало поста канала — ровно одно на пост: уникальный индекс закрывает гонку
// параллельных публикаций и ретраев. Обычную пересылку он задевать не должен.
func TestMessages_DiscussionMirror_UniquePerPost(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7900")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	if err := groups.SetDiscussion(ctx, ch, disc); err != nil {
		t.Fatal(err)
	}

	postSeq, _ := msgs.NextSeq(ctx, ch)
	post, err := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: postSeq, SenderID: u, Type: "text", Text: "post"})
	if err != nil {
		t.Fatal(err)
	}

	mirror := func() domain.Message {
		seq, _ := msgs.NextSeq(ctx, disc)
		return domain.Message{
			ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "post",
			SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID,
			IsDiscussionMirror: true,
		}
	}

	if _, err := msgs.Insert(ctx, mirror()); err != nil {
		t.Fatalf("первое зеркало: %v", err)
	}
	if _, err := msgs.Insert(ctx, mirror()); err == nil {
		t.Fatal("второе зеркало вставилось — уникального индекса нет")
	} else if !strings.Contains(strings.ToLower(err.Error()), "unique") &&
		!strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		t.Fatalf("ожидалось нарушение уникальности, получено: %v", err)
	}

	// Обычная пересылка того же поста в ту же группу — легальна, и дважды тоже.
	fwd := func() domain.Message {
		seq, _ := msgs.NextSeq(ctx, disc)
		return domain.Message{
			ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "post",
			FwdFromChatID: &ch, FwdFromMsgID: &post.ID,
		}
	}
	for n := 1; n <= 2; n++ {
		if _, err := msgs.Insert(ctx, fwd()); err != nil {
			t.Fatalf("пересылка №%d сломана индексом: %v", n, err)
		}
	}
}

// Флаг должен переживать запись/чтение: если его не читать в scanMessage,
// резолв зеркала не отличит его от пересылки.
func TestMessages_DiscussionMirror_FlagRoundTrip(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7901")
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)

	seq, _ := msgs.NextSeq(ctx, disc)
	m, err := msgs.Insert(ctx, domain.Message{ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "m", IsDiscussionMirror: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := msgs.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsDiscussionMirror {
		t.Fatal("флаг is_discussion_mirror не дожил до чтения")
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestMessages_DiscussionMirror -v 2>&1 | tail -20`
Expected: ошибка компиляции — `unknown field IsDiscussionMirror in struct literal`.

- [ ] **Step 3: Добавить миграцию**

```sql
-- backend/internal/store/postgres/migrations/0093_discussion_mirrors.sql
-- +goose Up
-- Зеркало поста канала в связанной группе обсуждения (Telegram-модель): пост
-- дублируется в группу отдельным сообщением, а комментарии — обычный тред на
-- этом зеркале. Флаг отличает зеркало от ОБЫЧНОЙ пересылки: по одним лишь
-- fwd_from_* они неразличимы, а уникальность нужна только зеркалам — иначе
-- индекс запретил бы пользователю переслать один и тот же пост в группу дважды.
ALTER TABLE messages ADD COLUMN is_discussion_mirror BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX uq_messages_discussion_mirror
  ON messages (chat_id, fwd_from_chat_id, fwd_from_msg_id)
  WHERE is_discussion_mirror;

-- +goose Down
DROP INDEX IF EXISTS uq_messages_discussion_mirror;
ALTER TABLE messages DROP COLUMN is_discussion_mirror;
```

- [ ] **Step 4: Добавить поле в домен**

В `backend/internal/domain/message.go`, сразу после блока `FwdFromName`:

```go
	// IsDiscussionMirror — это сообщение является зеркалом поста канала в его
	// группе обсуждения (Telegram: пост дублируется в связанную группу, а
	// комментарии отвечают на зеркало). Отличает зеркало от обычной пересылки:
	// по fwd_from_* они неразличимы.
	IsDiscussionMirror bool
```

- [ ] **Step 5: Провести колонку через репозиторий**

В `backend/internal/adapter/repo/postgres/messagesrepo.go`: добавить
`is_discussion_mirror` в конец `messageCols`, записывать поле в `Insert` и
читать в `scanMessage` — ровно там же и в том же порядке, что остальные
колонки списка (порядок в `messageCols` и в сканере обязан совпадать).

- [ ] **Step 6: Прогнать тесты**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestMessages_DiscussionMirror -v 2>&1 | tail -20`
Expected: PASS (2 теста).

- [ ] **Step 7: Проверить мутацией**

Убери из миграции строку `CREATE UNIQUE INDEX …`, пересоздай базу тестом —
`TestMessages_DiscussionMirror_UniquePerPost` обязан упасть на «второе зеркало
вставилось». Верни строку. То же для `scanMessage`: не читать колонку →
падает `FlagRoundTrip`. Привести реальный вывод обоих прогонов в отчёт.

- [ ] **Step 8: Коммит**

```bash
git add backend/internal/store/postgres/migrations/0093_discussion_mirrors.sql backend/internal/domain/message.go backend/internal/adapter/repo/postgres/messagesrepo.go backend/internal/adapter/repo/postgres/discussionmirror_test.go
git commit -m "feat(discussion): колонка is_discussion_mirror и уникальность зеркала"
```

---

### Task 2: резолв зеркала по посту

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/messagesrepo.go` (новые методы), `backend/internal/usecase/chat/ports.go` (порт сообщений), `backend/internal/usecase/chat/fakes_test.go` (фейк `fakeMsgs`)
- Test: `backend/internal/adapter/repo/postgres/discussionmirror_test.go` (дописать)

**Interfaces:**
- Consumes: `domain.Message.IsDiscussionMirror` (Task 1).
- Produces:
  ```go
  MirrorByPost(ctx context.Context, channelID, postID int64) (int64, error)          // 0 = зеркала нет
  MirrorsByPosts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]int64, error)
  ```
  Обе — на `MessagesRepo` и в порту сообщений `usecase/chat/ports.go`.

- [ ] **Step 1: Написать падающий тест**

```go
// дописать в backend/internal/adapter/repo/postgres/discussionmirror_test.go
func TestMessages_MirrorByPost(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7902")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	_ = groups.SetDiscussion(ctx, ch, disc)

	seq, _ := msgs.NextSeq(ctx, ch)
	post, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq, SenderID: u, Type: "text", Text: "p1"})
	seq2, _ := msgs.NextSeq(ctx, ch)
	post2, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq2, SenderID: u, Type: "text", Text: "p2"})

	mseq, _ := msgs.NextSeq(ctx, disc)
	mirror, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq, SenderID: u, Type: "text", Text: "p1",
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// у post2 зеркала нет, но есть ПОЛЬЗОВАТЕЛЬСКАЯ пересылка в ту же группу
	fseq, _ := msgs.NextSeq(ctx, disc)
	_, _ = msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: fseq, SenderID: u, Type: "text", Text: "p2",
		FwdFromChatID: &ch, FwdFromMsgID: &post2.ID,
	})

	got, err := msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || got != mirror.ID {
		t.Fatalf("MirrorByPost(post1) = %d, %v; want %d", got, err, mirror.ID)
	}
	got2, err := msgs.MirrorByPost(ctx, ch, post2.ID)
	if err != nil {
		t.Fatalf("MirrorByPost(post2): %v", err)
	}
	if got2 != 0 {
		t.Fatalf("пересылка принята за зеркало: MirrorByPost(post2) = %d, want 0", got2)
	}

	m, err := msgs.MirrorsByPosts(ctx, ch, []int64{post.ID, post2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if m[post.ID] != mirror.ID {
		t.Fatalf("MirrorsByPosts[post1] = %d, want %d", m[post.ID], mirror.ID)
	}
	if _, ok := m[post2.ID]; ok {
		t.Fatal("MirrorsByPosts вернул запись для поста без зеркала")
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestMessages_MirrorByPost -v 2>&1 | tail -20`
Expected: ошибка компиляции — `msgs.MirrorByPost undefined`.

- [ ] **Step 3: Реализовать методы репозитория**

```go
// MirrorByPost возвращает id зеркала поста канала в его группе обсуждения
// (0 — зеркала нет). Пользовательская пересылка того же поста зеркалом не
// считается: она без флага is_discussion_mirror.
func (r *MessagesRepo) MirrorByPost(ctx context.Context, channelID, postID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`SELECT id FROM messages
		 WHERE fwd_from_chat_id=$1 AND fwd_from_msg_id=$2 AND is_discussion_mirror AND deleted_at IS NULL`,
		channelID, postID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return id, err
}

// MirrorsByPosts — батч того же резолва: postID -> id зеркала. Посты без
// зеркала в карту не попадают.
func (r *MessagesRepo) MirrorsByPosts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(postIDs) == 0 {
		return out, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT fwd_from_msg_id, id FROM messages
		 WHERE fwd_from_chat_id=$1 AND fwd_from_msg_id = ANY($2) AND is_discussion_mirror AND deleted_at IS NULL`,
		channelID, postIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var post, mirror int64
		if err := rows.Scan(&post, &mirror); err != nil {
			return nil, err
		}
		out[post] = mirror
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Объявить порт и починить фейк**

В `backend/internal/usecase/chat/ports.go` — добавить обе сигнатуры в порт
сообщений (рядом с `ListThread`/`CountThread`). В
`backend/internal/usecase/chat/fakes_test.go` — реализовать их у `fakeMsgs`
поверх его in-memory хранилища (искать сообщение с `IsDiscussionMirror` и
совпадающими `FwdFromChatID`/`FwdFromMsgID`), иначе пакет тестов не соберётся.

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestMessages_Mirror -v 2>&1 | tail -20 && go build ./...`
Expected: PASS, сборка чистая.

- [ ] **Step 6: Коммит**

```bash
git add backend/internal/adapter/repo/postgres/ backend/internal/usecase/chat/ports.go backend/internal/usecase/chat/fakes_test.go
git commit -m "feat(discussion): резолв зеркала по посту (MirrorByPost/MirrorsByPosts)"
```

---

### Task 3: хелпер `mirrorChannelPost` и первый путь публикации

**Files:**
- Create: `backend/internal/usecase/chat/discussion_mirror.go`, `backend/internal/usecase/chat/discussion_mirror_test.go`
- Modify: `backend/internal/usecase/chat/channel.go` (внутри транзакции `PostToChannel`, после `msgs.Insert`)

**Interfaces:**
- Consumes: `MirrorByPost` (Task 2), `Groups.GetDiscussion(ctx, channelID) (int64, error)` (уже есть в порту), `Messages.NextSeq`, `Messages.Insert`.
- Produces: `func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) error` — единственное место, где рождается зеркало.

- [ ] **Step 1: Написать падающий тест**

```go
// backend/internal/usecase/chat/discussion_mirror_test.go
package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Публикация поста в канал с обсуждением кладёт зеркало в группу: автор бабла —
// канал (send_as), атрибуция пересылки указывает на пост, тред живёт на зеркале.
func TestPostToChannel_CreatesMirror(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	_ = fg

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	mirrorID, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mirrorID == 0 {
		t.Fatal("зеркало не создано")
	}
	m, err := i.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatal(err)
	}
	if m.ChatID != disc {
		t.Fatalf("зеркало в чате %d, ожидалась группа обсуждения %d", m.ChatID, disc)
	}
	if m.SendAsChatID == nil || *m.SendAsChatID != ch {
		t.Fatalf("send_as_chat_id = %v, ожидался канал %d", m.SendAsChatID, ch)
	}
	if m.FwdFromChatID == nil || *m.FwdFromChatID != ch || m.FwdFromMsgID == nil || *m.FwdFromMsgID != post.ID {
		t.Fatalf("атрибуция пересылки неверна: %v/%v", m.FwdFromChatID, m.FwdFromMsgID)
	}
	if m.ThreadRootID != nil {
		t.Fatalf("зеркало само корень треда, thread_root_id должен быть nil, got %v", m.ThreadRootID)
	}
	if !m.IsDiscussionMirror {
		t.Fatal("флаг is_discussion_mirror не выставлен")
	}
	if m.Text != post.Text {
		t.Fatalf("текст зеркала %q, ожидался %q", m.Text, post.Text)
	}
}

// Канал без обсуждения: зеркала нет, публикация не падает.
func TestPostToChannel_NoDiscussion_NoMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("публикация в канал без обсуждения упала: %v", err)
	}
	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id != 0 {
		t.Fatalf("зеркало создано без группы обсуждения: %d", id)
	}
}

// Повторный вызов хелпера на том же посте не плодит зеркал (ретрай/гонка).
func TestMirrorChannelPost_Idempotent(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")

	first, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err := i.mirrorChannelPost(ctx, post); err != nil {
		t.Fatalf("повторное зеркалирование вернуло ошибку: %v", err)
	}
	second, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if second != first {
		t.Fatalf("повторный вызов создал новое зеркало: было %d, стало %d", first, second)
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/usecase/chat/ -run "TestPostToChannel_CreatesMirror|TestMirrorChannelPost_Idempotent" -v 2>&1 | tail -20`
Expected: FAIL — `i.mirrorChannelPost undefined` / «зеркало не создано».

- [ ] **Step 3: Реализовать хелпер**

```go
// backend/internal/usecase/chat/discussion_mirror.go
package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// mirrorChannelPost кладёт зеркало поста канала в его группу обсуждения.
// Telegram-модель: комментарии — это обычный тред в группе, отвечающий на
// зеркало, поэтому зеркало обязано появиться вместе с постом (в той же
// транзакции), иначе у поста не будет треда.
//
// Единственное место, где рождается зеркало: все четыре пути публикации в
// канал (PostToChannel, Send с медиа, Forward, одобрение предложенного поста)
// зовут именно его.
func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) error {
	if i.groups == nil {
		return nil
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil || disc == 0 {
		// у канала нет привязанного обсуждения — зеркалить некуда, это не ошибка
		return nil
	}
	// идемпотентность: ретрай/повторная доставка не должны плодить зеркала
	// (в базе то же самое держит уникальный индекс)
	if existing, err := i.msgs.MirrorByPost(ctx, post.ChatID, post.ID); err != nil {
		return err
	} else if existing != 0 {
		return nil
	}

	seq, err := i.msgs.NextSeq(ctx, disc)
	if err != nil {
		return err
	}
	channelID := post.ChatID
	postID := post.ID
	date := post.CreatedAt
	_, err = i.msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: seq, SenderID: post.SenderID,
		Type: post.Type, Text: post.Text, Entities: post.Entities,
		MediaID: post.MediaID, GroupedID: post.GroupedID, PollID: post.PollID,
		// автор бабла в UI — канал, как в Telegram
		SendAsChatID: &channelID,
		// отсюда кнопка «перейти к оригиналу»
		FwdFromChatID: &channelID, FwdFromMsgID: &postID, FwdDate: &date,
		IsDiscussionMirror: true,
	})
	return err
}
```

- [ ] **Step 4: Подключить к `PostToChannel`**

В `backend/internal/usecase/chat/channel.go`, внутри `i.tx.WithinTx` сразу
после успешного `msgs.Insert` и присвоения `msg = m`:

```go
		// Зеркало поста в группе обсуждения — в той же транзакции: пост без
		// зеркала остался бы без треда комментариев.
		if e := i.mirrorChannelPost(ctx, m); e != nil {
			return e
		}
```

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && go test ./internal/usecase/chat/ -run "Mirror" -v 2>&1 | tail -25`
Expected: PASS (3 теста).

- [ ] **Step 6: Проверить мутацией**

Замени тело `mirrorChannelPost` на `return nil` — `TestPostToChannel_CreatesMirror`
обязан упасть на «зеркало не создано». Верни. Затем убери вызов из `channel.go`
— тот же тест обязан упасть снова (покрыт и хелпер, и его вызов). Привести
оба вывода в отчёт.

- [ ] **Step 7: Коммит**

```bash
git add backend/internal/usecase/chat/discussion_mirror.go backend/internal/usecase/chat/discussion_mirror_test.go backend/internal/usecase/chat/channel.go
git commit -m "feat(discussion): зеркало поста канала при публикации"
```

---

### Task 4: остальные три пути публикации

**Files:**
- Modify: `backend/internal/usecase/chat/message.go` (внутри транзакции `Send`, после `msgs.Insert`), `backend/internal/usecase/chat/message_forward.go:135` (после `msgs.Insert`), `backend/internal/usecase/chat/suggested.go:220` (после `msgs.Insert`)
- Test: `backend/internal/usecase/chat/discussion_mirror_test.go` (дописать)

**Interfaces:**
- Consumes: `mirrorChannelPost` (Task 3).

**Важно:** зеркалить нужно только сообщения, попавшие **в канал**. `Send` кладёт
сообщения и в группы, и в приваты — там `GetDiscussion` вернёт 0 и хелпер сам
станет no-op, поэтому дополнительной проверки типа чата не требуется, но и
вызывать хелпер для сообщения-комментария (`ThreadRootID != nil`) не нужно:
комментарий не пост.

- [ ] **Step 1: Написать падающий тест**

```go
// дописать в backend/internal/usecase/chat/discussion_mirror_test.go

// Пост с медиа идёт не через PostToChannel, а через Send — зеркало обязано
// появиться и на этом пути.
func TestSendToChannel_CreatesMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	mediaID := int64(42)
	post, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", Text: "cap", MediaID: &mediaID})
	if err != nil {
		t.Fatal(err)
	}

	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("зеркало не создано для поста с медиа")
	}
	m, _ := i.msgs.GetByID(ctx, id)
	if m.MediaID == nil || *m.MediaID != mediaID {
		t.Fatalf("медиа не перенесено в зеркало: %v", m.MediaID)
	}
}

// Комментарий в группе обсуждения — не пост, зеркалить его нельзя.
func TestSendComment_NoMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, _ := i.EnableDiscussion(ctx, ch, 7)
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	root, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)

	c, err := i.Send(ctx, SendInput{ChatID: disc, SenderID: 7, Type: "text", Text: "первый", ThreadRootID: &root})
	if err != nil {
		t.Fatal(err)
	}
	if c.IsDiscussionMirror {
		t.Fatal("комментарий помечен как зеркало")
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/usecase/chat/ -run "TestSendToChannel_CreatesMirror|TestSendComment_NoMirror" -v 2>&1 | tail -20`
Expected: FAIL — «зеркало не создано для поста с медиа».

- [ ] **Step 3: Подключить хелпер к трём путям**

В каждом из трёх мест — сразу после успешного `msgs.Insert`, внутри той же
транзакции, с комментарием по-русски у строки:

```go
		// Пост в канал зеркалится в группу обсуждения (см. discussion_mirror.go).
		// Комментарий (ThreadRootID != nil) постом не является.
		if msg.ThreadRootID == nil {
			if e := i.mirrorChannelPost(ctx, msg); e != nil {
				return e
			}
		}
```

(в `message_forward.go` и `suggested.go` переменная сообщения называется иначе —
использовать имя из соответствующего файла).

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && go test ./internal/usecase/chat/ 2>&1 | tail -10`
Expected: PASS весь пакет.

- [ ] **Step 5: Проверить мутацией**

Убери вызов из `message.go` — `TestSendToChannel_CreatesMirror` обязан
покраснеть. Верни. Привести вывод в отчёт.

- [ ] **Step 6: Коммит**

```bash
git add backend/internal/usecase/chat/
git commit -m "feat(discussion): зеркало на всех путях публикации в канал"
```

---

### Task 5: чтение комментариев через зеркало

**Files:**
- Modify: `backend/internal/usecase/chat/discussion.go` (`PostComment`, `ListComments`, `CommentCounts`)
- Test: `backend/internal/usecase/chat/discussion_test.go` (дописать)

**Interfaces:**
- Consumes: `MirrorByPost`, `MirrorsByPosts` (Task 2).
- Внешний API (`/channels/{id}/posts/{postId}/comments`) не меняется.

- [ ] **Step 1: Написать падающий тест**

```go
// дописать в backend/internal/usecase/chat/discussion_test.go

// Комментарий приземляется в тред ЗЕРКАЛА, а чтение по (канал, пост) его находит.
func TestComments_ThreadOnMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")

	if _, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1"); err != nil {
		t.Fatal(err)
	}

	mirrorID, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	msgs, count, err := i.ListComments(ctx, ch, post.ID, 8, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(msgs) != 1 {
		t.Fatalf("ListComments = %d сообщений, count=%d; want 1/1", len(msgs), count)
	}
	if msgs[0].ThreadRootID == nil || *msgs[0].ThreadRootID != mirrorID {
		t.Fatalf("комментарий висит на %v, а корень треда — зеркало %d", msgs[0].ThreadRootID, mirrorID)
	}

	counts, recent, err := i.CommentCounts(ctx, ch, []int64{post.ID})
	if err != nil {
		t.Fatal(err)
	}
	if counts[post.ID] != 1 {
		t.Fatalf("CommentCounts[post] = %d, want 1", counts[post.ID])
	}
	if len(recent[post.ID]) != 1 || recent[post.ID][0].ID != 8 {
		t.Fatalf("recent repliers = %+v, want автор 8", recent[post.ID])
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestComments_ThreadOnMirror -v 2>&1 | tail -20`
Expected: FAIL — комментарий висит на id поста, а не зеркала.

- [ ] **Step 3: Перевести чтение и запись на id зеркала**

В `discussion.go`:
- `PostComment` — вместо `pid := postID` резолвить
  `root, err := i.msgs.MirrorByPost(ctx, channelID, postID)`; `root == 0` →
  `domain.ErrNotFound` (у поста нет треда); `Send(... ThreadRootID: &root)`;
- `ListComments` — те же `ListThread`/`CountThread`, но по `root`;
- `CommentCounts` — один `MirrorsByPosts` на весь батч, дальше
  `CountThread`/`RecentThreadRepliers` по id зеркал; ключи результата остаются
  **id постов**, чтобы внешний контракт не менялся.

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && go test ./internal/usecase/chat/ 2>&1 | tail -10`
Expected: PASS весь пакет (существующие тесты комментариев тоже).

- [ ] **Step 5: Коммит**

```bash
git add backend/internal/usecase/chat/discussion.go backend/internal/usecase/chat/discussion_test.go
git commit -m "feat(discussion): комментарии читаются и пишутся через зеркало"
```

---

### Task 6: бэкфилл существующих тредов

**Files:**
- Create: `backend/internal/store/postgres/backfill_mirrors.go`, `backend/internal/store/postgres/backfill_mirrors_test.go`
- Modify: `backend/internal/app/providers.go` (в `providePool`, после `postgres.Migrate`, рядом с `SeedDemo`)

**Interfaces:**
- Produces: `func BackfillDiscussionMirrors(ctx context.Context, pool *pgxpool.Pool) (int, error)` — число созданных зеркал.

- [ ] **Step 1: Написать падающий тест**

```go
// backend/internal/store/postgres/backfill_mirrors_test.go
package postgres_test

// Тест живёт в отдельном пакете, чтобы звать BackfillDiscussionMirrors как
// внешний API и не тянуть внутренности.

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Старая схема: комментарий висит на id ПОСТА КАНАЛА. Бэкфилл обязан создать
// зеркало в группе обсуждения и перевести тред на него.
func TestBackfillDiscussionMirrors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	// сид «старой формы» — сырым SQL, потому что usecase так писать уже не умеет
	var userID, ch, disc, postID, commentID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000001') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3) RETURNING id`,
		disc, userID, postID).Scan(&commentID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorID, rootID int64
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&mirrorID); err != nil {
		t.Fatalf("зеркало не создано: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT thread_root_id FROM messages WHERE id=$1`, commentID).Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if rootID != mirrorID {
		t.Fatalf("тред остался на %d, ожидалось зеркало %d", rootID, mirrorID)
	}

	// идемпотентность: второй прогон ничего не создаёт и не ломает
	n2, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 0 {
		t.Fatalf("повторный прогон создал %d зеркал, ожидалось 0", n2)
	}
}
```

**Перед реализацией:** сверь имена колонок сида с актуальной схемой
(`users`, `chats`, `messages`, поле связи канал↔обсуждение) — они могут
отличаться от приведённых; смотри `backend/internal/store/postgres/migrations/`
и `grouprepo.go` (`SetDiscussion`). Тест должен сеять то, что реально есть.

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/store/postgres/ -run TestBackfillDiscussionMirrors -v 2>&1 | tail -20`
Expected: FAIL — `undefined: storepostgres.BackfillDiscussionMirrors`.

- [ ] **Step 3: Реализовать бэкфилл**

```go
// backend/internal/store/postgres/backfill_mirrors.go
package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BackfillDiscussionMirrors переводит треды комментариев, написанные по СТАРОЙ
// схеме (thread_root_id = id поста в канале), на Telegram-модель: создаёт
// зеркало поста в группе обсуждения и перевешивает тред на него.
//
// Идемпотентна: пары, у которых зеркало уже есть, отбрасываются (NOT EXISTS),
// поэтому повторный запуск на старте приложения ничего не делает и возвращает 0.
// Бэкфиллятся только посты, у которых есть хотя бы один комментарий — полная
// история каналов в группы не переносится (решение спеки).
func BackfillDiscussionMirrors(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// 1. Пары (пост, группа обсуждения), которым нужно зеркало, + сам пост.
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT p.id, p.chat_id, c.discussion_chat_id, p.sender_id, p.type,
		       p.text, p.entities, p.media_id, p.grouped_id, p.created_at
		  FROM messages cm
		  JOIN messages p ON p.id = cm.thread_root_id
		  JOIN chats c ON c.id = p.chat_id
		 WHERE cm.thread_root_id IS NOT NULL
		   AND cm.deleted_at IS NULL
		   AND c.type = 'channel'
		   AND c.discussion_chat_id IS NOT NULL
		   AND NOT EXISTS (
		         SELECT 1 FROM messages m
		          WHERE m.is_discussion_mirror
		            AND m.fwd_from_chat_id = p.chat_id
		            AND m.fwd_from_msg_id = p.id)`)
	if err != nil {
		return 0, err
	}
	type post struct {
		id, chatID, disc, senderID int64
		typ, text                  string
		entities                   []byte
		mediaID, groupedID         any
		createdAt                  any
	}
	var posts []post
	for rows.Next() {
		var p post
		if err := rows.Scan(&p.id, &p.chatID, &p.disc, &p.senderID, &p.typ,
			&p.text, &p.entities, &p.mediaID, &p.groupedID, &p.createdAt); err != nil {
			rows.Close()
			return 0, err
		}
		posts = append(posts, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	created := 0
	for _, p := range posts {
		// 2. seq — продолжение счётчика группы, чтобы не столкнуться с уже
		// существующими сообщениями обсуждения.
		var seq int64
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE chat_id=$1`, p.disc).Scan(&seq); err != nil {
			return 0, err
		}
		var mirrorID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO messages (chat_id, seq, sender_id, type, text, entities, media_id,
			                      grouped_id, send_as_chat_id, fwd_from_chat_id, fwd_from_msg_id,
			                      fwd_date, is_discussion_mirror)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,TRUE) RETURNING id`,
			p.disc, seq, p.senderID, p.typ, p.text, p.entities, p.mediaID,
			p.groupedID, p.chatID, p.id, p.createdAt).Scan(&mirrorID); err != nil {
			return 0, err
		}
		// 3. Перевесить тред на зеркало.
		if _, err := tx.Exec(ctx,
			`UPDATE messages SET thread_root_id=$1 WHERE thread_root_id=$2`, mirrorID, p.id); err != nil {
			return 0, err
		}
		created++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return created, nil
}
```

Связь канала с обсуждением — колонка `chats.discussion_chat_id`
(миграция `0008_discussions.sql`, см. `GroupRepo.SetDiscussion`). Типы
`entities`/`media_id`/`grouped_id`/`created_at` подставь под реальные колонки:
если `Scan` в `any` окажется неудобен для вставки, объяви точные типы
(`[]byte`, `*int64`, `*string`, `time.Time`) — это техника, а не решение.

- [ ] **Step 4: Подключить к старту**

В `backend/internal/app/providers.go::providePool`, после `postgres.Migrate` и
подключения пула — вызвать бэкфилл и залогировать число созданных зеркал;
ошибку не глотать молча (логировать, как это сделано с `SeedDemo`).

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && go test ./internal/store/postgres/ -run TestBackfill -v 2>&1 | tail -20 && go build ./...`
Expected: PASS, сборка чистая.

- [ ] **Step 6: Проверить мутацией**

Замени тело бэкфилла на `return 0, nil` — тест обязан упасть на «создано
зеркал: 0». Убери вызов из `providePool` — тест этого не заметит (он зовёт
функцию напрямую), поэтому строку вызова пометь комментарием у себя:
почему она не покрыта (точка сборки приложения) — либо покрой отдельным
тестом, если он дешёвый. Решение описать в отчёте.

- [ ] **Step 7: Коммит**

```bash
git add backend/internal/store/postgres/ backend/internal/app/providers.go
git commit -m "feat(discussion): бэкфилл зеркал для существующих тредов"
```

---

### Task 7: альбом — один тред на группу элементов

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/messagesrepo.go` (`MirrorByPost`, `MirrorsByPosts`), `backend/internal/usecase/chat/fakes_test.go` (тот же резолв в фейке)
- Test: `backend/internal/usecase/chat/discussion_mirror_test.go` (дописать), `backend/internal/adapter/repo/postgres/discussionmirror_test.go` (дописать)

**Interfaces:**
- Consumes: `MirrorByPost` (Task 2), `mirrorChannelPost` (Task 3).

**Правило:** элементы альбома — отдельные сообщения с общим `grouped_id`, и
зеркалится каждый (иначе альбом в группе будет неполным). Но тред у альбома
один: корнем считается зеркало **первого** элемента группы (минимальный `id`
среди сообщений с этим `grouped_id` в канале). Поэтому `MirrorByPost` для
ЛЮБОГО элемента альбома обязан вернуть один и тот же id — зеркало первого.
Так же ведёт себя tweb: `replies` лежат на одном сообщении альбома
(`getMessageWithCommentReplies` → `getMainGroupedMessage`).

- [ ] **Step 1: Написать падающий тест**

```go
// дописать в backend/internal/usecase/chat/discussion_mirror_test.go

// Альбом: зеркалится каждый элемент, но тред — один, на зеркале первого.
func TestAlbum_MirrorsAllElements_SingleThread(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	m1 := int64(101)
	m2 := int64(102)
	a1, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m1, GroupedID: "g1"})
	if err != nil {
		t.Fatal(err)
	}
	a2, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m2, GroupedID: "g1"})
	if err != nil {
		t.Fatal(err)
	}

	r1, err := i.msgs.MirrorByPost(ctx, ch, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := i.msgs.MirrorByPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r1 == 0 {
		t.Fatal("зеркало первого элемента альбома не создано")
	}
	if r1 != r2 {
		t.Fatalf("у альбома два корня треда: %d и %d — ожидался один (зеркало первого элемента)", r1, r2)
	}

	// но в группе лежат ОБА элемента — альбом не должен приехать обрезанным
	mirrorOf2, err := i.msgs.MirrorByPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = mirrorOf2
	root, _ := i.msgs.GetByID(ctx, r1)
	if root.GroupedID == nil || *root.GroupedID != "g1" {
		t.Fatalf("зеркало потеряло grouped_id: %v", root.GroupedID)
	}
}
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestAlbum_MirrorsAllElements -v 2>&1 | tail -20`
Expected: FAIL — «у альбома два корня треда».

- [ ] **Step 3: Научить резолв понимать альбом**

В `MirrorByPost` (и в батчевом `MirrorsByPosts`, и в фейке `fakeMsgs`): если у
поста есть `grouped_id`, резолвить зеркало не самого поста, а первого элемента
его группы. SQL-версия — подзапрос, выбирающий id корня:

```sql
WITH root AS (
  SELECT COALESCE(
    (SELECT MIN(g.id) FROM messages g
      WHERE g.chat_id = p.chat_id AND g.grouped_id = p.grouped_id AND p.grouped_id IS NOT NULL),
    p.id) AS id
    FROM messages p WHERE p.id = $2
)
SELECT m.id FROM messages m, root
 WHERE m.fwd_from_chat_id = $1 AND m.fwd_from_msg_id = root.id
   AND m.is_discussion_mirror AND m.deleted_at IS NULL
```

Комментарием у кода объяснить правило («тред у альбома один — на первом
элементе, как `getMainGroupedMessage` в tweb»).

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && go test ./internal/usecase/chat/ ./internal/adapter/repo/postgres/ 2>&1 | tail -10`
Expected: PASS — включая тесты Task 2 (одиночный пост резолвится как раньше).

- [ ] **Step 5: Дописать тот же кейс на уровне репозитория**

В `discussionmirror_test.go` — альбом из двух сообщений с общим `grouped_id` в
канале, два зеркала, `MirrorByPost` обоих элементов даёт один id;
`MirrorsByPosts([a1, a2])` даёт для обоих ключей тот же id.

- [ ] **Step 6: Коммит**

```bash
git add backend/internal/adapter/repo/postgres/ backend/internal/usecase/chat/
git commit -m "feat(discussion): у альбома один тред — на зеркале первого элемента"
```

---

### Task 8: финальная проверка пакета

**Files:** нет (проверка).

- [ ] **Step 1: Полный прогон**

Run: `cd backend && go build ./... && go vet ./... && gofmt -l . && go test ./internal/usecase/chat/... ./internal/adapter/repo/postgres/... ./internal/store/postgres/... 2>&1 | tail -20`
Expected: сборка и vet чистые, `gofmt -l .` не печатает файлов, тесты зелёные.

- [ ] **Step 2: Проверить, что HTTP-контракт не поехал**

Run: `cd backend && go test ./internal/adapter/delivery/http/... 2>&1 | tail -10`
Expected: PASS — внешний API комментариев не менялся.

- [ ] **Step 3: Зафиксировать результат в отчёте**

Перечислить: какие пути публикации покрыты тестом, что показала каждая мутация,
что осталось за периметром (синхронизация зеркала при редактировании/удалении
поста — отдельная задача по спеке).
