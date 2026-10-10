package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestChannelFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990002001")
	tokenB, _ := signUp(t, h, pool, "+79990002002")

	// A creates a public channel with a username.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Go News Daily", "username": "gonews", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// Creator posts → 200 + адрес поста (id = номер в канале).
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "hello world", "client_msg_id": "c1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("creator post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		Underscore string `json:"_"`
		ID         int64  `json:"id"`
		PeerID     struct {
			Underscore string `json:"_"`
			ChannelID  int64  `json:"channel_id"`
		} `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	// Созданный пост — тот же конструктор `message`, что и любое сообщение:
	// своей формы («адрес тройкой полей») у него больше нет.
	if post.Underscore != "message" || post.ID == 0 {
		t.Fatalf("пост = %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"seq"`) {
		t.Fatalf("в ответе осталось второе число: %s", rec.Body.String())
	}
	if domain.ToPeerID(post.PeerID.ChannelID, true) != domain.PeerID(createdPeerID) {
		t.Fatalf("post chat_id = %+v; want %d", post.PeerID, createdPeerID)
	}

	// A second post so difference has more than one entry.
	_ = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "second"})

	// updates.getChannelDifference от pts первого поста (журнал канала
	// начинается с 1 — первый пост 2) — второй пост, свёрнутый в
	// new_messages, final, pts журнала.
	rec = authedReq(t, h, http.MethodGet, "/updates/channel_difference?channel="+cid+"&pts=2&limit=100", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("channel difference: %d %s", rec.Code, rec.Body.String())
	}
	var diff struct {
		Underscore  string          `json:"_"`
		PFlags      map[string]bool `json:"pFlags"`
		Pts         int64           `json:"pts"`
		NewMessages []struct {
			ID      int64  `json:"id"`
			Message string `json:"message"`
		} `json:"new_messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &diff)
	if diff.Underscore != "updates.channelDifference" || !diff.PFlags["final"] || diff.Pts != 3 ||
		len(diff.NewMessages) != 1 || diff.NewMessages[0].Message != "second" {
		t.Fatalf("channel difference = %s", rec.Body.String())
	}
	// Частота разницы канала на пару «пользователь + канал»: сверх запаса —
	// 420 FLOOD_WAIT_N, как у оригинала (клиент ждёт и повторяет).
	flood := ""
	for k := 0; k < 10 && flood == ""; k++ {
		rec = authedReq(t, h, http.MethodGet, "/updates/channel_difference?channel="+cid+"&pts=2", tokenA, nil)
		if rec.Code == 420 {
			flood = rec.Body.String()
		}
	}
	if !strings.Contains(flood, "FLOOD_WAIT_") {
		t.Fatalf("10 разниц канала подряд без FLOOD_WAIT: последний ответ %d %s", rec.Code, rec.Body.String())
	}

	// История канала — messages.channelMessages с pts журнала.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/history", tokenB, nil)
	if !strings.Contains(rec.Body.String(), `"_":"messages.channelMessages"`) || !strings.Contains(rec.Body.String(), `"pts":3`) {
		t.Fatalf("история канала: %s", rec.Body.String())
	}

	// search?q= finds the public channel by username.
	rec = authedReq(t, h, http.MethodGet, "/search?q=gonews", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("search: %d %s", rec.Code, rec.Body.String())
	}
	var search struct {
		Chats []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &search)
	if len(search.Chats) != 1 || search.Chats[0].Username != "gonews" {
		t.Fatalf("search chats = %+v (%s)", search.Chats, rec.Body.String())
	}

	// B joins by username → 200, and the card's member_count grows.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	before := decodeCard(t, rec)

	rec = authedReq(t, h, http.MethodPost, "/channels/join", tokenB, map[string]any{"username": "gonews"})
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("card after join: %d %s", rec.Code, rec.Body.String())
	}
	after := decodeCard(t, rec)
	if after.participants() != before.participants()+1 {
		t.Fatalf("participants_count = %d; want %d", after.participants(), before.participants()+1)
	}

	// B (a subscriber) cannot post → 403.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenB, map[string]any{"text": "nope"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("subscriber post: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// B офлайн: запомнил состояние, A публикует пост. Догонка B — маркер
	// updateChannelTooLong{channel_id, pts} в other_updates (tweb
	// apiUpdatesManager.ts:354), посты канала пер-юзерный журнал не несёт.
	rec = authedReq(t, h, http.MethodGet, "/updates/state", tokenB, nil)
	var st struct {
		Pts  int64 `json:"pts"`
		Date int64 `json:"date"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	time.Sleep(1100 * time.Millisecond) // date — секунды: пост строго позже
	_ = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "пока B не было"})
	// date ответа — секунды, и маркер берётся с запасом 2 с
	// (channelChangedSlack): пост ближе к ответу повторил бы маркер ещё раз
	// (лишний, но безвредный getChannelDifference) — разносим.
	time.Sleep(3100 * time.Millisecond)
	// Текущий pts журнала канала — из его истории (messages.channelMessages).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/history", tokenB, nil)
	var hist struct {
		Pts int64 `json:"pts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	rec = authedReq(t, h, http.MethodGet, "/updates/difference?pts="+itoa(st.Pts)+"&date="+itoa(st.Date), tokenB, nil)
	var gd struct {
		Underscore   string `json:"_"`
		OtherUpdates []struct {
			Underscore string `json:"_"`
			ChannelID  int64  `json:"channel_id"`
			Pts        int64  `json:"pts"`
		} `json:"other_updates"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &gd)
	marker := false
	for _, u := range gd.OtherUpdates {
		marker = marker || (u.Underscore == "updateChannelTooLong" &&
			domain.ToPeerID(u.ChannelID, true) == domain.PeerID(createdPeerID) && u.Pts == hist.Pts)
	}
	if !marker {
		t.Fatalf("getDifference после поста в канале: %s, want updateChannelTooLong{pts:%d}", rec.Body.String(), hist.Pts)
	}
	// Следующая догонка от нового date маркера уже не несёт.
	var next struct {
		State struct {
			Pts  int64 `json:"pts"`
			Date int64 `json:"date"`
		} `json:"state"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &next)
	rec = authedReq(t, h, http.MethodGet, "/updates/difference?pts="+itoa(next.State.Pts)+"&date="+itoa(next.State.Date), tokenB, nil)
	if strings.Contains(rec.Body.String(), "updateChannelTooLong") {
		t.Fatalf("маркер канала повторился без новых постов: %s", rec.Body.String())
	}
}

func TestChannelDiscussion_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990003001")
	tokenB, _ := signUp(t, h, pool, "+79990003002")

	// A creates a public channel.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss Channel", "username": "discusschan", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// A posts → capture the post message id.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "discuss this", "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	if post.ID == 0 {
		t.Fatalf("expected post id, got %s", rec.Body.String())
	}
	pid := itoa(post.ID)

	// A enables discussion.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	if disc == 0 {
		t.Fatalf("expected discussion_peer_id, got %s", rec.Body.String())
	}

	// B posts a comment on the post → 200.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, map[string]any{
		"text": "nice post", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}
	// Корень треда — номер ЗЕРКАЛА в ГРУППЕ ОБСУЖДЕНИЯ, а не номер поста в
	// канале: пара «пир + номер» полна только внутри одного пира. Зеркало
	// появилось в группе первым, поэтому его номер — 1.
	if top := threadTop(t, rec.Body.Bytes()); top == nil || *top != 1 {
		t.Fatalf("reply_to_top_id = %v; want номер зеркала 1 (%s)", top, rec.Body.String())
	}

	// GET comments → 1 message + count 1.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list comments: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Messages []json.RawMessage `json:"messages"`
		Count    int               `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Messages) != 1 || list.Count != 1 {
		t.Fatalf("list comments = %d msgs / count %d; want 1/1 (%s)", len(list.Messages), list.Count, rec.Body.String())
	}

	// comment_counts?ids={postId} → 1.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/comment_counts?ids="+pid, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("comment_counts: %d %s", rec.Code, rec.Body.String())
	}
	// Контейнер `messages.messageViews`: вектор ПОЗИЦИОННЫЙ (i-й элемент —
	// i-му номеру запроса), тред внутри конструктором messageReplies, карточки
	// авторов ОДНИМ вектором users, а не вклеенными в каждый пост.
	cc := decodeViews(t, rec)
	if cc.Underscore != "messages.messageViews" || len(cc.Views) != 1 {
		t.Fatalf("comment_counts = %s", rec.Body.String())
	}
	first := cc.Views[0]
	if first.Underscore != "messageViews" || first.Replies == nil || first.Replies.Replies != 1 {
		t.Fatalf("тред поста = %s", rec.Body.String())
	}
	if len(first.Replies.RecentRepliers) != 1 || len(cc.Users) != 1 {
		t.Fatalf("recent_repliers = %+v, users = %+v; ждали ссылку + карточку один раз",
			first.Replies.RecentRepliers, cc.Users)
	}
	if first.Replies.RecentRepliers[0].UserID != cc.Users[0].ID {
		t.Fatalf("ссылка %d не подкреплена карточкой %d", first.Replies.RecentRepliers[0].UserID, cc.Users[0].ID)
	}
	// Просмотры едут ТЕМ ЖЕ контейнером: у оригинала и просмотры, и тред это
	// параметры одного конструктора `messageViews`.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/view_counts?ids="+pid, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("view_counts: %d %s", rec.Code, rec.Body.String())
	}
	vc := decodeViews(t, rec)
	if vc.Underscore != "messages.messageViews" || len(vc.Views) != 1 || vc.Views[0].Views == nil {
		t.Fatalf("view_counts = %s", rec.Body.String())
	}
	// Ключом номер поста больше не служит: карты в теле нет.
	if strings.Contains(rec.Body.String(), `"counts"`) {
		t.Fatalf("карта счётчиков осталась на проводе: %s", rec.Body.String())
	}
	// Неизвестный номер — конструктор БЕЗ параметров, а не ноль: пробел
	// позиционного вектора выражается отсутствием значений.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/view_counts?ids=999999", tokenB, nil)
	gap := decodeViews(t, rec)
	if len(gap.Views) != 1 || gap.Views[0].Views != nil || gap.Views[0].Replies != nil {
		t.Fatalf("пробел вектора = %s", rec.Body.String())
	}
}

// viewsWire — контейнер счётчиков поста: `messages.messageViews`.
type viewsWire struct {
	Underscore string `json:"_"`
	Views      []struct {
		Underscore string `json:"_"`
		Views      *int64 `json:"views"`
		Replies    *struct {
			Underscore     string `json:"_"`
			Replies        int    `json:"replies"`
			RecentRepliers []struct {
				UserID int64 `json:"user_id"`
			} `json:"recent_repliers"`
		} `json:"replies"`
	} `json:"views"`
	Users []struct {
		ID int64 `json:"id"`
	} `json:"users"`
}

func decodeViews(t *testing.T, rec *httptest.ResponseRecorder) viewsWire {
	t.Helper()
	var out viewsWire
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("счётчики не разбираются: %v (%s)", err, rec.Body.String())
	}
	return out
}

// threadTop — корень треда, как он реально уезжает: messageReplyHeader.
// reply_to_top_id внутри самого сообщения. Отдельного поля thread_root_id в
// схеме нет вовсе, и корень ВСЕГДА в том же пире, что и сообщение: у
// комментария это номер ЗЕРКАЛА поста в группе обсуждения.
func threadTop(t *testing.T, raw []byte) *int64 {
	t.Helper()
	var m struct {
		ReplyTo *struct {
			ReplyToTopID *int64 `json:"reply_to_top_id"`
		} `json:"reply_to"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("разбор сообщения: %v (%s)", err, raw)
	}
	if m.ReplyTo == nil {
		return nil
	}
	return m.ReplyTo.ReplyToTopID
}

// discussionRoot — номер корня треда комментариев поста (зеркала в группе
// обсуждения) через GET /channels/{ch}/posts/{post}/discussion — порт
// messages.getDiscussionMessage: им клиент дальше адресует тред.
func discussionRoot(t *testing.T, h http.Handler, token, cid string, postSeq int64) int64 {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/channels/"+cid+"/posts/"+itoa(postSeq)+"/discussion", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("discussion message: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Messages []struct {
			ID int64 `json:"id"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Messages) != 1 || out.Messages[0].ID == 0 {
		t.Fatalf("discussion message: want ровно одно зеркало, got %s", rec.Body.String())
	}
	return out.Messages[0].ID
}

// Комментарий обязан нести ОДИН И ТОТ ЖЕ корень треда что через
// /comments, что через generic-историю группы обсуждения (GET
// /chats/{id}/history?thread_root=<номер зеркала>) — именно так клиент
// читает тред комментариев (как tweb: тред адресуется номером зеркала из
// getDiscussionMessage). Плюс: (b) GET /discussion отдаёт то же зеркало, и
// чтение по его номеру находит комментарий, и (c) редактирование не меняет
// наружный номер корня.
func TestComments_ThreadRootID_ConsistentAcrossHTTPPaths(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990005001")
	tokenB, _ := signUp(t, h, pool, "+79990005002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss3", "username": "discusschan3", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "discuss this too", "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	pid := itoa(post.ID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	discCid := itoa(disc)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, map[string]any{
		"text": "nice", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)
	viaComments := threadTop(t, rec.Body.Bytes())
	if viaComments == nil {
		t.Fatalf("POST /comments не отдал корень треда: %s", rec.Body.String())
	}

	// (b) корень из GET /discussion — тот же номер, что reply_to_top_id
	// комментария, и generic-история группы по нему находит комментарий.
	if root := discussionRoot(t, h, tokenB, cid, post.ID); root != *viaComments {
		t.Fatalf("GET /discussion = %d, want %d (reply_to_top_id комментария)", root, *viaComments)
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(*viaComments), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("generic history: %d %s", rec.Code, rec.Body.String())
	}
	var hist struct {
		Count    int               `json:"count"`
		Messages []json.RawMessage `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	found := false
	for _, raw := range hist.Messages {
		var m struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(raw, &m)
		if m.ID != comment.ID {
			continue
		}
		found = true
		// (a) тот же корень, что и через /comments.
		if top := threadTop(t, raw); top == nil || *top != *viaComments {
			t.Fatalf("generic history reply_to_top_id = %v, want %d (как в /comments)", top, *viaComments)
		}
	}
	if !found {
		t.Fatalf("комментарий %d не найден в generic-истории (%d сообщений, count=%d): %s",
			comment.ID, len(hist.Messages), hist.Count, rec.Body.String())
	}

	// (c) редактирование не меняет наружный id треда.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+discCid+"/messages/"+itoa(comment.ID), tokenB, map[string]any{
		"text": "nice (edited)",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit comment: %d %s", rec.Code, rec.Body.String())
	}
	if top := threadTop(t, rec.Body.Bytes()); top == nil || *top != *viaComments {
		t.Fatalf("edited comment reply_to_top_id = %v, want %d", top, *viaComments)
	}
}

// Блокер 2 (финальное ревью 2026-08-14): generic-история треда
// (?thread_root=<номер зеркала>) не должна возвращать текст поста дважды:
// зеркало (копия поста, включая текст) приезжает в выборке само (SQL:
// thread_root_id=root OR id=root). Раньше
// prependForeignThreadRoot сверялась по СЫРОМУ id поста, а не по id
// зеркала — совпадения не находила и синтетически подшивала СВЕРХУ ещё и
// оригинал поста из канала: тот же текст приезжал клиенту дважды.
func TestComments_ThreadRootHistory_RootAppearsOnce(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990006001")
	tokenB, _ := signUp(t, h, pool, "+79990006002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss4", "username": "discusschan4", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	const postText = "уникальный текст поста для проверки дубликата в треде"
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": postText, "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	pid := itoa(post.ID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	discCid := itoa(disc)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, map[string]any{
		"text": "первый комментарий", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}

	root := discussionRoot(t, h, tokenB, cid, post.ID)
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(root), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("generic history: %d %s", rec.Code, rec.Body.String())
	}
	var hist struct {
		Messages []struct {
			ID int64 `json:"id"`
			// Текст сообщения на проводе называется message — так он назван в
			// схеме, где ключа text вообще не существует.
			Message string `json:"message"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	n := 0
	for _, m := range hist.Messages {
		if m.Message == postText {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("текст поста встречается в истории треда %d раз(а), want ровно 1: %s", n, rec.Body.String())
	}
}

// Блокер 4 (финальное ревью 2026-08-14): generic-отправка (POST
// /chats/{chatID}/messages, тот же путь, которым идёт WS send_message) с
// thread_root_id = номер ЗЕРКАЛА обязана приземлить сообщение в тот же тред,
// что и штатный POST /channels/{ch}/posts/{id}/comments: номер переводится в
// ключ строки на входе (ResolveThreadRootForSend), а не уходит в INSERT как есть.
func TestGenericSend_ThreadRootID_MirrorSeq_LandsInSameThreadAsComments(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990007001")
	tokenB, _ := signUp(t, h, pool, "+79990007002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss5", "username": "discusschan5", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "discuss via generic send", "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	pid := post.ID

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	discCid := itoa(disc)

	// Сперва штатный /comments — заводит зеркало поста и оставляет "эталонный"
	// комментарий, с которым сравниваем thread_root_id ниже.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+itoa(pid)+"/comments", tokenB, map[string]any{
		"text": "через /comments", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}
	viaComments := threadTop(t, rec.Body.Bytes())
	if viaComments == nil {
		t.Fatalf("/comments не отдал корень треда: %s", rec.Body.String())
	}

	// Тот же тред, но generic-путём: thread_root_id в теле = номер зеркала.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "через generic send", "thread_root_id": *viaComments, "client_msg_id": "k2",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("generic send: %d %s", rec.Code, rec.Body.String())
	}
	var viaGeneric struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &viaGeneric)
	if top := threadTop(t, rec.Body.Bytes()); top == nil || *top != *viaComments {
		t.Fatalf("generic send reply_to_top_id = %v, want %d (тот же тред, что и через /comments)", top, *viaComments)
	}

	// И физически лежит в том же треде — виден через /comments наравне с первым.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/posts/"+itoa(pid)+"/comments", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list comments: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Messages []struct {
			ID int64 `json:"id"`
		} `json:"messages"`
		Count int `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	found := false
	for _, m := range list.Messages {
		if m.ID == viaGeneric.ID {
			found = true
		}
	}
	if !found || list.Count != 2 {
		t.Fatalf("generic-сообщение %d не в треде комментариев (count=%d): %s", viaGeneric.ID, list.Count, rec.Body.String())
	}
}

// Critical (ре-ревью 2026-08-15): generic-send с thread_root_id = id ДОМИГРАЦИОННОГО
// поста (опубликован ДО EnableDiscussion, зеркала ещё нет) раньше писал sentinel
// 0 в thread_root_id (ResolveThreadRootForSend переиспользовала
// resolveThreadRootForQuery, который для ЧТЕНИЯ безопасно кодирует «зеркала нет»
// указателем на 0 — но на ЗАПИСИ этот 0 реально уходит в INSERT, а не остаётся
// признаком «треда нет»). Итог на живом стенде: у комментариев к ДВУМ разным
// домиграционным постам оказывался ОДИНАКОВЫЙ thread_root_id=0 — треды
// схлопывались в один.
//
// Теперь зеркало домиграционного поста дозаводит GET /discussion (порт
// messages.getDiscussionMessage — им клиент узнаёт номер корня треда), а
// generic-send берёт номер корня в группе как есть. Проверяем: (а) корни двух
// постов разные и не 0, generic-send и штатный POST /comments приземляют
// комментарий в один тред; (б) треды не схлопываются — GET
// /history?thread_root=<корень post1> отдаёт только свой; (в) несуществующий
// корень — 404, а не sentinel 0 в INSERT.
func TestGenericSend_ThreadRootID_PreMigrationPost_NoSentinelZeroCollapse(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990008001")
	tokenB, _ := signUp(t, h, pool, "+79990008002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss6", "username": "discusschan6", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// Два поста ДО EnableDiscussion — зеркал ещё не существует ни у одного.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "post one", "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post1: %d %s", rec.Code, rec.Body.String())
	}
	var post1 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post1)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "post two", "client_msg_id": "p2",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post2: %d %s", rec.Code, rec.Body.String())
	}
	var post2 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post2)
	if post1.ID == 0 || post2.ID == 0 || post1.ID == post2.ID {
		t.Fatalf("посты некорректны: post1=%d post2=%d", post1.ID, post2.ID)
	}

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	discCid := itoa(disc)

	// Зеркала ОБОИХ домиграционных постов дозаводятся лениво — открытием треда.
	root1 := discussionRoot(t, h, tokenB, cid, post1.ID)
	root2 := discussionRoot(t, h, tokenB, cid, post2.ID)
	if root1 == root2 {
		t.Fatalf("корни тредов совпали (%d) — треды схлопнулись", root1)
	}
	if again := discussionRoot(t, h, tokenB, cid, post1.ID); again != root1 {
		t.Fatalf("повторный GET /discussion завёл второе зеркало: %d != %d", again, root1)
	}

	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "comment on post1", "thread_root_id": root1, "client_msg_id": "c1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("generic send к post1: %d %s", rec.Code, rec.Body.String())
	}
	var c1 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &c1)
	top1 := threadTop(t, rec.Body.Bytes())
	if top1 == nil || *top1 != root1 {
		t.Fatalf("корень треда комментария к post1 = %v, want %d", top1, root1)
	}

	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "comment on post2", "thread_root_id": root2, "client_msg_id": "c2",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("generic send к post2: %d %s", rec.Code, rec.Body.String())
	}
	var c2 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &c2)
	top2 := threadTop(t, rec.Body.Bytes())
	if top2 == nil || *top2 != root2 {
		t.Fatalf("корень треда комментария к post2 = %v, want %d", top2, root2)
	}

	// (в) корня с таким номером в группе нет — 404, а не запись sentinel 0.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "в никуда", "thread_root_id": root2 + 1000, "client_msg_id": "c3",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("generic send в несуществующий корень: %d %s, want 404", rec.Code, rec.Body.String())
	}

	// (а) тот же тред, что и штатный /comments.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+itoa(post1.ID)+"/comments", tokenB, map[string]any{
		"text": "via comments", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("/comments к post1: %d %s", rec.Code, rec.Body.String())
	}
	if top := threadTop(t, rec.Body.Bytes()); top == nil || *top != *top1 {
		t.Fatalf("/comments reply_to_top_id = %v, want %d — разошлось с generic-send", top, *top1)
	}

	// (б) треды НЕ схлопнулись: history для post1 не содержит комментарий post2 и наоборот.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(root1), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("history post1: %d %s", rec.Code, rec.Body.String())
	}
	var hist1 struct {
		Messages []struct {
			ID int64 `json:"id"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist1)
	for _, m := range hist1.Messages {
		if m.ID == c2.ID {
			t.Fatalf("тред post1 содержит комментарий post2 (%d) — треды схлопнулись: %s", c2.ID, rec.Body.String())
		}
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(root2), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("history post2: %d %s", rec.Code, rec.Body.String())
	}
	var hist2 struct {
		Messages []struct {
			ID int64 `json:"id"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist2)
	for _, m := range hist2.Messages {
		if m.ID == c1.ID {
			t.Fatalf("тред post2 содержит комментарий post1 (%d) — треды схлопнулись: %s", c1.ID, rec.Body.String())
		}
	}
}

// Minor-регрессия (ре-ревью 2026-08-15): фикс дублирования корня (см.
// TestComments_ThreadRootHistory_RootAppearsOnce) по пути снял проверку
// «корень физически в этом же чате» в prependForeignThreadRoot — зеркало,
// скрытое персонально для читателя через message_hides («удалить у себя»),
// снова принудительно показывалось первым сообщением окна, хотя видимость
// его явно исключила. Проверяем: комментатор, скрывший у себя зеркало поста
// («delete for me»), НЕ видит его текст, синтетически подшитым сверху
// generic-истории треда.
func TestCommentThreadHistory_HiddenMirrorRoot_NotForceShown(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990009001")
	tokenB, _ := signUp(t, h, pool, "+79990009002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss7", "username": "discusschan7", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	const postText = "пост со скрываемым зеркалом"
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": postText, "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	disc := linkedPeerOf(t, h, tokenA, cid)
	discCid := itoa(disc)

	// B комментирует — заводит зеркало и авто-вступает в группу обсуждения.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+itoa(post.ID)+"/comments", tokenB, map[string]any{
		"text": "comment", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)

	// Достаём реальный id зеркала — физический msg_id виден в generic-истории
	// группы (не переводится, в отличие от thread_root_id).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("full history: %d %s", rec.Code, rec.Body.String())
	}
	var full struct {
		Messages []struct {
			ID      int64  `json:"id"`
			Text    string `json:"text"`
			FwdFrom *struct {
				ChannelPost int64 `json:"channel_post"`
			} `json:"fwd_from"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &full)
	var mirrorID int64
	for _, m := range full.Messages {
		if m.FwdFrom != nil && m.FwdFrom.ChannelPost == post.ID {
			mirrorID = m.ID
		}
	}
	if mirrorID == 0 {
		t.Fatalf("зеркало не найдено в истории группы: %s", rec.Body.String())
	}

	// B прячет зеркало у себя ("удалить для меня" — message_hides, не soft-delete).
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+discCid+"/messages/"+itoa(mirrorID), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("hide mirror for me: %d %s", rec.Code, rec.Body.String())
	}

	// Читаем тред тем же generic-путём, каким клиент открывает комментарии —
	// зеркало скрыто персонально для B и НЕ обязано принудительно вернуться.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(mirrorID), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("thread history: %d %s", rec.Code, rec.Body.String())
	}
	var hist struct {
		Messages []struct {
			ID   int64  `json:"id"`
			Text string `json:"text"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	for _, m := range hist.Messages {
		if m.ID == mirrorID || m.Text == postText {
			t.Fatalf("скрытое у себя зеркало снова принудительно показано: %s", rec.Body.String())
		}
	}
}

func TestChannelAdmin_DiscussionAndSignatures_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990004001")

	// A creates a channel.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{"title": "Ch"})
	chPeerID := createdPeerID(t, rec)
	cid := itoa(chPeerID)

	// A creates a plain group (discussion candidate).
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Talk"})
	grpPeerID := createdPeerID(t, rec)
	gid := grpPeerID

	// discussion_candidates lists the group.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/discussion_candidates", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("candidates: %d %s", rec.Code, rec.Body.String())
	}
	// Кандидаты — КАРТОЧКИ чатов в контейнере `messages.chats`, а не выжимка
	// из четырёх полей: ключ выводится из самого конструктора.
	var cands struct {
		Underscore string `json:"_"`
		Chats      []struct {
			Underscore string `json:"_"`
			ID         int64  `json:"id"`
			Title      string `json:"title"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cands)
	if cands.Underscore != "messages.chats" {
		t.Fatalf("кандидаты не контейнером: %s", rec.Body.String())
	}
	found := false
	for _, c := range cands.Chats {
		if domain.ToPeerID(c.ID, true) == domain.PeerID(gid) {
			found = true
			if c.Title == "" {
				t.Fatalf("карточка кандидата без имени: %s", rec.Body.String())
			}
		}
	}
	if !found {
		t.Fatalf("candidates missing group %d: %s", gid, rec.Body.String())
	}

	// PUT discussion links it.
	rec = authedReq(t, h, http.MethodPut, "/channels/"+cid+"/discussion", tokenA, map[string]any{"group_peer_id": gid})
	if rec.Code != http.StatusOK {
		t.Fatalf("link discussion: %d %s", rec.Code, rec.Body.String())
	}
	linked := linkedPeerOf(t, h, tokenA, cid)
	if linked != gid {
		t.Fatalf("linked discussion = %d; want %d", linked, gid)
	}

	// Card reflects the link and the now-linked group is no longer a candidate.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	// Связанная группа — channelFull.linked_chat_id: id канала-обсуждения, как
	// в схеме (положительный), плюс pFlags.has_link у краткой формы.
	card := decodeCard(t, rec)
	if card.linkedChatID() != gid {
		t.Fatalf("linked_chat_id = %d; want %d", card.linkedChatID(), gid)
	}
	if !card.chatFlag("has_link") {
		t.Fatalf("pFlags.has_link не выставлен: %s", rec.Body.String())
	}

	// DELETE discussion unlinks.
	rec = authedReq(t, h, http.MethodDelete, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	card = decodeCard(t, rec)
	if card.linkedChatID() != 0 || card.chatFlag("has_link") {
		t.Fatalf("discussion still linked after unlink: %d", card.linkedChatID())
	}

	// sign_messages toggles signatures on the card.
	rec = authedReq(t, h, http.MethodPut, "/channels/"+cid+"/sign_messages", tokenA, map[string]any{"signatures": true, "profiles": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_messages: %d %s", rec.Code, rec.Body.String())
	}
	// Подписи постов — флаги краткой формы канала, а не отдельные поля карточки.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	card = decodeCard(t, rec)
	if !card.chatFlag("signatures") || !card.chatFlag("signature_profiles") {
		t.Fatalf("card signatures = %+v; want both true", card.Chats[0].PFlags)
	}

	// signatures=false forces profiles off.
	_ = authedReq(t, h, http.MethodPut, "/channels/"+cid+"/sign_messages", tokenA, map[string]any{"signatures": false, "profiles": true})
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	card = decodeCard(t, rec)
	if card.chatFlag("signatures") || card.chatFlag("signature_profiles") {
		t.Fatalf("card signatures should be off: %+v", card.Chats[0].PFlags)
	}
}

// Провод «Похожих каналов» целиком — предмета не хватало ДВАЖДЫ, и обе
// половины проверяются здесь на самом контракте.
//
//	(1) ДАТА ВСТУПЛЕНИЯ. Служебное «вы вступили в канал» у оригинала КЛИЕНТСКОЕ
//	    и встаёт в историю по channel.date (tweb appMessagesManager.ts:6888-6930);
//	    «Похожие каналы» — довесок ровно этого бабла и больше ничего
//	    (tweb bubbles.ts:7028-7118). Пока date нёс дату создания канала, бабл
//	    уезжал в самое начало истории.
//	(2) ФОРМА ВЫДАЧИ. Клиент читает `chat._ === 'channel'` и рисует подписчиков
//	    из participants_count (tweb similarChannels.tsx:110, :206). Плоский
//	    снимок {id,title,member_count} давал бы ноль подписчиков и пустые
//	    аватарки.
func TestChannelSimilarAndJoinDate_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	ctx := t.Context()
	tokenOwner, _ := signUp(t, h, pool, "+79990003001")
	tokenViewer, viewerID := signUp(t, h, pool, "+79990003002")
	tokenShared, _ := signUp(t, h, pool, "+79990003003")

	createChannel := func(title, username string) int64 {
		t.Helper()
		rec := authedReq(t, h, http.MethodPost, "/channels", tokenOwner, map[string]any{
			"title": title, "username": username, "is_public": true,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("создание %s: %d %s", username, rec.Code, rec.Body.String())
		}
		return createdPeerID(t, rec)
	}
	join := func(token, username string) {
		t.Helper()
		rec := authedReq(t, h, http.MethodPost, "/channels/join", token, map[string]any{"username": username})
		if rec.Code != http.StatusOK {
			t.Fatalf("вступление в %s: %d %s", username, rec.Code, rec.Body.String())
		}
	}

	srcPeer := createChannel("Source", "src3001")
	simPeer := createChannel("Similar", "sim3001")
	// Общий подписчик даёт пересечение аудитории, по которому канал и признаётся
	// похожим; зритель подписан ТОЛЬКО на источник.
	join(tokenShared, "src3001")
	join(tokenShared, "sim3001")
	join(tokenViewer, "src3001")

	// Даты разводим: без этого «создание» и «вступление» неразличимы и подмена
	// одной другой прошла бы проверку.
	srcID := domain.PeerID(srcPeer).ToChatID()
	created := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	joined := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if _, err := pool.Exec(ctx, `UPDATE chats SET created_at=$2 WHERE id=$1`, srcID, created); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET joined_at=$3 WHERE chat_id=$1 AND user_id=$2`, srcID, viewerID, joined); err != nil {
		t.Fatal(err)
	}

	// ── (1) карточка канала глазами подписчика ──────────────────────────────
	rec := authedReq(t, h, http.MethodGet, "/chats/"+itoa(srcPeer)+"/card", tokenViewer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("карточка: %d %s", rec.Code, rec.Body.String())
	}
	card := decodeCard(t, rec)
	if got := card.chatDate(); got != int(joined.Unix()) {
		t.Errorf("date подписчика = %d; want %d (вступление, а не создание %d)",
			got, joined.Unix(), created.Unix())
	}
	// isInChat оригинала читается по pFlags.left (tweb appChatsManager.ts:331-344):
	// у подписчика флага быть не должно, иначе бабл не вставится вовсе.
	if card.chatFlag("left") {
		t.Error("подписчик помечен pFlags.left — клиент сочтёт, что он не в канале")
	}

	// ── (2) выдача похожих каналов ──────────────────────────────────────────
	rec = authedReq(t, h, http.MethodGet, "/channels/"+itoa(srcPeer)+"/similar", tokenViewer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("похожие: %d %s", rec.Code, rec.Body.String())
	}
	var similar struct {
		Underscore string `json:"_"`
		Count      int    `json:"count"`
		Chats      []struct {
			Underscore        string          `json:"_"`
			ID                int64           `json:"id"`
			Title             string          `json:"title"`
			Username          string          `json:"username"`
			ParticipantsCount int             `json:"participants_count"`
			Date              int             `json:"date"`
			Photo             map[string]any  `json:"photo"`
			PFlags            map[string]bool `json:"pFlags"`
		} `json:"chats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &similar); err != nil {
		t.Fatalf("разбор похожих: %v (%s)", err, rec.Body.String())
	}
	// Отдан КУСОК (лимит 30) — значит конструктор со счётчиком полного набора:
	// по нему оригинал рисует «+N» под Premium (tweb similarChannels.tsx:196).
	if similar.Underscore != "messages.chatsSlice" || similar.Count != 1 {
		t.Fatalf("контейнер = %q count=%d; want messages.chatsSlice count=1 (%s)",
			similar.Underscore, similar.Count, rec.Body.String())
	}
	if len(similar.Chats) != 1 {
		t.Fatalf("похожих = %d; want 1 (%s)", len(similar.Chats), rec.Body.String())
	}
	got := similar.Chats[0]
	if got.Underscore != domain.ChannelTag {
		t.Fatalf("строка выдачи = %q; want конструктор %q — плоский снимок клиент не читает",
			got.Underscore, domain.ChannelTag)
	}
	if got.ID != domain.PeerID(simPeer).ToChatID() || got.Title != "Similar" || got.Username != "sim3001" {
		t.Errorf("похожий канал = %+v; want карточку sim3001", got)
	}
	if !got.PFlags["broadcast"] {
		t.Errorf("вид = %v; want broadcast", got.PFlags)
	}
	// Ровно то, что показывал прежний плоский снимок: ноль подписчиков и
	// пустая аватарка.
	if got.ParticipantsCount == 0 {
		t.Error("participants_count = 0: число подписчиков не доехало")
	}
	if got.Photo == nil || got.Photo["_"] == nil {
		t.Errorf("photo = %v; want конструктор ChatPhoto (пусть и chatPhotoEmpty)", got.Photo)
	}
	// Зритель в похожем канале не состоит, и это видно в карточке: date по
	// схеме — дата создания, а pFlags.left выставлен.
	if !got.PFlags["left"] {
		t.Error("зритель не состоит в похожем канале — pFlags.left не выставлен")
	}
	if got.Date == 0 {
		t.Error("date похожего канала едет нулём: обязательное поле не заполнено")
	}
}

// linkedPeerOf — ключ связанного чата канала из его карточки
// (channelFull.linked_chat_id): привязка обсуждения отвечает Bool, как
// channels.setDiscussionGroup оригинала (A4-20), и адрес группы читают из
// карточки.
func linkedPeerOf(t *testing.T, h http.Handler, token, cid string) int64 {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("карточка канала: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		FullChat struct {
			LinkedChatID int64 `json:"linked_chat_id"`
		} `json:"full_chat"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.FullChat.LinkedChatID == 0 {
		t.Fatalf("linked_chat_id не разобран: %v (%s)", err, rec.Body.String())
	}
	return -out.FullChat.LinkedChatID
}
