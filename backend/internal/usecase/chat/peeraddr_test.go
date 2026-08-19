package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Слой разрешения peerId ↔ внутренний chatID — единственное место, где живёт
// это соответствие (peeraddr.go). Здесь проверяется его контракт, и прежде
// всего АСИММЕТРИЯ приватного диалога: один и тот же разговор адресуется у двух
// сторон РАЗНЫМ ключом. Симметричное соответствие («один chatID — один peerId»)
// — самая естественная ошибка в этом месте, и она перепутала бы диалоги.

func TestPeerAddress_PrivateDialogIsAsymmetric(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 11, 22

	chatID, err := in.CreatePrivateChat(ctx, a, b)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}

	peerForA, err := in.ChatIDToPeer(ctx, a, chatID)
	if err != nil {
		t.Fatalf("ChatIDToPeer(a): %v", err)
	}
	peerForB, err := in.ChatIDToPeer(ctx, b, chatID)
	if err != nil {
		t.Fatalf("ChatIDToPeer(b): %v", err)
	}
	if peerForA != domain.PeerID(b) {
		t.Errorf("ключ у A = %d; want %d (id собеседника)", peerForA, b)
	}
	if peerForB != domain.PeerID(a) {
		t.Errorf("ключ у B = %d; want %d (id собеседника)", peerForB, a)
	}
	if peerForA == peerForB {
		t.Fatalf("стороны получили ОДИН ключ %d — соответствие симметрично, диалоги перепутаются", peerForA)
	}

	// Обратное направление возвращает ОДИН И ТОТ ЖЕ внутренний чат для обеих
	// сторон, каждой — по её собственному ключу.
	if got, err := in.PeerToChatID(ctx, a, peerForA); err != nil || got != chatID {
		t.Errorf("PeerToChatID(a, %d) = %d, %v; want %d", peerForA, got, err, chatID)
	}
	if got, err := in.PeerToChatID(ctx, b, peerForB); err != nil || got != chatID {
		t.Errorf("PeerToChatID(b, %d) = %d, %v; want %d", peerForB, got, err, chatID)
	}
	// А по ЧУЖОМУ ключу — не тот чат: ключ A (=b) глазами B это диалог B↔b,
	// которого нет. Это и есть защита от перепутывания сторон.
	if _, err := in.PeerToChatID(ctx, b, peerForA); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ключ A, применённый к B, разрешился вместо ErrNotFound: %v", err)
	}
}

func TestPeerAddress_ChatIsSameKeyForEveryone(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const chatID, a, b int64 = 7, 1, 2
	s.seedChat(chatID, "group", a, b)

	for _, viewer := range []int64{a, b} {
		peer, err := in.ChatIDToPeer(ctx, viewer, chatID)
		if err != nil {
			t.Fatalf("ChatIDToPeer(%d): %v", viewer, err)
		}
		if peer != domain.ToPeerID(chatID, true) {
			t.Errorf("ключ группы глазами %d = %d; want %d", viewer, peer, -chatID)
		}
		if !peer.IsAnyChat() {
			t.Errorf("ключ группы %d должен быть отрицательным", peer)
		}
	}
	if got, err := in.PeerToChatID(ctx, a, domain.ToPeerID(chatID, true)); err != nil || got != chatID {
		t.Errorf("PeerToChatID группы = %d, %v; want %d", got, err, chatID)
	}
}

// Строка chats приватного диалога — внутренняя деталь сервера. Отрицательным
// ключом она НЕ адресуется: иначе id разговора утекал бы наружу первым же
// запросом, и «приватного чата как сущности нет» перестало бы быть правдой.
func TestPeerAddress_PrivateRowNotAddressableByNegativeKey(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 11, 22
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.PeerToChatID(ctx, a, domain.ToPeerID(chatID, true)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("приватный чат адресовался по -chatID: err=%v", err)
	}
	// То же и для «Избранного».
	savedID, _ := in.GetOrCreateSaved(ctx, a)
	if _, err := in.PeerToChatID(ctx, a, domain.ToPeerID(savedID, true)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("«Избранное» адресовалось по -chatID: err=%v", err)
	}
}

// «Избранное» оригинала — это диалог с самим собой: peerId равен своему же id.
func TestPeerAddress_SavedMessagesIsSelf(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const me int64 = 5

	// До первого обращения чата нет — читающий путь отдаёт ErrNotFound…
	if _, err := in.PeerToChatID(ctx, me, domain.PeerID(me)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("несуществующее «Избранное» на читающем пути = %v; want ErrNotFound", err)
	}
	// …а пишущий его заводит (в оригинале отдельного «создать чат» нет вовсе).
	chatID, err := in.PeerToChatIDOrCreate(ctx, me, domain.PeerID(me))
	if err != nil || chatID == 0 {
		t.Fatalf("PeerToChatIDOrCreate(self) = %d, %v", chatID, err)
	}
	peer, err := in.ChatIDToPeer(ctx, me, chatID)
	if err != nil {
		t.Fatalf("ChatIDToPeer: %v", err)
	}
	if peer != domain.PeerID(me) {
		t.Errorf("ключ «Избранного» = %d; want %d (сам зритель)", peer, me)
	}
}

// Пишущий путь заводит приватный диалог, читающий — нет.
func TestPeerToChatID_CreateOnlyOnWritePath(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const me, other int64 = 3, 4

	if _, err := in.PeerToChatID(ctx, me, domain.PeerID(other)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("читающий путь завёл чат или вернул не ErrNotFound: %v", err)
	}
	chatID, err := in.PeerToChatIDOrCreate(ctx, me, domain.PeerID(other))
	if err != nil || chatID == 0 {
		t.Fatalf("PeerToChatIDOrCreate = %d, %v", chatID, err)
	}
	// Теперь читающий путь находит тот же чат — с ОБЕИХ сторон.
	if got, err := in.PeerToChatID(ctx, me, domain.PeerID(other)); err != nil || got != chatID {
		t.Errorf("PeerToChatID(me) = %d, %v; want %d", got, err, chatID)
	}
	if got, err := in.PeerToChatID(ctx, other, domain.PeerID(me)); err != nil || got != chatID {
		t.Errorf("PeerToChatID(other) = %d, %v; want %d", got, err, chatID)
	}
}

// «Пира нет» (NULL_PEER_ID оригинала) не должен превращаться в чат.
func TestPeerToChatID_NullPeer(t *testing.T) {
	in, _ := newInteractor()
	if _, err := in.PeerToChatID(context.Background(), 1, domain.NullPeerID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("NullPeerID разрешился: %v", err)
	}
}

// DialogPeerID отвечает без обращения к базе (у витрины уже есть тип чата и
// собеседник), но обязан давать ТОТ ЖЕ ответ, что и общий путь.
func TestDialogPeerID_MatchesResolver(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 11, 22
	privateID, _ := in.CreatePrivateChat(ctx, a, b)
	savedID, _ := in.GetOrCreateSaved(ctx, a)
	const groupID int64 = 90
	s.seedChat(groupID, "group", a, b)

	cases := []struct {
		name   string
		dialog domain.Dialog
	}{
		{"приватный", domain.Dialog{ChatID: privateID, Type: "private", Peer: &domain.UserReal{ID: b}}},
		{"избранное", domain.Dialog{ChatID: savedID, Type: "saved"}},
		{"группа", domain.Dialog{ChatID: groupID, Type: "group"}},
	}
	for _, c := range cases {
		want, err := in.ChatIDToPeer(ctx, a, c.dialog.ChatID)
		if err != nil {
			t.Fatalf("%s: ChatIDToPeer: %v", c.name, err)
		}
		if got := in.DialogPeerID(c.dialog, a); got != want {
			t.Errorf("%s: DialogPeerID = %d; ChatIDToPeer = %d", c.name, got, want)
		}
	}
}
