package ws

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeVectors struct{ calls []domain.PeerRefs }

func (f *fakeVectors) PeerVectorsForRefs(_ context.Context, _ int64, refs domain.PeerRefs) ([]domain.UserReal, []domain.Chat) {
	f.calls = append(f.calls, refs)
	var users []domain.UserReal
	for _, id := range refs.Users {
		users = append(users, domain.NewUser(id, domain.UserFlags{}))
	}
	var chats []domain.Chat
	for _, id := range refs.Chats {
		chats = append(chats, domain.NewChannel(id, "чат", domain.NewChatPhotoEmpty(), time.Time{}, domain.ChannelFlags{Megagroup: true}))
	}
	return users, chats
}

// A4-05: кадр апдейта уходит с карточками тех, на кого ссылается (автор,
// чат), — один раз на соединение; транспортный кадр не трогается.
func TestWithVectors(t *testing.T) {
	msg := domain.MessageReal{Underscore: domain.MessageTag, ID: 12,
		PeerID: domain.NewPeerChannel(5), FromID: domain.NewPeerUser(7), Date: 1787334148, Message: "привет"}
	body, _ := json.Marshal(domain.NewUpdateNewMessage(msg, 41))
	frame, _ := json.Marshal(map[string]any{"t": "new_message", "d": json.RawMessage(body)})

	src := &fakeVectors{}
	known := knownPeers{}
	out := withVectors(context.Background(), src, 1, known, frame)
	var env struct {
		Users []map[string]any `json:"users"`
		Chats []map[string]any `json:"chats"`
	}
	if err := json.Unmarshal(out, &env); err != nil {
		t.Fatal(err)
	}
	if len(env.Users) != 1 || len(env.Chats) != 1 {
		t.Fatalf("векторы кадра: users=%v chats=%v, want автора 7 и чат 5", env.Users, env.Chats)
	}
	// Второй кадр с теми же пирами — без повторного похода и без векторов.
	if again := withVectors(context.Background(), src, 1, known, frame); string(again) != string(frame) || len(src.calls) != 1 {
		t.Fatalf("повтор: calls=%d, кадр изменён=%v", len(src.calls), string(again) != string(frame))
	}
	// Кадр с векторами на проводе TL — контейнер updates (у updateShort их нет).
	tl, ok := tlEncodeUpdateFrame(out)
	if !ok || hex.EncodeToString(tl[:4]) != "4042ae74" {
		t.Fatalf("TL-оболочка кадра с карточками = %x, want updates", tl[:4])
	}
	hello, _ := json.Marshal(map[string]any{"t": "hello", "d": map[string]any{"pts": 5}})
	if got := withVectors(context.Background(), src, 1, knownPeers{}, hello); string(got) != string(hello) {
		t.Fatal("транспортный кадр изменён")
	}
}
