package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// framesSince — кадры топика канала, опубликованные после отметки.
func framesSince(t *testing.T, p *fakeChannelPublisher, mark int) []map[string]any {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]map[string]any, 0, len(p.frames)-mark)
	for _, raw := range p.frames[mark:] {
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("разбор кадра: %v", err)
		}
		env.D["t"] = env.T
		out = append(out, env.D)
	}
	return out
}

func frameMark(p *fakeChannelPublisher) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.frames)
}

// Регистрация просмотра идёт по СПИСКУ показавшихся постов, а не по горизонту
// прочтения: у ленты нет горизонта — есть набор постов, доехавших до экрана
// (tweb bubbles.ts:2129-2147 собирает его интерсектором и дебаунсит секунду,
// appMessagesManager.ts:9136-9156 шлёт его messages.getMessagesViews с
// increment:true).
//
// Счётчик растёт РОВНО ОДИН РАЗ на пару «пост + зритель»: без дедупликации
// достаточно проскроллить ленту дважды, чтобы он соврал.
func TestRegisterViews_ListedPostsOnly_DedupsAndPublishesFrame(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	seen, _ := i.PostToChannel(ctx, ch, 7, "показался", nil, "p1")
	unseen, _ := i.PostToChannel(ctx, ch, 7, "не показался", nil, "p2")

	mark := frameMark(fpub)
	counts, err := i.RegisterViews(ctx, ch, 8, []int64{seen.ID})
	if err != nil {
		t.Fatalf("RegisterViews: %v", err)
	}
	if counts[seen.ID] != 1 {
		t.Fatalf("просмотры показавшегося поста = %d, want 1", counts[seen.ID])
	}
	// Пост, которого в списке не было, просмотра не получает: это регистрация
	// ПОКАЗА, а не отметка «дочитал до сюда».
	all, _ := i.ViewCounts(ctx, []int64{unseen.ID})
	if all[unseen.ID] != 0 {
		t.Fatalf("просмотры не показывавшегося поста = %d, want 0", all[unseen.ID])
	}

	frames := framesSince(t, fpub, mark)
	if len(frames) != 1 {
		t.Fatalf("кадров о просмотрах = %d, want 1: %+v", len(frames), frames)
	}
	f := frames[0]
	if f["t"] != "views_update" {
		t.Fatalf("тип конверта = %v, want views_update", f["t"])
	}
	if f["_"] != domain.UpdateChannelMessageViewsTag {
		t.Fatalf("дискриминатор кадра = %v, want %s", f["_"], domain.UpdateChannelMessageViewsTag)
	}
	if f["channel_id"] != float64(ch) {
		t.Fatalf("channel_id = %v, want %d", f["channel_id"], ch)
	}
	// Пост адресуется НОМЕРОМ в канале, а не ключом строки.
	if f["id"] != float64(seen.Seq) {
		t.Fatalf("id поста в кадре = %v, want номер %d", f["id"], seen.Seq)
	}
	if f["views"] != float64(1) {
		t.Fatalf("views в кадре = %v, want 1", f["views"])
	}

	// Повторный показ того же поста тому же зрителю: счётчик не двигается и
	// рассылать про него нечего.
	mark = frameMark(fpub)
	counts, err = i.RegisterViews(ctx, ch, 8, []int64{seen.ID})
	if err != nil {
		t.Fatalf("повторный RegisterViews: %v", err)
	}
	if counts[seen.ID] != 1 {
		t.Fatalf("просмотры после повторного показа = %d, want 1 (дедуп)", counts[seen.ID])
	}
	if got := framesSince(t, fpub, mark); len(got) != 0 {
		t.Fatalf("повторный показ породил кадры: %+v", got)
	}

	// Второй зритель — второй просмотр.
	_ = fg.AddMember(ctx, ch, 9, domain.RoleSubscriber, 0)
	counts, _ = i.RegisterViews(ctx, ch, 9, []int64{seen.ID})
	if counts[seen.ID] != 2 {
		t.Fatalf("просмотры после второго зрителя = %d, want 2", counts[seen.ID])
	}
}

// У поста, приехавшего ЖИВЫМ кадром, тред обязан быть тем же, что у поста,
// приехавшего историей: параметр `replies` конструктора message. Прежде его
// ставил только контейнер истории, и футер «Оставить комментарий» у свежего
// поста не появлялся до перезагрузки окна.
//
// Гейт футера у оригинала — именно `replies.pFlags.comments` (tweb
// appMessagesManager.ts:9241, getMessageWithCommentReplies), поэтому флаг и
// id группы обсуждения обязаны ехать в кадре, а не выводиться клиентом.
func TestChannelPostFrame_CarriesRepliesThread(t *testing.T) {
	i, _, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}

	if _, err := i.PostToChannel(ctx, ch, 7, "пост", nil, "p1"); err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	replies, ok := fpub.lastMessage(t)["replies"].(map[string]any)
	if !ok {
		t.Fatalf("в кадре поста нет треда: %+v", fpub.lastMessage(t))
	}
	if replies["_"] != domain.MessageRepliesTag {
		t.Fatalf("тред не конструктором: %+v", replies)
	}
	if replies["replies"] != float64(0) {
		t.Fatalf("комментариев у свежего поста = %v, want 0", replies["replies"])
	}
	flags, _ := replies["pFlags"].(map[string]any)
	if flags["comments"] != true {
		t.Fatalf("нет pFlags.comments — по нему оригинал рисует футер: %+v", replies)
	}
	if replies["channel_id"] != float64(disc) {
		t.Fatalf("channel_id треда = %v, want группу обсуждения %d", replies["channel_id"], disc)
	}
}

// Пост канала БЕЗ привязанного обсуждения треда не имеет вовсе: «комментировать
// нельзя» — отсутствие параметра, а не нулевой счётчик.
func TestChannelPostFrame_NoDiscussion_NoRepliesThread(t *testing.T) {
	i, _, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if _, err := i.PostToChannel(ctx, ch, 7, "пост", nil, "p1"); err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if rep, has := fpub.lastMessage(t)["replies"]; has {
		t.Fatalf("у поста без обсуждения приехал тред: %+v", rep)
	}
}

// Счётчик комментариев ЖИВОЙ: приход комментария в группу обсуждения бампит
// `replies.replies` у поста, снятие — уменьшает. У оригинала это делает сам
// клиент (updateMessageRepliesIfNeeded, tweb appMessagesManager.ts:8658-8680,
// событие `replies_short_update` ловит лента, bubbles.ts:1137-1142), но ему
// видна вся группа обсуждения — у нас нет, поэтому отвечает сервер.
func TestComment_BumpsPostRepliesCounter(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := i.PostToChannel(ctx, ch, 7, "пост", nil, "p1")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	mark := frameMark(fpub)
	comment, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	f := repliesFrame(t, framesSince(t, fpub, mark))
	if f["channel_id"] != float64(ch) {
		t.Fatalf("channel_id = %v, want %d", f["channel_id"], ch)
	}
	if f["id"] != float64(post.Seq) {
		t.Fatalf("id поста в кадре = %v, want номер %d", f["id"], post.Seq)
	}
	if f["replies"] != float64(1) {
		t.Fatalf("комментариев в кадре = %v, want 1", f["replies"])
	}

	// Снятый комментарий уменьшает счётчик — тем же кадром.
	mark = frameMark(fpub)
	if err := i.DeleteMessage(ctx, comment.ChatID, comment.ID, 8, true); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}
	f = repliesFrame(t, framesSince(t, fpub, mark))
	if f["replies"] != float64(0) {
		t.Fatalf("комментариев после удаления = %v, want 0", f["replies"])
	}
}

// Обычное сообщение группы кадра о комментариях не порождает: тред поста
// канала и ответы в группе — разные предметы.
func TestGroupMessage_NoRepliesFrame(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	root, err := i.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "корень"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	mark := frameMark(fpub)
	if _, err := i.Send(ctx, SendInput{
		ChatID: gid, SenderID: 7, Type: "text", Text: "ответ", ThreadRootID: &root.ID,
	}); err != nil {
		t.Fatalf("Send в тред: %v", err)
	}
	for _, f := range framesSince(t, fpub, mark) {
		if f["_"] == domain.UpdateChannelMessageRepliesTag {
			t.Fatalf("ответ в группе породил кадр о комментариях поста: %+v", f)
		}
	}
}

// Счётчики поста едут С ПЕРВОЙ ПУБЛИКАЦИИ — обоими путями, каким пост доезжает
// до ленты: живым кадром `new_message` и пачкой истории. Просмотров у свежего
// поста ещё нет ни одного, и раньше это значило «параметра нет вовсе»: гейт
// наблюдения в ленте пришлось держать на виде чата вместо `message.views`
// (tweb bubbles.ts:7672), а узел `.post-views` у поста не появлялся до
// перезагрузки окна — переписывать было нечего.
func TestChannelPost_CarriesCountersFromFirstPublication(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	post, err := i.PostToChannel(ctx, ch, 7, "свежий пост", nil, "p1")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	assertPostCounters(t, "живой кадр new_message", fpub.lastMessage(t), 1, 0)
	assertPostCounters(t, "история", postFromHistory(t, i, 7, post.ID), 1, 0)

	// Нижняя граница не подменяет реальный счётчик: два зрителя — двойка обоими
	// путями. Кадр здесь не перепубликовывается (его шлёт RegisterViews),
	// поэтому живой путь проверяется на СЛЕДУЮЩЕМ посте.
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, ch, 9, domain.RoleSubscriber, 0)
	if _, err := i.RegisterViews(ctx, ch, 8, []int64{post.ID}); err != nil {
		t.Fatalf("RegisterViews зрителем 8: %v", err)
	}
	if _, err := i.RegisterViews(ctx, ch, 9, []int64{post.ID}); err != nil {
		t.Fatalf("RegisterViews зрителем 9: %v", err)
	}
	assertPostCounters(t, "история после двух зрителей", postFromHistory(t, i, 7, post.ID), 2, 0)
}

// Сообщение группы счётчиков не несёт ВООБЩЕ — ни живым кадром, ни историей.
// `views`/`forwards` есть только у поста канала: у оригинала их нет ни в личке,
// ни в группе, и раздувать каждое сообщение парой нулей значило бы платить за
// это проводом.
func TestGroupMessage_CarriesNoPostCounters(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	msg, err := i.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "привет"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	// Тело живого кадра группы уходит веером по участникам, а не в топик
	// канала, поэтому спрашивается сам производитель тела.
	body, ok := asWire(t, i.messageUpdatePayload(ctx, msg))["message"].(map[string]any)
	if !ok {
		t.Fatalf("в теле кадра нет сообщения: %+v", i.messageUpdatePayload(ctx, msg))
	}
	assertNoPostCounters(t, "живой кадр new_message", body)
	assertNoPostCounters(t, "история", postFromHistory(t, i, 7, msg.ID))
}

// postFromHistory — сообщение, каким его отдаёт ПАЧКА ИСТОРИИ: строка читается
// из хранилища заново, потому что локальная копия заведена до просмотров.
func postFromHistory(t *testing.T, i *Interactor, viewerID, msgID int64) map[string]any {
	t.Helper()
	rows, err := i.msgs.GetByIDs(context.Background(), []int64{msgID})
	if err != nil || len(rows) != 1 {
		t.Fatalf("GetByIDs = %d, %v", len(rows), err)
	}
	wire, _, err := i.MessagesContainer(context.Background(), viewerID, rows)
	if err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	return asWire(t, wire[0])
}

// asWire — объект в виде обычной карты JSON. Нужен потому, что тела кадров
// приезжают из ToWireMap с числами json.Number, а разобранный кадр — с float64:
// сравнивать их одним утверждением можно, только приведя к одной форме.
func asWire(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	return out
}

func assertPostCounters(t *testing.T, where string, wire map[string]any, views, forwards float64) {
	t.Helper()
	if wire["views"] != views {
		t.Errorf("%s: просмотры = %#v, ждали %v", where, wire["views"], views)
	}
	if wire["forwards"] != forwards {
		t.Errorf("%s: репосты = %#v, ждали %v (бит у пары ОДИН, flags.10)", where, wire["forwards"], forwards)
	}
}

func assertNoPostCounters(t *testing.T, where string, wire map[string]any) {
	t.Helper()
	for _, key := range []string{"views", "forwards"} {
		if v, ok := wire[key]; ok {
			t.Errorf("%s: у сообщения вне канала приехал %q = %#v", where, key, v)
		}
	}
}

// repliesFrame — единственный кадр updateChannelMessageReplies среди пачки.
func repliesFrame(t *testing.T, frames []map[string]any) map[string]any {
	t.Helper()
	var out map[string]any
	for _, f := range frames {
		if f["_"] != domain.UpdateChannelMessageRepliesTag {
			continue
		}
		if out != nil {
			t.Fatalf("кадров о комментариях больше одного: %+v", frames)
		}
		if f["t"] != "replies_update" {
			t.Fatalf("тип конверта = %v, want replies_update", f["t"])
		}
		out = f
	}
	if out == nil {
		t.Fatalf("кадра о комментариях нет вовсе: %+v", frames)
	}
	return out
}
