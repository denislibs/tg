package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// rowsOfType — строки журнала пользователя заданного типа, тело разобрано.
func rowsOfType(t *testing.T, s *store, userID int64, typ string) []map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, u := range s.updates[userID] {
		if u.Type != typ {
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(u.Payload, &body); err != nil {
			t.Fatalf("тело строки %q: %v", typ, err)
		}
		out = append(out, body)
	}
	return out
}

// ptsOfType — pts последней строки журнала заданного типа (за ней может лежать
// служебное сообщение, поэтому «последняя вообще» не годится).
func ptsOfType(t *testing.T, s *store, userID int64, typ string) int64 {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k := len(s.updates[userID]) - 1; k >= 0; k-- {
		if u := s.updates[userID][k]; u.Type == typ {
			return u.Pts
		}
	}
	t.Fatalf("у %d нет строки %q", userID, typ)
	return 0
}

func peerOf(t *testing.T, body map[string]any) (string, float64) {
	t.Helper()
	p, _ := body["peer"].(map[string]any)
	if p == nil {
		t.Fatalf("в теле нет peer: %v", body)
	}
	tag, _ := p["_"].(string)
	for _, k := range []string{"user_id", "chat_id", "channel_id"} {
		if id, ok := p[k].(float64); ok {
			return tag, id
		}
	}
	t.Fatalf("peer без номера: %v", p)
	return "", 0
}

// Личка: срок общий для обеих сторон, поэтому строка `peer_history_ttl`
// ложится в журнал КАЖДОГО участника (в том числе того, кто поставил — его
// второе устройство), а пир в теле у каждой стороны свой (tweb
// onUpdatePeerHistoryTTL, appProfileManager.ts:1541-1558).
func TestSetChatAutoDelete_PrivateLogsPeerHistoryTTLToBothSides(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if err := in.SetChatAutoDelete(ctx, chatID, a, 86400); err != nil {
		t.Fatalf("SetChatAutoDelete: %v", err)
	}
	for _, c := range []struct{ uid, other int64 }{{a, b}, {b, a}} {
		rows := rowsOfType(t, s, c.uid, "peer_history_ttl")
		if len(rows) != 1 {
			t.Fatalf("строк peer_history_ttl у %d = %d, want 1", c.uid, len(rows))
		}
		body := rows[0]
		if body["_"] != domain.UpdatePeerHistoryTTLTag || body["ttl_period"] != float64(86400) {
			t.Fatalf("тело у %d = %v", c.uid, body)
		}
		if tag, id := peerOf(t, body); tag != domain.PeerUserTag || int64(id) != c.other {
			t.Fatalf("peer у %d = %s/%v, want peerUser %d (пир глазами получателя)", c.uid, tag, id, c.other)
		}
		pts := ptsOfType(t, s, c.uid, "peer_history_ttl")
		assertLiveFramePts(t, pub, c.uid, "peer_history_ttl", pts)
		assertInDifference(t, in, c.uid, "peer_history_ttl", pts)
	}

	// Сброс: «выключено» — отсутствие ключа, а не нуль.
	if err := in.SetChatAutoDelete(ctx, chatID, b, 0); err != nil {
		t.Fatalf("сброс: %v", err)
	}
	rows := rowsOfType(t, s, a, "peer_history_ttl")
	if len(rows) != 2 {
		t.Fatalf("строк после сброса = %d, want 2", len(rows))
	}
	if _, has := rows[1]["ttl_period"]; has {
		t.Fatalf("сброс несёт ttl_period: %v", rows[1])
	}
}

// Группа: строка у каждого участника с одним и тем же пиром-чатом.
func TestSetChatAutoDelete_GroupLogsPeerHistoryTTLToEveryMember(t *testing.T) {
	in, s, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner, member int64 = 7, 8
	chatID, _, err := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := in.AddMember(ctx, chatID, owner, member); err != nil {
		t.Fatal(err)
	}

	if err := in.SetChatAutoDelete(ctx, chatID, owner, 604800); err != nil {
		t.Fatalf("SetChatAutoDelete: %v", err)
	}
	for _, uid := range []int64{owner, member} {
		rows := rowsOfType(t, s, uid, "peer_history_ttl")
		if len(rows) != 1 || rows[0]["ttl_period"] != float64(604800) {
			t.Fatalf("строки у %d = %v", uid, rows)
		}
		pts := ptsOfType(t, s, uid, "peer_history_ttl")
		assertLiveFramePts(t, pub, uid, "peer_history_ttl", pts)
		assertInDifference(t, in, uid, "peer_history_ttl", pts)
	}

	if err := in.SetChatAutoDelete(ctx, chatID, owner, 0); err != nil {
		t.Fatal(err)
	}
	rows := rowsOfType(t, s, member, "peer_history_ttl")
	if len(rows) != 2 {
		t.Fatalf("строк у участника = %d, want 2", len(rows))
	}
	if _, has := rows[1]["ttl_period"]; has {
		t.Fatalf("сброс несёт ttl_period: %v", rows[1])
	}
}

// Broadcast-канал (В-3 Ф-6): per-user строк нет — срок едет снимком карточки
// журналом канала (`chat_update`, один на всех подписчиков), `ttl_period`
// внутри `chat_full.full_chat`; клиент сравнивает его со строкой диалога.
func TestSetChatAutoDelete_BroadcastChannelPublishesSnapshot(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, id, 9, domain.RoleSubscriber, 0)

	cache := &spyDialogsCache{}
	i.SetDialogsCache(cache)

	if err := i.SetChatAutoDelete(ctx, id, 7, 86400); err != nil {
		t.Fatalf("SetChatAutoDelete: %v", err)
	}
	// Сбрасывается кэш только того, кто поставил срок (O(подписчиков) не платим).
	if len(cache.invalidated) != 1 || cache.invalidated[0] != 7 {
		t.Fatalf("кэш диалогов сброшен у %v, want [7]", cache.invalidated)
	}
	if fpub.count != 1 {
		t.Fatalf("публикаций канала = %d, want 1 (без веера по подписчикам)", fpub.count)
	}
	ups, err := channelJournal(ctx, i, id, 7, 0)
	if err != nil {
		t.Fatal(err)
	}
	var snap []domain.ChannelUpdate
	for _, u := range ups {
		if u.Type == "chat_update" {
			snap = append(snap, u)
		}
	}
	if len(snap) != 1 {
		t.Fatalf("строк chat_update в журнале канала = %d (%+v), want 1", len(snap), ups)
	}
	var body struct {
		ChatFull struct {
			FullChat struct {
				TTLPeriod int `json:"ttl_period"`
			} `json:"full_chat"`
		} `json:"chat_full"`
	}
	if err := json.Unmarshal(snap[0].Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body.ChatFull.FullChat.TTLPeriod != 86400 {
		t.Fatalf("ttl_period в снимке = %d, want 86400: %s", body.ChatFull.FullChat.TTLPeriod, snap[0].Payload)
	}
}

// Срок — поле строки списка чатов: снимок диалогов в кэше устарел у обоих
// участников. Вызов без служебного сообщения — оно само сбрасывает кэш, и тест
// не отличал бы запись из `dialogRowFrames` от его побочного эффекта.
func TestPublishHistoryTTL_InvalidatesDialogsCacheOfEveryMember(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	cache := &spyDialogsCache{}
	in.SetDialogsCache(cache)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	in.publishHistoryTTL(ctx, chatID, a, domain.ChatTypePrivate, 86400)

	cache.mu.Lock()
	defer cache.mu.Unlock()
	got := map[int64]bool{}
	for _, id := range cache.invalidated {
		got[id] = true
	}
	if !got[a] || !got[b] {
		t.Fatalf("кэш диалогов сброшен у %v, want обоих", cache.invalidated)
	}
}
