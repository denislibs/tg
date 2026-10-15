package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// sendAsTestSetup wires the full send pipeline over group fakes and builds a
// discussion group (gid) whose linked channel (chID, title "News") has user 7 as
// creator. User 8 is a plain group member. Returns the interactor, store and ids.
func sendAsTestSetup(t *testing.T) (*Interactor, *store, *fakeGroupRepo, int64, int64) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Алиса"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}

	gid, _, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	// Linked discussion channel with 7 as creator.
	chID, err := fg.CreateMultiMember(ctx, "channel", "News", "", "", true, 7)
	if err != nil {
		t.Fatal(err)
	}
	_ = fg.AddMember(ctx, chID, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetDiscussion(ctx, chID, gid)
	return in, s, fg, gid, chID
}

func TestGetSendAs_ChannelAdminSeesChannel(t *testing.T) {
	in, _, _, gid, chID := sendAsTestSetup(t)
	ctx := context.Background()

	// Creator of the channel (and group) sees: personal + channel + group.
	peers, err := in.GetSendAs(ctx, 7, gid)
	if err != nil {
		t.Fatalf("GetSendAs: %v", err)
	}
	// Вид личности читается из ТЕЛА пира (user против channel), а не из
	// строкового kind: строки kind больше нет.
	has := func(peer domain.PeerID) *domain.SendAsPeerRecord {
		for k := range peers {
			if domain.GetPeerID(peers[k].Peer) == peer {
				return &peers[k]
			}
		}
		return nil
	}
	if me := has(domain.PeerID(7)); me == nil || me.User == nil || me.Chat != nil {
		t.Fatalf("personal peer missing: %+v", peers)
	}
	ch := has(domain.ToPeerID(chID, true))
	if ch == nil || ch.Chat == nil || !ch.Chat.Broadcast() || ch.Chat.Title != "News" {
		t.Fatalf("channel peer missing/wrong: %+v", peers)
	}
	if g := has(domain.ToPeerID(gid, true)); g == nil || g.Chat == nil || !g.Chat.Megagroup() {
		t.Fatalf("anonymous group peer missing: %+v", peers)
	}

	// A plain group member sees only their personal account.
	peers8, err := in.GetSendAs(ctx, 8, gid)
	if err != nil {
		t.Fatalf("GetSendAs(8): %v", err)
	}
	if len(peers8) != 1 || domain.GetPeerID(peers8[0].Peer) != domain.PeerID(8) {
		t.Fatalf("member send-as = %+v, want [personal]", peers8)
	}
}

func TestSend_SendAs_AdminOK_OutsiderForbidden(t *testing.T) {
	in, s, _, gid, chID := sendAsTestSetup(t)
	ctx := context.Background()

	// Admin of the channel posts as the channel → accepted, author overridden.
	msg, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "as channel", SendAsChatID: &chID, ClientMsgID: "s1"})
	if err != nil {
		t.Fatalf("send-as by channel admin: %v", err)
	}
	if msg.SenderID != 7 {
		t.Fatalf("real sender_id lost: got %d, want 7", msg.SenderID)
	}
	if msg.SendAsChatID == nil || *msg.SendAsChatID != chID {
		t.Fatalf("send_as_chat_id = %v, want %d", msg.SendAsChatID, chID)
	}
	// На проводе отображаемый автор ЗАМЕЩАЕТ from_id: в схеме send-as это и
	// есть from_id, а не снимок {peer_id,title,photo_id} рядом с настоящим
	// отправителем. Название и аватарка приезжают карточкой чата.
	wire, _ := in.messageUpdatePayload(ctx, msg)["message"].(map[string]any)
	if _, ok := wire["send_as"]; ok {
		t.Fatalf("снимок send_as всё ещё уезжает: %+v", wire["send_as"])
	}
	from, ok := wire["from_id"].(map[string]any)
	if !ok {
		t.Fatalf("from_id отсутствует: %+v", wire)
	}
	if from["_"] != domain.PeerChannelTag || from["channel_id"] != json.Number(strconv.FormatInt(chID, 10)) {
		t.Fatalf("from_id = %+v, ждали ссылку на канал %d", from, chID)
	}

	// A group member who is not an admin of the channel cannot post as it.
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 8, Type: "text", Text: "spoof", SendAsChatID: &chID, ClientMsgID: "s2"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("outsider send-as = %v, want ErrForbidden", err)
	}
	_ = s
}

// Приватность пуша: автор в ленте — чат (send-as, анонимный админ), а живой
// отправитель на проводе скрыт. Заголовок пуша — название чата-автора; имени
// админа в нём быть не должно ни при каком исходе поиска названия.
func TestSend_SendAs_PushTitleIsAuthorChatNotAdmin(t *testing.T) {
	in, _, fg, gid, chID := sendAsTestSetup(t)
	n := &fakeNotifier{}
	in.SetNotifier(n)
	ctx := context.Background()

	// от имени канала News
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "от канала", SendAsChatID: &chID, ClientMsgID: "p1"}); err != nil {
		t.Fatalf("send-as канал: %v", err)
	}
	// анонимный админ: от имени самой группы
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "анонимно", SendAsChatID: &gid, ClientMsgID: "p2"}); err != nil {
		t.Fatalf("send-as группа: %v", err)
	}
	// обычное сообщение: заголовок пуст — имя автора добавит воркер
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "от себя", ClientMsgID: "p3"}); err != nil {
		t.Fatalf("send: %v", err)
	}
	if got, want := n.msgTitles, []string{"News", "Team", ""}; !slices.Equal(got, want) {
		t.Fatalf("заголовки пушей = %q, want %q", got, want)
	}

	// название чата-автора не нашлось — не имя админа, а «Telegram»
	fg.mu.Lock()
	card := fg.cards[chID]
	card.Title = ""
	fg.cards[chID] = card
	fg.mu.Unlock()
	n.msgTitles = nil
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Type: "text", Text: "ещё", SendAsChatID: &chID, ClientMsgID: "p4"}); err != nil {
		t.Fatalf("send-as без названия: %v", err)
	}
	if len(n.msgTitles) != 1 || n.msgTitles[0] != "Telegram" {
		t.Fatalf("без названия заголовок = %q, want [Telegram]", n.msgTitles)
	}
}
