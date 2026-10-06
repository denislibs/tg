package domain

import (
	"testing"
	"time"
)

// A1-06/A4-06: личное ограничение зрителя доезжает до клиента в
// channel.banned_rights — и в карточке, и в строке списка чатов (оба — полный
// `channel` зрителя), а снимок без зрителя его не несёт.
func TestToChannel_ViewerBannedRights(t *testing.T) {
	r := &MemberRestriction{DeniedRights: PermSendMedia}
	settings := ChatSettings{DefaultPerms: AllMemberPerms}

	card := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, MyRole: RoleMember, Settings: settings, MyRestriction: r}.ToChannel()
	if card.BannedRights == nil || !card.BannedRights.Denies("send_media") || card.BannedRights.Denies("send_messages") {
		t.Fatalf("карточка: banned_rights = %#v", card.BannedRights)
	}
	row := DialogRecord{ChatID: 6, Type: ChatTypeGroup, MyRole: RoleMember, Settings: settings, MyRestriction: r}.ToChannel()
	if mustJSON(t, row.BannedRights) != mustJSON(t, card.BannedRights) {
		t.Fatalf("строка списка разошлась с карточкой: %s vs %s", mustJSON(t, row.BannedRights), mustJSON(t, card.BannedRights))
	}
	snapshot := ChatRecord{ID: 6, Type: ChatTypeGroup, Settings: settings, MyRestriction: r}.ToChannel()
	if snapshot.BannedRights != nil {
		t.Fatal("снимок без зрителя несёт чужое ограничение")
	}
	free := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, MyRole: RoleMember, Settings: settings}.ToChannel()
	if free.BannedRights != nil {
		t.Fatal("banned_rights без ограничения")
	}
	past := time.Now().Add(-time.Minute)
	expired := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, MyRole: RoleMember, Settings: settings,
		MyRestriction: &MemberRestriction{DeniedRights: PermSendMedia, UntilDate: &past}}.ToChannel()
	if expired.BannedRights != nil {
		t.Fatal("истёкшее ограничение доехало")
	}
}

// Б-115: счётчики участников — в карточке зрителя; без зрителя их нет.
func TestToChannelFull_Counters(t *testing.T) {
	kicked, banned, pending := 2, 0, 1
	k := &ParticipantCounters{Admins: 3, Kicked: &kicked, Banned: &banned,
		RequestsPending: &pending, RecentRequesters: []int64{42}, CanViewParticipants: true}
	full := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, MyRole: RoleCreator, Counters: k}.ToChannelFull()
	if full.AdminsCount != 3 || full.KickedCount == nil || *full.KickedCount != 2 ||
		full.BannedCount == nil || *full.BannedCount != 0 ||
		full.RequestsPending == nil || *full.RequestsPending != 1 || len(full.RecentRequesters) != 1 ||
		!full.PFlags["can_view_participants"] {
		t.Fatalf("channelFull = %s", mustJSON(t, full))
	}
	snap := ChatRecord{ID: 6, Type: ChatTypeGroup, Counters: k}.ToChannelFull()
	if snap.AdminsCount != 0 || snap.KickedCount != nil || snap.RequestsPending != nil || snap.PFlags["can_view_participants"] {
		t.Fatalf("снимок без зрителя несёт счётчики: %s", mustJSON(t, snap))
	}
	none := 0
	noReq := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, Counters: &ParticipantCounters{RequestsPending: &none}}.ToChannelFull()
	if noReq.RequestsPending != nil || noReq.RecentRequesters != nil {
		t.Fatalf("пустые заявки едут: %s", mustJSON(t, noReq))
	}
	// Группа обсуждения видит свой канал (Б-119).
	disc := ChatRecord{ID: 6, Type: ChatTypeGroup, ViewerID: 9, LinkedChannelID: 5}.ToChannelFull()
	if disc.LinkedChatID != 5 {
		t.Fatalf("linked_chat_id группы обсуждения = %d", disc.LinkedChatID)
	}
}
