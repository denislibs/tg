package chat

import (
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// A1-11: пер-зрительский out/mentioned ДОПИСЫВАЕТСЯ к базовым pFlags
// сообщения, а не заменяет их. ToWireMap отдаёт pFlags как map[string]any.
func TestWithPeerKeepsBasePFlags(t *testing.T) {
	m := domain.Message{Seq: 7, Type: "voice", MediaUnread: true, CreatedAt: time.Now()}
	base := map[string]any{"_": domain.UpdateNewMessageTag, frameMessageKey: m.ToWireMap(domain.MessageContext{Post: true})}
	d := withPeer(base, domain.PeerID(-5), viewerFlags{out: true})
	flags, _ := d[frameMessageKey].(map[string]any)["pFlags"].(map[string]bool)
	if !flags["media_unread"] || !flags["post"] || !flags["out"] {
		t.Fatalf("базовые флаги потеряны: %#v", flags)
	}
}
