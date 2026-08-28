package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// countingMsgs считает обращения к счётчикам треда: тест «за чем в базу НЕ
// ходили» иначе не написать — отсутствие запроса ничем другим не наблюдаемо.
type countingMsgs struct {
	MessageRepo
	threadCounts int
	mirrors      int
	viewCounts   int
}

func (c *countingMsgs) ThreadReplyCounts(ctx context.Context, chatID int64, rootIDs []int64) (map[int64]int, error) {
	c.threadCounts++
	return c.MessageRepo.ThreadReplyCounts(ctx, chatID, rootIDs)
}

func (c *countingMsgs) MirrorsByPosts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]int64, error) {
	c.mirrors++
	return c.MessageRepo.MirrorsByPosts(ctx, channelID, postIDs)
}

func (c *countingMsgs) ViewCounts(ctx context.Context, ids []int64) (map[int64]int64, error) {
	c.viewCounts++
	return c.MessageRepo.ViewCounts(ctx, ids)
}

// wireOf — сообщение пачки как оно уедет на провод (карта ключей, а не
// структура: проверяем именно ОТСУТСТВИЕ ключей у необязательных параметров).
func wireOf(t *testing.T, m domain.MTMessage) map[string]any {
	t.Helper()
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("сериализация сообщения: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("разбор сообщения: %v", err)
	}
	return out
}

// Пост канала В ИСТОРИИ несёт и просмотры, и тред — без второго похода клиента
// в /view_counts и /comment_counts. Прежде оба параметра конструктора `message`
// уезжали пустыми всегда, и футер «N комментариев» рисовать было не из чего.
func TestMessagesContainer_ChannelPostCarriesViewsAndThread(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Автор"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}

	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if _, err := in.PostComment(ctx, ch, post.ID, 8, "комментарий", "k1"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// просмотр поста читателем 8 — та же колонка messages.views, из которой
	// читает и отдельная ручка /view_counts
	if err := in.msgs.RegisterChannelViews(ctx, ch, 8, post.Seq); err != nil {
		t.Fatalf("RegisterChannelViews: %v", err)
	}
	// история читает строку заново — локальная копия post заведена до просмотра
	rows, err := in.msgs.GetByIDs(ctx, []int64{post.ID})
	if err != nil || len(rows) != 1 {
		t.Fatalf("GetByIDs = %d, %v", len(rows), err)
	}

	wire, users, err := in.MessagesContainer(ctx, 7, rows)
	if err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	got := wireOf(t, wire[0])
	if got["views"] != float64(1) {
		t.Fatalf("просмотры поста в истории = %v, ждали 1: %v", got["views"], got)
	}
	replies, ok := got["replies"].(map[string]any)
	if !ok {
		t.Fatalf("у поста канала нет треда: %v", got)
	}
	if replies["_"] != domain.MessageRepliesTag || replies["replies"] != float64(1) {
		t.Fatalf("тред поста = %v, ждали messageReplies с одним комментарием", replies)
	}
	// Группа обсуждения и флаг comments делят бит: без них клиент не отличит
	// футер «N комментариев» от счётчика ответов в группе.
	if replies["channel_id"] != float64(disc) {
		t.Fatalf("тред без ссылки на группу обсуждения %d: %v", disc, replies)
	}
	if pf, _ := replies["pFlags"].(map[string]any); pf["comments"] != true {
		t.Fatalf("тред поста без pFlags.comments: %v", replies)
	}
	// Автор последнего комментария — ССЫЛКА внутри треда, карточка едет рядом.
	if len(users) == 0 {
		t.Fatalf("контейнер приехал без карточек")
	}
}

// Личный чат за счётчиками треда в базу НЕ ходит: у переписки двух людей
// предмета нет вовсе, а запрос был бы на каждое открытие чата.
func TestMessagesContainer_PrivateChatAsksNoCounters(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	counter := &countingMsgs{MessageRepo: fakeMsgs{s}}
	in.msgs = counter

	chatID, err := in.CreatePrivateChat(ctx, a, b)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	msgs := []domain.Message{{ID: 1, ChatID: chatID, Seq: 1, SenderID: a, Text: "привет"}}
	if _, _, err := in.MessagesContainer(ctx, a, msgs); err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	if counter.threadCounts != 0 || counter.mirrors != 0 || counter.viewCounts != 0 {
		t.Fatalf("личный чат сходил за счётчиками: треды=%d зеркала=%d просмотры=%d",
			counter.threadCounts, counter.mirrors, counter.viewCounts)
	}

	// Контрольный выстрел: тот же счётчик обязан щёлкнуть в ГРУППЕ — иначе
	// проверка выше зелена и у сломанной подстановки треда.
	const groupID int64 = 77
	s.seedChat(groupID, domain.ChatTypeGroup, a, b)
	group := []domain.Message{{ID: 2, ChatID: groupID, Seq: 1, SenderID: a, Text: "тема"}}
	if _, _, err := in.MessagesContainer(ctx, a, group); err != nil {
		t.Fatalf("MessagesContainer группы: %v", err)
	}
	if counter.threadCounts != 1 {
		t.Fatalf("группа не спросила счётчики тредов: %d", counter.threadCounts)
	}
}

// Сообщение ГРУППЫ с тредом несёт число ответов — это и есть счётчик у времени
// бабла (tweb bubbles.ts:9699 → setBubbleRepliesCount, :6410). Ни флага
// comments, ни channel_id тут нет: комментарии канала — другой предмет.
func TestMessagesContainer_GroupThreadCarriesReplyCount(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Автор"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}

	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if _, err := in.PostComment(ctx, ch, post.ID, 8, "раз", "k1"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	if _, err := in.PostComment(ctx, ch, post.ID, 8, "два", "k2"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// зеркало поста в группе обсуждения — корень треда, и в истории ГРУППЫ оно
	// обычное сообщение
	mirrorID, err := in.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || mirrorID == 0 {
		t.Fatalf("MirrorByPost = %d, %v", mirrorID, err)
	}
	rows, err := in.msgs.GetByIDs(ctx, []int64{mirrorID})
	if err != nil || len(rows) != 1 {
		t.Fatalf("GetByIDs = %d, %v", len(rows), err)
	}
	if rows[0].ChatID != disc {
		t.Fatalf("зеркало лежит в чате %d, а не в группе обсуждения %d", rows[0].ChatID, disc)
	}

	wire, _, err := in.MessagesContainer(ctx, 7, rows)
	if err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	got := wireOf(t, wire[0])
	replies, ok := got["replies"].(map[string]any)
	if !ok {
		t.Fatalf("у сообщения группы с тредом нет счётчика ответов: %v", got)
	}
	if replies["replies"] != float64(2) {
		t.Fatalf("ответов в треде = %v, ждали 2: %v", replies["replies"], replies)
	}
	if _, has := replies["channel_id"]; has {
		t.Fatalf("счётчик ответов группы притворился комментариями канала: %v", replies)
	}
	if _, has := replies["pFlags"]; has {
		t.Fatalf("счётчик ответов группы уехал с флагом comments: %v", replies)
	}
}

// Карточки авторов последних комментариев не теряются при слиянии векторов:
// тред несёт на них ССЫЛКИ, и вектор users контейнера обязан их подкрепить —
// иначе стек аватаров в футере рисовать нечем. Дубликатов при этом нет: автор
// поста и комментатор — один вектор, по карточке на человека.
func TestMessagesContainer_MergesRecentRepliersIntoUsers(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Автор"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}
	fg.users[9] = domain.UserReal{ID: 9, FirstName: "Алиса"}

	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := in.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	for _, c := range []struct {
		user int64
		key  string
	}{{8, "k1"}, {9, "k2"}} {
		if _, err := in.PostComment(ctx, ch, post.ID, c.user, "комментарий", c.key); err != nil {
			t.Fatalf("PostComment %d: %v", c.user, err)
		}
	}
	rows, err := in.msgs.GetByIDs(ctx, []int64{post.ID})
	if err != nil || len(rows) != 1 {
		t.Fatalf("GetByIDs = %d, %v", len(rows), err)
	}

	wire, users, err := in.MessagesContainer(ctx, 7, rows)
	if err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	seen := map[int64]bool{}
	for _, u := range users {
		if seen[u.ID] {
			t.Fatalf("карточка %d продублирована в векторе users: %v", u.ID, users)
		}
		seen[u.ID] = true
	}
	if !seen[7] {
		t.Fatalf("автор поста потерялся при слиянии: %v", users)
	}
	body, ok := wire[0].(domain.MessageReal)
	if !ok || body.Replies == nil {
		t.Fatalf("у поста нет треда: %#v", wire[0])
	}
	if len(body.Replies.RecentRepliers) == 0 {
		t.Fatalf("тред без ссылок на последних комментаторов: %+v", body.Replies)
	}
	for _, p := range body.Replies.RecentRepliers {
		if !seen[p.PeerID().ToUserID()] {
			t.Fatalf("ссылка на комментатора %v не подкреплена карточкой: %v", p, users)
		}
	}
}
