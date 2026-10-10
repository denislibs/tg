package chat

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// A2-26 / A3-24: новое сообщение возвращает архивный незаглушённый чат
// получателя из архива и шлёт ему updateFolderPeers (folder 0); заглушённый
// остаётся в архиве, автор свой архив не теряет.
func TestSend_UnarchivesUnmutedRecipient(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const chatID, a, b, c int64 = 80, 1, 2, 3
	s.seedChat(chatID, domain.ChatTypeGroup, a, b, c)
	future := time.Now().Add(time.Hour)
	s.members[chatID][a].archived = true
	s.members[chatID][b].archived = true
	s.members[chatID][c].archived = true
	s.members[chatID][c].mutedUntil = &future

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if s.members[chatID][b].archived {
		t.Fatal("незаглушённый получатель остался в архиве")
	}
	if !s.members[chatID][c].archived || !s.members[chatID][a].archived {
		t.Fatal("заглушённый получатель или автор потеряли архив")
	}
	d := lastFrameOfType(t, pub, b, "dialog_archive")
	fp, _ := d["folder_peers"].([]any)
	if len(fp) != 1 || fp[0].(map[string]any)["folder_id"] != float64(0) {
		t.Fatalf("кадр папки = %#v, want folder_id 0", d)
	}
	for _, f := range pub.frames {
		if f.userID == c && strings.Contains(string(f.frame), `"t":"dialog_archive"`) {
			t.Fatal("заглушённому ушёл кадр разархивирования")
		}
	}
}
