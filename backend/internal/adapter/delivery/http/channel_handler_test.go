package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.PeerID == 0 {
		t.Fatalf("expected chat_id, got %s", rec.Body.String())
	}
	cid := itoa(created.PeerID)

	// Creator posts → 200 + адрес поста (id = номер в канале).
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "hello world", "client_msg_id": "c1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("creator post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID     int64 `json:"id"`
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	if post.ID == 0 {
		t.Fatalf("expected non-zero id, got %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"seq"`) {
		t.Fatalf("в ответе осталось второе число: %s", rec.Body.String())
	}
	if post.PeerID != created.PeerID {
		t.Fatalf("post chat_id = %d; want %d", post.PeerID, created.PeerID)
	}

	// A second post so difference has more than one entry.
	_ = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "second"})

	// difference?pts=0 returns the posts.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/difference?pts=0", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("difference: %d %s", rec.Code, rec.Body.String())
	}
	var diff struct {
		Updates []struct {
			T   string          `json:"t"`
			Pts int64           `json:"pts"`
			D   json.RawMessage `json:"d"`
		} `json:"updates"`
		Pts int64 `json:"pts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &diff)
	if len(diff.Updates) != 2 || diff.Pts != 2 {
		t.Fatalf("difference = %+v (%s)", diff, rec.Body.String())
	}
	// typed envelope {t,pts,d}: posts carry type new_message with the dense pts
	if diff.Updates[0].T != "new_message" || diff.Updates[0].Pts != 1 {
		t.Fatalf("update[0] = {t:%q pts:%d}; want new_message/1", diff.Updates[0].T, diff.Updates[0].Pts)
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	if disc.DiscussionPeerID == 0 {
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
	// Тред каждого поста — конструктором messageReplies; карточки авторов едут
	// ОДНИМ вектором users, а не вклеенными в каждый пост.
	var cc struct {
		Replies map[string]struct {
			Underscore     string `json:"_"`
			Replies        int    `json:"replies"`
			RecentRepliers []struct {
				UserID int64 `json:"user_id"`
			} `json:"recent_repliers"`
		} `json:"replies"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cc)
	if cc.Replies[pid].Underscore != "messageReplies" || cc.Replies[pid].Replies != 1 {
		t.Fatalf("comment_counts[%s] = %+v; want messageReplies с одним комментарием (%s)", pid, cc.Replies[pid], rec.Body.String())
	}
	if len(cc.Replies[pid].RecentRepliers) != 1 || len(cc.Users) != 1 {
		t.Fatalf("recent_repliers = %+v, users = %+v; ждали ссылку + карточку один раз",
			cc.Replies[pid].RecentRepliers, cc.Users)
	}
	if cc.Replies[pid].RecentRepliers[0].UserID != cc.Users[0].ID {
		t.Fatalf("ссылка %d не подкреплена карточкой %d", cc.Replies[pid].RecentRepliers[0].UserID, cc.Users[0].ID)
	}
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

// Комментарий обязан нести ОДИН И ТОТ ЖЕ корень треда что через
// /comments, что через generic-историю группы обсуждения (GET
// /chats/{id}/history?thread_root=<postId>) — именно так текущий клиент
// читает тред комментариев. Плюс: (b) чтение по thread_root=<id поста>
// обязано найти комментарий, а не вернуть пусто (тред физически висит на id
// ЗЕРКАЛА, не поста — без перевода на входе страница молча пустая), и (c)
// редактирование не меняет наружный id.
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	discCid := itoa(disc.DiscussionPeerID)

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

	// (b) generic-история группы обсуждения по thread_root=<id поста> находит
	// комментарий (а не пустую страницу).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+pid, tokenB, nil)
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
// (?thread_root=<postId>) не должна возвращать текст поста дважды.
// resolveThreadRootForQuery переводит входящий thread_root (id поста) в id
// ЗЕРКАЛА для SQL-запроса; зеркало (копия поста, включая текст) приезжает в
// выборке само (SQL: thread_root_id=root OR id=root). Раньше
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	discCid := itoa(disc.DiscussionPeerID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, map[string]any{
		"text": "первый комментарий", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+pid, tokenB, nil)
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
// thread_root_id = id ПОСТА обязана приземлить сообщение в тот же тред, что
// и штатный POST /channels/{ch}/posts/{id}/comments — resolveThreadRootForQuery
// применялась только на чтении (GetHistory/GetHistoryAround), а вход в Send
// шёл нерезолвленным (chat_handler.go/conn.go передавали body.ThreadRootID
// как есть) — комментарий, отправленный generic-путём, ложился на
// буквальный id поста и в треде не появлялся вовсе.
func TestGenericSend_ThreadRootID_PostID_LandsInSameThreadAsComments(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990007001")
	tokenB, _ := signUp(t, h, pool, "+79990007002")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss5", "username": "discusschan5", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	discCid := itoa(disc.DiscussionPeerID)

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

	// Тот же тред, но generic-путём: thread_root_id в теле = id ПОСТА.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "через generic send", "thread_root_id": pid, "client_msg_id": "k2",
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
// Проверяем: (а) generic-send приземляет комментарий в тот же тред, что и
// штатный POST /comments, thread_root_id в ответе — id ПОСТА, а не 0;
// (б) комментарии к ДВУМ разным домиграционным постам не схлопываются —
// GET /history?thread_root=<post1> отдаёт только свой, не чужой.
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	discCid := itoa(disc.DiscussionPeerID)

	// generic-send к ОБОИМ домиграционным постам — зеркала дозаводятся лениво.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "comment on post1", "thread_root_id": post1.ID, "client_msg_id": "c1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("generic send к post1: %d %s", rec.Code, rec.Body.String())
	}
	var c1 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &c1)
	top1 := threadTop(t, rec.Body.Bytes())
	if top1 == nil || *top1 == 0 {
		t.Fatalf("корень треда комментария к post1 = %v (не должен быть sentinel 0)", top1)
	}

	rec = authedReq(t, h, http.MethodPost, "/chats/"+discCid+"/messages", tokenB, map[string]any{
		"text": "comment on post2", "thread_root_id": post2.ID, "client_msg_id": "c2",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("generic send к post2: %d %s", rec.Code, rec.Body.String())
	}
	var c2 struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &c2)
	top2 := threadTop(t, rec.Body.Bytes())
	if top2 == nil || *top2 == 0 {
		t.Fatalf("корень треда комментария к post2 = %v (не должен быть sentinel 0)", top2)
	}
	// Корни РАЗНЫЕ: схлопывание в sentinel 0 давало один и тот же.
	if *top1 == *top2 {
		t.Fatalf("корни тредов совпали (%d) — треды схлопнулись", *top1)
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
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(post1.ID), tokenB, nil)
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

	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(post2.ID), tokenB, nil)
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
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	var disc struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	discCid := itoa(disc.DiscussionPeerID)

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
	rec = authedReq(t, h, http.MethodGet, "/chats/"+discCid+"/history?thread_root="+itoa(post.ID), tokenB, nil)
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
	var ch struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ch)
	cid := itoa(ch.PeerID)

	// A creates a plain group (discussion candidate).
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Talk"})
	var grp struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &grp)
	gid := grp.PeerID

	// discussion_candidates lists the group.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/discussion_candidates", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("candidates: %d %s", rec.Code, rec.Body.String())
	}
	var cands struct {
		Chats []struct {
			PeerID int64 `json:"peer_id"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cands)
	found := false
	for _, c := range cands.Chats {
		if c.PeerID == gid {
			found = true
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
	var linked struct {
		DiscussionPeerID int64 `json:"discussion_peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &linked)
	if linked.DiscussionPeerID != gid {
		t.Fatalf("linked discussion = %d; want %d", linked.DiscussionPeerID, gid)
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
		t.Fatalf("card signatures = %+v; want both true", card.ChatFull.Chats[0].PFlags)
	}

	// signatures=false forces profiles off.
	_ = authedReq(t, h, http.MethodPut, "/channels/"+cid+"/sign_messages", tokenA, map[string]any{"signatures": false, "profiles": true})
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	card = decodeCard(t, rec)
	if card.chatFlag("signatures") || card.chatFlag("signature_profiles") {
		t.Fatalf("card signatures should be off: %+v", card.ChatFull.Chats[0].PFlags)
	}
}
