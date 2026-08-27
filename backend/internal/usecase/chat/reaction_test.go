package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

const (
	canSeeChat  int64 = 500
	canSeeMsg   int64 = 900
	canSeeOwner int64 = 7
	canSeeMate  int64 = 8
)

// canSeeKinds — ответ правила по видам чата, в которых у нас бывают реакции.
// «Личка» здесь ждёт ЛОЖЬ не по недосмотру: на неё отвечает клиент по ключу
// пира — второй терм того же условия (tweb src/components/chat/reactions.ts:306).
var canSeeKinds = []struct {
	kind string
	want bool
}{
	{domain.ChatTypeGroup, true},
	{domain.ChatTypeChannel, false},
	{domain.ChatTypePrivate, false},
}

// Агрегат КАДРА реакций: тело одно на всех получателей, и именно из него клиент
// узнаёт новое состояние чипов после чужого клика. Пока флага в кадре не было,
// аватарки реагировавших в группе не появлялись никогда (задача #89).
func TestReactionFrame_CanSeeListFollowsChatKind(t *testing.T) {
	ctx := context.Background()
	for _, c := range canSeeKinds {
		t.Run(c.kind, func(t *testing.T) {
			in, s := newInteractor()
			s.seedChat(canSeeChat, c.kind, canSeeOwner, canSeeMate)
			if err := in.reactions.Add(ctx, canSeeMsg, canSeeMate, "🔥"); err != nil {
				t.Fatalf("Add: %v", err)
			}

			agg, err := in.messageReactionsAggregate(ctx, canSeeChat, canSeeMsg)
			if err != nil {
				t.Fatalf("messageReactionsAggregate: %v", err)
			}
			// Проверяется ТЕЛО кадра, а не структура рядом: витрина кадра —
			// единственное, что реально уезжает получателю.
			raw, err := json.Marshal(reactionsPayload(domain.PeerID(canSeeChat), 1, agg))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var body struct {
				Reactions struct {
					PFlags map[string]bool `json:"pFlags"`
				} `json:"reactions"`
			}
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got := body.Reactions.PFlags["can_see_list"]; got != c.want {
				t.Fatalf("can_see_list в кадре = %v; want %v (pFlags=%#v)", got, c.want, body.Reactions.PFlags)
			}
		})
	}
}

// Реакций не осталось — агрегат всё равно едет, и право на список у него то же
// самое: «реакций нет» это состояние, а не отсутствие ответа.
func TestReactionFrame_EmptyAggregateKeepsCanSeeList(t *testing.T) {
	in, s := newInteractor()
	s.seedChat(canSeeChat, domain.ChatTypeGroup, canSeeOwner, canSeeMate)

	agg, err := in.messageReactionsAggregate(context.Background(), canSeeChat, canSeeMsg)
	if err != nil {
		t.Fatalf("messageReactionsAggregate: %v", err)
	}
	if len(agg.Results) != 0 {
		t.Fatalf("ждали пустой агрегат, получили %#v", agg.Results)
	}
	if !agg.PFlags["can_see_list"] {
		t.Fatalf("пустой агрегат группы потерял право на список: %#v", agg.PFlags)
	}
}

// Тот же ответ в ИСТОРИИ: агрегат внутри сообщения — тот же конструктор, и
// расходиться с кадром ему нельзя, иначе аватарки появлялись бы и пропадали от
// того, каким путём сообщение доехало до клиента.
func TestMessagesWire_CanSeeListFollowsChatKind(t *testing.T) {
	ctx := context.Background()
	for _, c := range canSeeKinds {
		t.Run(c.kind, func(t *testing.T) {
			in, s := newInteractor()
			s.seedChat(canSeeChat, c.kind, canSeeOwner, canSeeMate)
			msg := domain.Message{
				ID: canSeeMsg, ChatID: canSeeChat, Seq: 1, SenderID: canSeeOwner, Text: "hi",
				Reactions: []domain.ReactionCount{{Emoji: "🔥", Count: 1}},
			}

			out, err := in.MessagesWire(ctx, canSeeOwner, []domain.Message{msg})
			if err != nil {
				t.Fatalf("MessagesWire: %v", err)
			}
			real, ok := out[0].(domain.MessageReal)
			if !ok {
				t.Fatalf("на провод уехал не message: %#v", out[0])
			}
			if real.Reactions == nil {
				t.Fatal("агрегат реакций не доехал до провода")
			}
			if got := real.Reactions.PFlags["can_see_list"]; got != c.want {
				t.Fatalf("can_see_list в истории = %v; want %v", got, c.want)
			}
		})
	}
}

// Третий производитель того же сообщения — ЖИВОЙ кадр (new_message/edit). Он
// собирает контекст сам, и забыть в нём флаг значило бы, что аватарки исчезают
// у только что пришедшего сообщения и появляются после перезагрузки истории.
func TestMessageContext_CanSeeListFollowsChatKind(t *testing.T) {
	ctx := context.Background()
	for _, c := range canSeeKinds {
		t.Run(c.kind, func(t *testing.T) {
			in, s := newInteractor()
			s.seedChat(canSeeChat, c.kind, canSeeOwner, canSeeMate)
			msg := domain.Message{ID: canSeeMsg, ChatID: canSeeChat, Seq: 1, SenderID: canSeeOwner}

			got := in.messageContext(ctx, msg, domain.NullPeerID).CanSeeReactionsList
			if got != c.want {
				t.Fatalf("CanSeeReactionsList в контексте кадра = %v; want %v", got, c.want)
			}
		})
	}
}
