package postgres

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0103 переводит подсистему пиров на модель оригинала: аватарка
// адресуется id медиа, видимость номера становится правилом приватности, а
// замороженные кадры журналов переписываются под конструкторы схемы.
//
// Схема проверки та же, что у 0100–0102: откатываемся на версию назад (там ещё
// старая форма), пишем строки как их писал прежний код, накатываем 0103 и
// читаем ОБЫЧНЫМИ репозиториями — теми же, которыми их отдаёт /sync.
//
// ⚠ Главное здесь — ДОЛГ ШАГА B. Плоский `fwd_from_peer_id` брался как -chat_id
// БЕЗУСЛОВНО, поэтому у источника-приватного-чата наружу уезжал внутренний
// ключ строки chats. Проверяется, что после наката такого ключа в кадре нет
// вовсе, а автор пересылки при этом не потерян.
const peerModelMigrationPrevVersion = 102

func TestMigration0103_PeerModel(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, peerModelMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", peerModelMigrationPrevVersion, err)
	}

	userA := seedUser(t, pool, "+79990000301")
	userB := seedUser(t, pool, "+79990000302")
	mediaID := seedMedia(t, pool, userA, "avatars/a.jpg")

	// Прежний код писал аватарку СТРОКОЙ content-пути и видимость номера —
	// колонкой users.phone_visibility.
	if _, err := pool.Exec(ctx,
		`UPDATE users SET avatar_url = '/media/' || $2::bigint || '/content', phone_visibility = 'nobody'
		  WHERE id = $1`, userA, mediaID); err != nil {
		t.Fatalf("seed avatar_url/phone_visibility: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO profile_photos (user_id, url) VALUES ($1, '/media/' || $2::bigint || '/content')`,
		userA, mediaID); err != nil {
		t.Fatalf("seed profile_photos: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO contact_custom_photo (owner_id, contact_user_id, url)
		 VALUES ($1, $2, '/media/' || $3::bigint || '/content')`, userB, userA, mediaID); err != nil {
		t.Fatalf("seed contact_custom_photo: %v", err)
	}

	newChat := func(typ string, members ...int64) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ($1) RETURNING id`, typ).Scan(&id); err != nil {
			t.Fatalf("seed chat(%s): %v", typ, err)
		}
		for _, m := range members {
			if _, err := pool.Exec(ctx,
				`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')`, id, m); err != nil {
				t.Fatalf("seed member: %v", err)
			}
		}
		return id
	}
	privateChat := newChat("private", userA, userB)
	channelChat := newChat("channel", userA)
	groupChat := newChat("group", userA, userB)
	// Снимок chat_update абсолютный и пересобирается из ЖИВОЙ строки chats —
	// свежая строка вернее замороженной, поэтому сюда же кладём и настройки.
	if _, err := pool.Exec(ctx,
		`UPDATE chats SET title='Канал', member_count=7, about='о канале', history_for_new=false
		  WHERE id=$1`, channelChat); err != nil {
		t.Fatalf("seed chat title: %v", err)
	}

	seedUpdate := func(userID, pts int64, typ, payload string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1,$2,$3,$4::jsonb)`,
			userID, pts, typ, payload); err != nil {
			t.Fatalf("seed update(%s): %v", typ, err)
		}
	}
	id := strconv.FormatInt

	// Пересылка из КАНАЛА: автором должен стать сам канал, плюс channel_post.
	seedUpdate(userA, 1, "new_message", `{"peer_id":`+id(-privateChat, 10)+`,"msg_id":10,"seq":1,
		"fwd_from_user_id":null,"fwd_from_peer_id":`+id(-channelChat, 10)+`,"fwd_from_msg_id":77,
		"fwd_date":"2024-01-02T03:04:05Z","fwd_from_name":null}`)
	// Пересылка из ПРИВАТНОГО чата: ключа пира у источника нет, автор — человек.
	seedUpdate(userA, 2, "new_message", `{"peer_id":`+id(userB, 10)+`,"msg_id":11,"seq":2,
		"fwd_from_user_id":`+id(userB, 10)+`,"fwd_from_peer_id":`+id(-privateChat, 10)+`,"fwd_from_msg_id":5,
		"fwd_date":"2024-01-02T03:04:05Z","fwd_from_name":null}`)
	// Кросс-чат-ответ: из группы ссылка остаётся, из приватного — снимается.
	seedUpdate(userA, 3, "new_message", `{"peer_id":`+id(userB, 10)+`,"msg_id":12,"seq":3,
		"reply_to_peer_id":`+id(-groupChat, 10)+`,"reply_snapshot_name":"Автор"}`)
	seedUpdate(userA, 4, "new_message", `{"peer_id":`+id(userB, 10)+`,"msg_id":13,"seq":4,
		"reply_to_peer_id":`+id(-privateChat, 10)+`,"reply_snapshot_name":"Автор"}`)
	seedUpdate(userA, 5, "user_update", `{"id":`+id(userB, 10)+`,"username":"bob","display_name":"Боб Бобов","avatar_changed":true}`)
	seedUpdate(userA, 6, "chat_update", `{"peer_id":`+id(-channelChat, 10)+`,"type":"channel","title":"Канал",
		"about":"о канале","username":"","is_public":false,"member_count":7,"photo_media_id":null,
		"settings":{"default_perms":31,"slowmode_seconds":0,"reactions_mode":"all","reactions_allowed":[],
		"history_for_new":false,"charge_stars":0}}`)
	seedUpdate(userA, 7, "reaction", `{"msg_id":10,"user_id":`+id(userB, 10)+`,"emoji":"👍","action":"add",
		"counts":[{"emoji":"👍","count":1,"recent":[{"id":`+id(userB, 10)+`,"name":"Боб","avatar":""}]}]}`)

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0103: %v", err)
	}

	// ── 1. Аватарка адресуется id медиа ────────────────────────────────────
	rec, err := NewAuthRepo(pool).GetByID(ctx, userA)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if rec.PhotoID == nil || *rec.PhotoID != mediaID {
		t.Errorf("avatar media id = %v; want %d", rec.PhotoID, mediaID)
	}
	photos, err := NewAuthRepo(pool).ListProfilePhotos(ctx, userA)
	if err != nil || len(photos) != 1 || photos[0].MediaID != mediaID {
		t.Errorf("галерея после наката = %+v, %v", photos, err)
	}
	custom, err := NewContactsRepo(pool).CustomPhotoMap(ctx, userB, []int64{userA})
	if err != nil || custom[userA] != mediaID {
		t.Errorf("личное фото контакта = %v, %v; want %d", custom, err, mediaID)
	}

	// ── 2. phone_visibility стал правилом приватности ──────────────────────
	rule, err := NewPrivacyRepo(pool).Get(ctx, userA, domain.PrivacyPhoneNumber)
	if err != nil || rule.Value != domain.PrivacyNobody {
		t.Errorf("правило phone_number после переноса = %+v, %v; want nobody", rule, err)
	}

	// ── 3. Кадры журналов ──────────────────────────────────────────────────
	type fwdHdr struct {
		Underscore     string          `json:"_"`
		FromID         json.RawMessage `json:"from_id"`
		FromName       string          `json:"from_name"`
		Date           int64           `json:"date"`
		ChannelPost    int64           `json:"channel_post"`
		SavedFromPeer  json.RawMessage `json:"saved_from_peer"`
		SavedFromMsgID int64           `json:"saved_from_msg_id"`
	}
	readFwd := func(pts int64) (fwdHdr, map[string]json.RawMessage) {
		t.Helper()
		var p map[string]json.RawMessage
		if err := json.Unmarshal(userFrame(t, pool, userA, pts), &p); err != nil {
			t.Fatalf("разбор кадра pts=%d: %v", pts, err)
		}
		var h fwdHdr
		if raw, ok := p["fwd_from"]; ok {
			if err := json.Unmarshal(raw, &h); err != nil {
				t.Fatalf("разбор fwd_from pts=%d: %v", pts, err)
			}
		}
		for _, k := range []string{"fwd_from_user_id", "fwd_from_peer_id", "fwd_from_msg_id", "fwd_date", "fwd_from_name"} {
			if _, ok := p[k]; ok {
				t.Errorf("pts=%d: плоское поле %q осталось в кадре", pts, k)
			}
		}
		return h, p
	}

	fromChannel, _ := readFwd(1)
	if fromChannel.Underscore != domain.MessageFwdHeaderTag {
		t.Errorf("пересылка из канала: конструктор = %q", fromChannel.Underscore)
	}
	if !jsonPeerIs(t, fromChannel.FromID, domain.PeerChannelTag, channelChat) {
		t.Errorf("пересылка из канала: from_id = %s", fromChannel.FromID)
	}
	if fromChannel.ChannelPost != 77 || fromChannel.SavedFromMsgID != 77 {
		t.Errorf("пересылка из канала: channel_post=%d saved_from_msg_id=%d", fromChannel.ChannelPost, fromChannel.SavedFromMsgID)
	}
	if fromChannel.Date == 0 {
		t.Errorf("пересылка из канала: date не перенесён")
	}

	fromPrivate, _ := readFwd(2)
	if !jsonPeerIs(t, fromPrivate.FromID, domain.PeerUserTag, userB) {
		t.Errorf("пересылка из приватного: from_id = %s; want peerUser(%d)", fromPrivate.FromID, userB)
	}
	if len(fromPrivate.SavedFromPeer) != 0 {
		t.Errorf("пересылка из приватного: saved_from_peer = %s — внутренний ключ утёк наружу", fromPrivate.SavedFromPeer)
	}

	var withGroupReply map[string]json.RawMessage
	_ = json.Unmarshal(userFrame(t, pool, userA, 3), &withGroupReply)
	if !jsonPeerIs(t, withGroupReply["reply_to_peer_id"], domain.PeerChannelTag, groupChat) {
		t.Errorf("ответ из группы: reply_to_peer_id = %s", withGroupReply["reply_to_peer_id"])
	}
	var withPrivateReply map[string]json.RawMessage
	_ = json.Unmarshal(userFrame(t, pool, userA, 4), &withPrivateReply)
	if _, ok := withPrivateReply["reply_to_peer_id"]; ok {
		t.Errorf("ответ из приватного: ссылка осталась (%s) — внутренний ключ утёк наружу", withPrivateReply["reply_to_peer_id"])
	}
	if _, ok := withPrivateReply["reply_snapshot_name"]; !ok {
		t.Errorf("ответ из приватного: снимок превью потерян вместе со ссылкой")
	}

	var userUpd map[string]any
	_ = json.Unmarshal(userFrame(t, pool, userA, 5), &userUpd)
	if userUpd["_"] != "user" || userUpd["username"] != "bob" {
		t.Errorf("user_update = %v; want конструктор user", userUpd)
	}
	if _, ok := userUpd["display_name"]; ok {
		t.Errorf("user_update: display_name остался на проводе: %v", userUpd)
	}

	var chatUpd map[string]any
	_ = json.Unmarshal(userFrame(t, pool, userA, 6), &chatUpd)
	cf, _ := chatUpd["chat_full"].(map[string]any)
	if cf == nil || cf["_"] != domain.MessagesChatFullTag {
		t.Fatalf("chat_update = %v; want messages.chatFull", chatUpd)
	}
	chats, _ := cf["chats"].([]any)
	if len(chats) != 1 {
		t.Fatalf("chat_update chats = %v", cf["chats"])
	}
	chat, _ := chats[0].(map[string]any)
	if chat["_"] != domain.ChannelTag || chat["title"] != "Канал" {
		t.Errorf("chat_update chat = %v", chat)
	}
	pf, _ := chat["pFlags"].(map[string]any)
	if pf["broadcast"] != true {
		t.Errorf("chat_update: вид чата не выражен флагом broadcast: %v", pf)
	}
	full, _ := cf["full_chat"].(map[string]any)
	fullFlags, _ := full["pFlags"].(map[string]any)
	// history_for_new=false ⇒ hidden_prehistory=true: одно свойство с обратным знаком.
	if fullFlags["hidden_prehistory"] != true {
		t.Errorf("chat_update: hidden_prehistory не выставлен при history_for_new=false: %v", full)
	}

	// ── 4. Круг вниз-вверх ─────────────────────────────────────────────────
	// Down обязан быть исполнимым: без него миграцию нельзя откатить на живом
	// деплое. Проверяем и то, что повторный Up возвращает ту же форму — колонки
	// и кадры переживают круг.
	if err := storepostgres.MigrateDownTo(url, peerModelMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	after, err := NewAuthRepo(pool).GetByID(ctx, userA)
	if err != nil || after.PhotoID == nil || *after.PhotoID != mediaID {
		t.Errorf("после круга вниз-вверх аватарка = %v, %v; want %d", after.PhotoID, err, mediaID)
	}
	if h, _ := readFwd(1); !jsonPeerIs(t, h.FromID, domain.PeerChannelTag, channelChat) {
		t.Errorf("после круга вниз-вверх пересылка из канала = %s", h.FromID)
	}

	var reactionUpd map[string]any
	_ = json.Unmarshal(userFrame(t, pool, userA, 7), &reactionUpd)
	counts, _ := reactionUpd["counts"].([]any)
	first, _ := counts[0].(map[string]any)
	recent, _ := first["recent"].([]any)
	peer, _ := recent[0].(map[string]any)
	if peer["_"] != domain.PeerUserTag || int64(peer["user_id"].(float64)) != userB {
		t.Errorf("reaction.recent = %v; want ссылку peerUser(%d)", recent, userB)
	}
}

// jsonPeerIs проверяет, что raw — ссылка на пир нужного конструктора и id.
func jsonPeerIs(t *testing.T, raw json.RawMessage, tag string, rawID int64) bool {
	t.Helper()
	if len(raw) == 0 {
		return false
	}
	p, err := domain.UnmarshalPeer(raw)
	if err != nil || p == nil {
		return false
	}
	if p.Tag() != tag {
		return false
	}
	if tag == domain.PeerUserTag {
		return p.PeerID() == domain.PeerID(rawID)
	}
	return p.PeerID() == domain.ToPeerID(rawID, true)
}
