package postgres

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0102 переводит адресацию замороженных кадров журналов на знаковый
// PeerId оригинала: пользователь ≥ 0, чат < 0 (tweb utils/peers/isUser.ts,
// isAnyChat.ts). Переходника на чтении нет намеренно, поэтому цена ошибки —
// догоняющий через /sync клиент, применяющий кадры НЕ К ТОМУ чату.
//
// Схема проверки та же, что у 0100/0101: откатываемся на версию назад (там ещё
// старая форма), пишем строки как их писал прежний код, накатываем 0102 и
// читаем ОБЫЧНЫМИ репозиториями — теми же, которыми их отдаёт /sync.
//
// ⚠ Главное здесь — АСИММЕТРИЯ приватного диалога. Один и тот же разговор
// адресуется у двух сторон РАЗНЫМ ключом: у A это id B, у B это id A.
// Симметричное соответствие («один chatID — один peerId») — самая естественная
// ошибка в этом месте, и она перепутала бы диалоги: каждая сторона открыла бы
// чат сама с собой. Проверяется явно.
const peerIDMigrationPrevVersion = 101

// framePeer читает ключ пира из замороженного кадра и заодно сообщает, не
// остался ли в нём прежний chat_id.
func framePeer(t *testing.T, raw []byte) (peer int64, hasPeer bool, hasChat bool) {
	t.Helper()
	var p map[string]json.RawMessage
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("разбор кадра %s: %v", raw, err)
	}
	if v, ok := p["peer_id"]; ok {
		hasPeer = true
		if err := json.Unmarshal(v, &peer); err != nil {
			t.Fatalf("peer_id в кадре %s: %v", raw, err)
		}
	}
	// Ключ пира у портированных кадров — КОНСТРУКТОР `peer` объединения Peer, а
	// не плоское число: миграции порта кадров (0111–0117) перевели туда прочтение,
	// закрепление, удаление, реакции. Знаковый ключ выводится из конструктора —
	// ровно так же, как его выводит клиент.
	if v, ok := p["peer"]; ok {
		hasPeer = true
		var c struct {
			Underscore string `json:"_"`
			UserID     int64  `json:"user_id"`
			ChannelID  int64  `json:"channel_id"`
			ChatID     int64  `json:"chat_id"`
		}
		if err := json.Unmarshal(v, &c); err != nil {
			t.Fatalf("peer в кадре %s: %v", raw, err)
		}
		switch c.Underscore {
		case "peerUser":
			peer = c.UserID
		case "peerChannel":
			peer = -c.ChannelID
		case "peerChat":
			peer = -c.ChatID
		default:
			t.Fatalf("неизвестный конструктор пира в кадре %s", raw)
		}
	}
	_, hasChat = p["chat_id"]
	return peer, hasPeer, hasChat
}

// userFrame — кадр персонального журнала по (user_id, pts), прочитанный ОБЫЧНЫМ
// репозиторием (тем же путём, которым его отдаёт /sync).
func userFrame(t *testing.T, pool *pgxpool.Pool, userID, pts int64) []byte {
	t.Helper()
	ups, err := NewUpdatesRepo(pool).UpdatesSince(context.Background(), userID, pts-1, 10)
	if err != nil {
		t.Fatalf("UpdatesSince(%d): %v", userID, err)
	}
	for _, u := range ups {
		if u.Pts == pts {
			return u.Payload
		}
	}
	t.Fatalf("кадр pts=%d пользователя %d не найден", pts, userID)
	return nil
}

// channelFrame — кадр журнала канала (путь channels.getDifference).
func channelFrame(t *testing.T, pool *pgxpool.Pool, channelID, pts int64) []byte {
	t.Helper()
	ups, err := NewChannelRepo(pool).UpdatesSince(context.Background(), channelID, pts-1, 10)
	if err != nil {
		t.Fatalf("channel UpdatesSince: %v", err)
	}
	for _, u := range ups {
		if u.Pts == pts {
			return u.Payload
		}
	}
	t.Fatalf("кадр канала pts=%d не найден", pts)
	return nil
}

func TestMigration0102_ConvertsFrozenFramesToPeerID(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, peerIDMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", peerIDMigrationPrevVersion, err)
	}

	userA := seedUser(t, pool, "+79990000201")
	userB := seedUser(t, pool, "+79990000202")

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
	savedChat := newChat("saved", userA)
	groupChat := newChat("group", userA, userB)
	channelChat := newChat("channel", userA)
	// Чат, которого к моменту наката уже нет: кадр chat_removed переживает
	// строку chats и обязан всё равно получить ключ пира.
	goneChatID := channelChat + 1000

	seedUpdate := func(userID, pts int64, typ, payload string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1,$2,$3,$4::jsonb)`,
			userID, pts, typ, payload); err != nil {
			t.Fatalf("seed update(%s): %v", typ, err)
		}
	}
	id := strconv.FormatInt

	// Старая форма: chat_id верхним полем + вложенные ссылки на чат.
	seedUpdate(userA, 1, "new_message", `{"chat_id":`+id(privateChat, 10)+`,"msg_id":10,"seq":1,"text":"hi",
		"fwd_from_chat_id":`+id(channelChat, 10)+`,"reply_to_peer_id":`+id(groupChat, 10)+`,
		"send_as":{"chat_id":`+id(channelChat, 10)+`,"title":"News"},
		"contact":{"user_id":`+id(userB, 10)+`,"name":"B"}}`)
	seedUpdate(userB, 1, "new_message", `{"chat_id":`+id(privateChat, 10)+`,"msg_id":10,"seq":1,"text":"hi"}`)
	seedUpdate(userA, 2, "read", `{"chat_id":`+id(groupChat, 10)+`,"user_id":`+id(userA, 10)+`,"up_to_seq":3}`)
	seedUpdate(userA, 3, "draft_update", `{"chat_id":`+id(privateChat, 10)+`,"draft":{"chat_id":`+id(privateChat, 10)+`,"text":"чер"}}`)
	seedUpdate(userA, 4, "chat_removed", `{"chat_id":`+id(goneChatID, 10)+`,"removed":true}`)
	seedUpdate(userA, 5, "giveaway_update", `{"chat_id":`+id(channelChat, 10)+`,"giveaway":{"id":1,"chat_id":`+id(channelChat, 10)+`}}`)
	seedUpdate(userA, 6, "folder_update", `{"folder":{"id":1,"title":"Работа",
		"include_chats":[`+id(privateChat, 10)+`,`+id(groupChat, 10)+`],"exclude_chats":[`+id(savedChat, 10)+`]}}`)
	// user_update ключа чата не несёт вовсе: id пользователя И ЕСТЬ его peerId.
	seedUpdate(userA, 7, "user_update", `{"id":`+id(userB, 10)+`,"display_name":"B","avatar_changed":true}`)
	seedUpdate(userA, 8, "new_message", `{"chat_id":`+id(savedChat, 10)+`,"msg_id":11,"seq":1,"text":"себе"}`)

	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload)
		 VALUES ($1,1,1,'new_message', jsonb_build_object('chat_id',$1::bigint,'msg_id',20,'seq',1)),
		        ($1,2,1,'chat_update', jsonb_build_object('chat_id',$1::bigint,'title','Канал'))`,
		channelChat); err != nil {
		t.Fatalf("seed channel updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0102: %v", err)
	}

	// ── Асимметрия приватного диалога ───────────────────────────────────────
	peerForA, okA, chatA := framePeer(t, userFrame(t, pool, userA, 1))
	peerForB, okB, chatB := framePeer(t, userFrame(t, pool, userB, 1))
	if !okA || !okB {
		t.Fatalf("peer_id не проставлен: A=%v B=%v", okA, okB)
	}
	if chatA || chatB {
		t.Errorf("chat_id остался в кадре: A=%v B=%v", chatA, chatB)
	}
	if peerForA != userB {
		t.Errorf("peer_id приватного диалога у A = %d; want %d (id собеседника)", peerForA, userB)
	}
	if peerForB != userA {
		t.Errorf("peer_id приватного диалога у B = %d; want %d (id собеседника)", peerForB, userA)
	}
	if peerForA == peerForB {
		t.Errorf("стороны получили ОДИН ключ %d — соответствие сделано симметричным, диалоги перепутаются", peerForA)
	}
	if peerForA == privateChat || peerForB == privateChat {
		t.Errorf("наружу утёк внутренний chatID приватного диалога (%d)", privateChat)
	}

	// «Избранное»: единственный участник — сам зритель, peerId это он сам.
	if peer, ok, _ := framePeer(t, userFrame(t, pool, userA, 8)); !ok || peer != userA {
		t.Errorf("peer_id «Избранного» = %d (ok=%v); want %d", peer, ok, userA)
	}

	// Группа: ключ один на всех, -chatID.
	if peer, ok, _ := framePeer(t, userFrame(t, pool, userA, 2)); !ok || peer != -groupChat {
		t.Errorf("peer_id группы = %d (ok=%v); want %d", peer, ok, -groupChat)
	}

	// Удалённый чат: строки в chats уже нет, но ключ всё равно проставлен.
	if peer, ok, _ := framePeer(t, userFrame(t, pool, userA, 4)); !ok || peer != -goneChatID {
		t.Errorf("peer_id удалённого чата = %d (ok=%v); want %d", peer, ok, -goneChatID)
	}

	// ── Вложенные ссылки внутри кадра сообщения ─────────────────────────────
	//
	// Накат идёт до ПОСЛЕДНЕЙ версии, а не до 0102: следующая миграция (0103)
	// переводит те же вложенные ссылки из числа в конструктор Peer. Проверяем
	// поэтому результат цепочки — то, что реально лежит в журнале, — а не
	// промежуточную форму, которой на диске не бывает.
	var msg struct {
		FwdFromChatID *int64          `json:"fwd_from_chat_id"`
		FwdFrom       json.RawMessage `json:"fwd_from"`
		ReplyToPeerID json.RawMessage `json:"reply_to_peer_id"`
		SendAs        map[string]any  `json:"send_as"`
		Contact       map[string]any  `json:"contact"`
	}
	if err := json.Unmarshal(userFrame(t, pool, userA, 1), &msg); err != nil {
		t.Fatalf("разбор кадра сообщения: %v", err)
	}
	if msg.FwdFromChatID != nil {
		t.Error("fwd_from_chat_id остался в кадре")
	}
	if !peerRefIs(t, msg.FwdFrom, "saved_from_peer", -channelChat) {
		t.Errorf("fwd_from.saved_from_peer = %s; want ключ канала %d", msg.FwdFrom, -channelChat)
	}
	if !peerIs(t, msg.ReplyToPeerID, -groupChat) {
		t.Errorf("reply_to_peer_id = %s; want ключ группы %d", msg.ReplyToPeerID, -groupChat)
	}
	if _, has := msg.SendAs["chat_id"]; has {
		t.Error("send_as.chat_id остался в кадре")
	}
	if got := asFloat(t, msg.SendAs["peer_id"]); int64(got) != -channelChat {
		t.Errorf("send_as.peer_id = %v; want %d", got, -channelChat)
	}
	// contact несёт user_id — это УЖЕ валидный ключ пира (у пользователя peerId
	// совпадает с id), переводить нечего и трогать его миграция не должна.
	if got := asFloat(t, msg.Contact["user_id"]); int64(got) != userB {
		t.Errorf("contact.user_id = %v; миграция не должна его трогать (want %d)", got, userB)
	}

	// Черновик: ключ несёт сам кадр, дублирующий chat_id внутри draft снят.
	var draftFrame struct {
		PeerID int64          `json:"peer_id"`
		Draft  map[string]any `json:"draft"`
	}
	if err := json.Unmarshal(userFrame(t, pool, userA, 3), &draftFrame); err != nil {
		t.Fatalf("разбор draft_update: %v", err)
	}
	if draftFrame.PeerID != userB {
		t.Errorf("draft_update peer_id = %d; want %d", draftFrame.PeerID, userB)
	}
	if _, has := draftFrame.Draft["chat_id"]; has {
		t.Error("draft.chat_id остался внутри кадра")
	}

	// Розыгрыш: ключ пира несёт сам кадр.
	//
	// Вложенный снимок розыгрыша здесь БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ, и это не пробел:
	// тест гонит базу до головы, а 0107 перевёл кадр в конструктор схемы
	// (messageMediaGiveaway под ключом media), где ссылка на канал называется
	// channels и знака не несёт — там же она и проверяется. Утверждение 0102
	// осталось про то, за что 0102 и отвечает: адрес самого кадра.
	var gwFrame struct {
		PeerID   int64           `json:"peer_id"`
		Giveaway map[string]any  `json:"giveaway"`
		Media    map[string]any  `json:"media"`
		ChatID   json.RawMessage `json:"chat_id"`
	}
	if err := json.Unmarshal(userFrame(t, pool, userA, 5), &gwFrame); err != nil {
		t.Fatalf("разбор giveaway_update: %v", err)
	}
	if gwFrame.PeerID != -channelChat {
		t.Errorf("giveaway_update peer_id = %d; want %d", gwFrame.PeerID, -channelChat)
	}
	if gwFrame.ChatID != nil {
		t.Errorf("chat_id остался в кадре розыгрыша: %s", gwFrame.ChatID)
	}
	if gwFrame.Giveaway != nil || gwFrame.Media == nil {
		t.Errorf("кадр розыгрыша = %v / %v, ждали конструктор под ключом media", gwFrame.Giveaway, gwFrame.Media)
	}

	// Папка: списки правил тоже ПЕР-ЮЗЕРНЫЕ — приватный чат в них становится id
	// собеседника, а «Избранное» — самим владельцем.
	var folderFrame struct {
		Folder struct {
			IncludePeers []int64 `json:"include_peers"`
			ExcludePeers []int64 `json:"exclude_peers"`
			IncludeChats []int64 `json:"include_chats"`
		} `json:"folder"`
	}
	if err := json.Unmarshal(userFrame(t, pool, userA, 6), &folderFrame); err != nil {
		t.Fatalf("разбор folder_update: %v", err)
	}
	if folderFrame.Folder.IncludeChats != nil {
		t.Error("include_chats остался в кадре папки")
	}
	wantInclude := []int64{userB, -groupChat}
	if len(folderFrame.Folder.IncludePeers) != 2 ||
		folderFrame.Folder.IncludePeers[0] != wantInclude[0] ||
		folderFrame.Folder.IncludePeers[1] != wantInclude[1] {
		t.Errorf("folder.include_peers = %v; want %v", folderFrame.Folder.IncludePeers, wantInclude)
	}
	if len(folderFrame.Folder.ExcludePeers) != 1 || folderFrame.Folder.ExcludePeers[0] != userA {
		t.Errorf("folder.exclude_peers = %v; want [%d] («Избранное» — сам владелец)", folderFrame.Folder.ExcludePeers, userA)
	}

	// user_update миграция не трогает: ключа чата в нём нет.
	var uu struct {
		ID     int64  `json:"id"`
		PeerID *int64 `json:"peer_id"`
	}
	if err := json.Unmarshal(userFrame(t, pool, userA, 7), &uu); err != nil {
		t.Fatalf("разбор user_update: %v", err)
	}
	if uu.ID != userB || uu.PeerID != nil {
		t.Errorf("user_update изменён миграцией: id=%d peer_id=%v", uu.ID, uu.PeerID)
	}

	// Журнал канала: ключ один на всех подписчиков.
	for _, pts := range []int64{1, 2} {
		peer, ok, hasChat := framePeer(t, channelFrame(t, pool, channelChat, pts))
		if !ok || peer != -channelChat {
			t.Errorf("channel_updates pts=%d peer_id = %d (ok=%v); want %d", pts, peer, ok, -channelChat)
		}
		if hasChat {
			t.Errorf("channel_updates pts=%d: chat_id остался", pts)
		}
	}

	// ── Круг вниз-вверх ─────────────────────────────────────────────────────
	// Down обязан вернуть ПРАВИЛЬНЫЙ chatID каждой стороне приватного диалога
	// (из двух разных ключей — один и тот же чат), повторный Up — снова развести
	// стороны.
	if err := storepostgres.MigrateDownTo(url, peerIDMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	var backA, backB int64
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'chat_id')::bigint FROM updates WHERE user_id=$1 AND pts=1`, userA).Scan(&backA); err != nil {
		t.Fatalf("chat_id после отката у A: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'chat_id')::bigint FROM updates WHERE user_id=$1 AND pts=1`, userB).Scan(&backB); err != nil {
		t.Fatalf("chat_id после отката у B: %v", err)
	}
	if backA != privateChat || backB != privateChat {
		t.Errorf("откат вернул chat_id = %d / %d; want %d у обеих сторон", backA, backB, privateChat)
	}
	var backSaved int64
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'chat_id')::bigint FROM updates WHERE user_id=$1 AND pts=8`, userA).Scan(&backSaved); err != nil {
		t.Fatalf("chat_id «Избранного» после отката: %v", err)
	}
	if backSaved != savedChat {
		t.Errorf("откат «Избранного» вернул chat_id = %d; want %d", backSaved, savedChat)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	peerForA2, _, _ := framePeer(t, userFrame(t, pool, userA, 1))
	peerForB2, _, _ := framePeer(t, userFrame(t, pool, userB, 1))
	if peerForA2 != userB || peerForB2 != userA {
		t.Errorf("после круга вниз-вверх peer_id = %d / %d; want %d / %d", peerForA2, peerForB2, userB, userA)
	}
}

// asFloat достаёт число из разобранного в any JSON-поля.
func asFloat(t *testing.T, v any) float64 {
	t.Helper()
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("ждали число, получили %T (%v)", v, v)
	}
	return f
}

// peerIs — ссылка на пир (объединение Peer) указывает на знаковый ключ want.
func peerIs(t *testing.T, raw json.RawMessage, want int64) bool {
	t.Helper()
	if len(raw) == 0 {
		return false
	}
	p, err := domain.UnmarshalPeer(raw)
	return err == nil && p != nil && p.PeerID() == domain.PeerID(want)
}

// peerRefIs — вложенная ссылка на пир внутри объекта (например
// fwd_from.saved_from_peer).
func peerRefIs(t *testing.T, obj json.RawMessage, field string, want int64) bool {
	t.Helper()
	var m map[string]json.RawMessage
	if json.Unmarshal(obj, &m) != nil {
		return false
	}
	return peerIs(t, m[field], want)
}
