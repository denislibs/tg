package chat

import (
	"context"
	"errors"
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
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "group"
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Алиса"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}

	gid, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
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
	has := func(peer domain.PeerID) *domain.SendAsPeer {
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
	if msg.SendAsTitle != "News" {
		t.Fatalf("send_as title not hydrated: %q", msg.SendAsTitle)
	}
	// Serialization carries send_as while preserving the real sender.
	p := in.messageUpdatePayload(ctx, msg)
	sa, ok := p["send_as"].(map[string]any)
	if !ok {
		t.Fatalf("payload send_as missing: %+v", p)
	}
	if sa["peer_id"] != domain.ToPeerID(chID, true) || sa["title"] != "News" {
		t.Fatalf("payload send_as = %+v", sa)
	}
	if p["sender_id"] != int64(7) {
		t.Fatalf("payload sender_id = %v, want 7", p["sender_id"])
	}

	// A group member who is not an admin of the channel cannot post as it.
	if _, err := in.Send(ctx, SendInput{ChatID: gid, SenderID: 8, Type: "text", Text: "spoof", SendAsChatID: &chID, ClientMsgID: "s2"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("outsider send-as = %v, want ErrForbidden", err)
	}
	_ = s
}
