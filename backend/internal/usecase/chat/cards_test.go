package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// A1-01: рядовой участник публичной группы-форума ищет её по имени. Выдача —
// ПОЛНАЯ карточка зрителя, а не урезанная строка поиска: не `min`,
// default_banned_rights из настроек группы (писать можно), pFlags.forum. Прежде
// строка поиска уходила `min` с «запрещено всё», клиент сливал её поверх
// карточки — композер блокировался, форум открывался обычным чатом.
func TestSearchPeers_OwnChatIsViewerCard(t *testing.T) {
	in, fg, fs, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	g, _ := fg.CreateMultiMember(ctx, domain.ChatTypeGroup, "Форум", "", "forum_pub", true, 7)
	_ = fg.AddMember(ctx, g, 8, domain.RoleMember, 0)
	_ = fg.SetForum(ctx, g, true)
	fs.chats = []int64{g}
	fs.ownChats = map[int64]bool{g: true}

	res, err := in.SearchPeers(ctx, 8, "Фор", 20)
	if err != nil || len(res.MyChats) != 1 {
		t.Fatalf("SearchPeers = %+v %v", res, err)
	}
	ch := res.MyChats[0].ToChannel()
	if ch.PFlags["min"] || ch.PFlags["left"] {
		t.Fatalf("своя группа в поиске: pFlags = %v, want полную форму участника", ch.PFlags)
	}
	if ch.DefaultBanned == nil || ch.DefaultBanned.Denies("send_messages") {
		t.Fatalf("default_banned_rights = %+v, want настройки группы (писать можно)", ch.DefaultBanned)
	}
	if !ch.PFlags["forum"] {
		t.Fatal("группа-форум в поиске без pFlags.forum")
	}
}

// A1-01 (тот же класс): похожие каналы и кандидаты обсуждения — тоже через
// общий сборщик. Кандидат обсуждения несёт фото и права админа: прежде
// урезанная строка без фото затирала аватарки групп админа.
func TestDiscussionCandidates_ViewerCards(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	g, _ := fg.CreateMultiMember(ctx, domain.ChatTypeGroup, "Группа", "", "", false, 7)
	_ = fg.AddMember(ctx, g, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetPhoto(ctx, g, 55)
	cands, err := in.DiscussionCandidates(ctx, 7)
	if err != nil || len(cands) != 1 {
		t.Fatalf("DiscussionCandidates = %+v %v", cands, err)
	}
	ch := cands[0].ToChannel()
	if !ch.PFlags["creator"] || ch.PFlags["min"] {
		t.Fatalf("кандидат: pFlags = %v, want creator без min", ch.PFlags)
	}
	if _, ok := ch.Photo.(domain.ChatPhotoReal); !ok {
		t.Fatalf("кандидат без фото: %#v", ch.Photo)
	}
}

// A1-24: личность-чат send-as — полная карточка зрителя (creator,
// admin_rights, default_banned_rights), а не урезанный не-min `channel`,
// который клиент оригинала кладёт поверх лежащей карточки целиком.
func TestGetSendAs_ChatIsViewerCard(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	g, _ := fg.CreateMultiMember(ctx, domain.ChatTypeGroup, "Группа", "", "", false, 7)
	_ = fg.AddMember(ctx, g, 7, domain.RoleCreator, domain.AllRights)
	peers, err := in.GetSendAs(ctx, 7, g)
	if err != nil {
		t.Fatalf("GetSendAs: %v", err)
	}
	var got *domain.Channel
	for _, p := range peers {
		if p.Chat != nil {
			got = p.Chat
		}
	}
	if got == nil {
		t.Fatalf("send-as без личности-группы: %+v", peers)
	}
	if !got.PFlags["creator"] || got.AdminRights == nil || got.DefaultBanned == nil {
		t.Fatalf("send-as группа: pFlags=%v admin=%v default=%v, want полную форму зрителя",
			got.PFlags, got.AdminRights, got.DefaultBanned)
	}
}

// A1-25: у группы обсуждения — ссылка на канал (linked_chat_id + has_link),
// у канала — на группу. Прежде поле знало только сторону канала.
func TestCard_LinkedChatBothSides(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := fg.CreateMultiMember(ctx, domain.ChatTypeChannel, "Канал", "", "", false, 7)
	g, _ := fg.CreateMultiMember(ctx, domain.ChatTypeGroup, "Обсуждение", "", "", false, 7)
	_ = fg.AddMember(ctx, ch, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.AddMember(ctx, g, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetDiscussion(ctx, ch, g)
	for _, c := range []struct{ id, linked int64 }{{ch, g}, {g, ch}} {
		card, err := in.ChatCard(ctx, c.id, 7)
		if err != nil {
			t.Fatalf("ChatCard(%d): %v", c.id, err)
		}
		if card.ToChannelFull().LinkedChatID != c.linked || !card.ToChannel().PFlags["has_link"] {
			t.Fatalf("чат %d: linked_chat_id=%d has_link=%v, want %d и has_link",
				c.id, card.ToChannelFull().LinkedChatID, card.ToChannel().PFlags["has_link"], c.linked)
		}
	}
}
