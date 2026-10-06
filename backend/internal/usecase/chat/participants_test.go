package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// listRecent — «недавние» глазами зрителя, сведённые к (user_id, роль) для
// проверок состава: роль — выбор конструктора.
func listRecent(in *Interactor, ctx context.Context, chatID, viewerID int64, limit int) ([]domain.Member, error) {
	page, err := in.ListParticipants(ctx, chatID, viewerID, domain.ParticipantsFilter{Kind: domain.ParticipantsRecent}, 0, limit)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Member, 0, len(page.Participants))
	for _, p := range page.Participants {
		switch v := p.(type) {
		case domain.ChannelParticipantCreator:
			out = append(out, domain.Member{UserID: v.UserID, Role: domain.RoleCreator})
		case domain.ChannelParticipantAdmin:
			out = append(out, domain.Member{UserID: v.UserID, Role: domain.RoleAdmin})
		case domain.ChannelParticipantSelf:
			out = append(out, domain.Member{UserID: v.UserID, Role: domain.RoleMember})
		case domain.ChannelParticipantReal:
			out = append(out, domain.Member{UserID: v.UserID, Role: domain.RoleMember})
		case domain.ChannelParticipantBanned:
			out = append(out, domain.Member{UserID: v.Peer.(domain.PeerUser).UserID, Role: domain.RoleMember})
		}
	}
	return out, nil
}

// newMembersTestInteractor — группа с конвейером сообщений, журналом и
// публикатором: кадры участника, заявок и пер-зрительские снимки видны в pub.
func newMembersTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeJoinRequestRepo, *fakePublisher, *store) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fjr := newFakeJoinRequestRepo()
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, fjr)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	in.SetChannelPublisher(&fakeChannelPublisher{})
	for id, name := range map[int64]string{7: "Алиса", 8: "Боб", 9: "Чарли", 10: "Дарья"} {
		fg.users[id] = domain.UserReal{ID: id, FirstName: name}
	}
	return in, fg, fjr, pub, s
}

// framesOf — кадры пользователю с данным типом журнала (`t`), разобранные.
func framesOf(t *testing.T, pub *fakePublisher, userID int64, typ string) []map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	var out []map[string]any
	for _, f := range pub.frames {
		if f.userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if err := json.Unmarshal(f.frame, &env); err != nil {
			t.Fatalf("кадр не разобрался: %s", f.frame)
		}
		if env.T == typ {
			out = append(out, env.D)
		}
	}
	return out
}

// chatOf — краткий `channel` из кадра chat_update.
func chatOf(t *testing.T, d map[string]any) map[string]any {
	t.Helper()
	full, _ := d["chat_full"].(map[string]any)
	chats, _ := full["chats"].([]any)
	if len(chats) != 1 {
		t.Fatalf("chat_update без channel: %v", d)
	}
	return chats[0].(map[string]any)
}

// A2-05 + A1-06: ограниченный получает пер-зрительский (НЕ min) channel с
// banned_rights — скрепка гаснет живьём; админы — кадр участника. Снятие
// ограничения — то же в обратную сторону.
func TestRestrict_ViewerChannelAndParticipantFrames(t *testing.T) {
	in, fg, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	_ = fg.SetRole(ctx, id, 9, domain.RoleAdmin, domain.RightBanUsers, 7)
	pub.reset()

	if err := in.RestrictMember(ctx, id, 7, 8, domain.PermSendMedia, 0); err != nil {
		t.Fatal(err)
	}
	ups := framesOf(t, pub, 8, "chat_update")
	if len(ups) != 1 {
		t.Fatalf("ограниченному chat_update = %d; want 1", len(ups))
	}
	ch := chatOf(t, ups[0])
	if flags, _ := ch["pFlags"].(map[string]any); flags["min"] == true {
		t.Fatalf("ограниченному ушёл min-снимок: %v", ch)
	}
	br, _ := ch["banned_rights"].(map[string]any)
	if fl, _ := br["pFlags"].(map[string]any); fl["send_media"] != true {
		t.Fatalf("banned_rights = %v; want send_media", br)
	}
	// Другой админ с ban_users видит ограничение; актор (7) применил смену
	// местно и серверного кадра не получает (ревью #404 п. 4).
	ps := framesOf(t, pub, 9, "chat_participant")
	if len(ps) != 1 || ps[0]["_"] != domain.UpdateChannelParticipantTag {
		t.Fatalf("админу 9 кадр участника = %v", ps)
	}
	if np, _ := ps[0]["new_participant"].(map[string]any); np["_"] != domain.ChannelParticipantBannedTag {
		t.Fatalf("new_participant = %v", np)
	}
	if got := framesOf(t, pub, 7, "chat_participant"); len(got) != 0 {
		t.Fatalf("актору ушёл серверный кадр поверх местного: %v", got)
	}

	pub.reset()
	if err := in.UnrestrictMember(ctx, id, 7, 8); err != nil {
		t.Fatal(err)
	}
	ups = framesOf(t, pub, 8, "chat_update")
	if len(ups) != 1 {
		t.Fatalf("после снятия chat_update = %d; want 1", len(ups))
	}
	if _, has := chatOf(t, ups[0])["banned_rights"]; has {
		t.Fatal("после снятия ограничения banned_rights остался")
	}
	if ps := framesOf(t, pub, 9, "chat_participant"); len(ps) != 1 {
		t.Fatalf("снятие ограничения: админу кадров %d", len(ps))
	}
}

// A2-05: повышенный получает свои admin_rights живьём (не min), снятый — их
// исчезновение; админы — кадр участника с promoted_by и рангом.
func TestPromoteDemote_ViewerChannel(t *testing.T) {
	in, fg, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	_ = fg.SetRole(ctx, id, 9, domain.RoleAdmin, domain.RightPinMessages, 7)
	pub.reset()

	if err := in.PromoteAdmin(ctx, id, 7, 8, domain.RightPinMessages|domain.RightBanUsers, ptr("  модератор с длинной подписью  ")); err != nil {
		t.Fatal(err)
	}
	ups := framesOf(t, pub, 8, "chat_update")
	var mine map[string]any
	for _, u := range ups {
		ch := chatOf(t, u)
		if flags, _ := ch["pFlags"].(map[string]any); flags["min"] != true {
			mine = ch
		}
	}
	if mine == nil || mine["admin_rights"] == nil {
		t.Fatalf("повышенный не получил свои admin_rights: %v", ups)
	}
	if got := framesOf(t, pub, 7, "chat_participant"); len(got) != 0 {
		t.Fatalf("актору ушёл серверный кадр поверх местного: %d", len(got))
	}
	ps := framesOf(t, pub, 9, "chat_participant")
	if len(ps) != 1 {
		t.Fatalf("другому админу кадров участника %d", len(ps))
	}
	np, _ := ps[0]["new_participant"].(map[string]any)
	if np["_"] != domain.ChannelParticipantAdminTag || np["promoted_by"] != float64(7) || np["rank"] != "модератор с длин" {
		t.Fatalf("new_participant = %v", np)
	}

	pub.reset()
	if err := in.DemoteAdmin(ctx, id, 7, 8); err != nil {
		t.Fatal(err)
	}
	var demoted map[string]any
	for _, u := range framesOf(t, pub, 8, "chat_update") {
		ch := chatOf(t, u)
		if flags, _ := ch["pFlags"].(map[string]any); flags["min"] != true {
			demoted = ch
		}
	}
	if demoted == nil || demoted["admin_rights"] != nil {
		t.Fatalf("снятый админ: %v", demoted)
	}
}

// A2-06/A6-04: подача заявки — кадр заявок админам с invite_users (не
// обычным участникам); одобрение — служебка «вступил по заявке», снимок чата
// одобренному, кадр участника и заявок; отклонение — кадр заявок.
func TestJoinRequests_Frames(t *testing.T) {
	in, fg, fjr, pub, s := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	_ = fg.SetRole(ctx, id, 9, domain.RoleAdmin, domain.RightPinMessages, 7) // не участник — SetRole no-op
	link, err := in.CreateInvite(ctx, id, 7, "", nil, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	pub.reset()

	if _, requested, err := in.JoinByToken(ctx, link.Token, 10); err != nil || !requested {
		t.Fatalf("заявка: requested=%v err=%v", requested, err)
	}
	pend := framesOf(t, pub, 7, "pending_join_requests")
	if len(pend) != 1 || pend[0]["requests_pending"] != float64(1) {
		t.Fatalf("владельцу кадр заявок = %v", pend)
	}
	if got := framesOf(t, pub, 8, "pending_join_requests"); len(got) != 0 {
		t.Fatal("обычному участнику ушёл кадр заявок")
	}
	// Карточка владельца: requests_pending/recent_requesters.
	card, _ := in.ChatCard(ctx, id, 7)
	full := card.ToChannelFull()
	if full.RequestsPending == nil || *full.RequestsPending != 1 || len(full.RecentRequesters) != 1 || full.RecentRequesters[0] != 10 {
		t.Fatalf("карточка владельца: %+v", full)
	}
	if c8, _ := in.ChatCard(ctx, id, 8); c8.ToChannelFull().RequestsPending != nil {
		t.Fatal("обычный участник видит заявки")
	}

	pub.reset()
	if err := in.ApproveJoinRequest(ctx, id, 7, 10); err != nil {
		t.Fatal(err)
	}
	msgs := s.messages[id]
	last := msgs[len(msgs)-1]
	if _, ok := last.Action.(domain.MessageActionChatJoinedByRequest); !ok || last.SenderID != 10 {
		t.Fatalf("служебка одобрения: %#v от %d", last.Action, last.SenderID)
	}
	if ups := framesOf(t, pub, 10, "chat_update"); len(ups) == 0 {
		t.Fatal("одобренный не получил снимок чата")
	}
	if ps := framesOf(t, pub, 7, "chat_participant"); len(ps) != 1 {
		t.Fatalf("кадр участника владельцу: %d", len(ps))
	}
	if pend := framesOf(t, pub, 7, "pending_join_requests"); len(pend) != 1 || pend[0]["requests_pending"] != float64(0) {
		t.Fatalf("после одобрения кадр заявок = %v", pend)
	}
	if m, err := fg.GetMember(ctx, id, 10); err != nil || !m.ViaRequest || m.InviterID != 7 {
		t.Fatalf("одобренный: %+v %v", m, err)
	}

	_, _ = fjr.Create(ctx, id, 9, link.Token)
	pub.reset()
	if err := in.DeclineJoinRequest(ctx, id, 7, 9); err != nil {
		t.Fatal(err)
	}
	if pend := framesOf(t, pub, 7, "pending_join_requests"); len(pend) != 1 {
		t.Fatalf("отклонение: кадров заявок %d", len(pend))
	}
}

// A4-07/A6-06/Б-115: count — всего, а не длина страницы; админы — отдельным
// фильтром, создатель первым; удалённые — только с ban_users.
func TestListParticipants_CountAndFilters(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9, 10})
	_ = fg.SetRole(ctx, id, 9, domain.RoleAdmin, domain.RightPinMessages, 7)

	page, err := in.ListParticipants(ctx, id, 8, domain.ParticipantsFilter{Kind: domain.ParticipantsRecent}, 0, 2)
	if err != nil || page.Count != 4 || len(page.Participants) != 2 {
		t.Fatalf("страница: count=%d len=%d err=%v; want 4/2", page.Count, len(page.Participants), err)
	}
	admins, _ := in.ListParticipants(ctx, id, 8, domain.ParticipantsFilter{Kind: domain.ParticipantsAdmins}, 0, 50)
	if admins.Count != 2 || admins.Participants[0].Tag() != domain.ChannelParticipantCreatorTag {
		t.Fatalf("админы: %+v", admins)
	}
	if a, ok := admins.Participants[1].(domain.ChannelParticipantAdmin); !ok || a.PFlags["can_edit"] {
		t.Fatalf("админ глазами участника правим: %#v", admins.Participants[1])
	}
	byOwner, _ := in.ListParticipants(ctx, id, 7, domain.ParticipantsFilter{Kind: domain.ParticipantsAdmins}, 0, 50)
	if a, ok := byOwner.Participants[1].(domain.ChannelParticipantAdmin); !ok || !a.PFlags["can_edit"] {
		t.Fatalf("админ глазами владельца не правим: %#v", byOwner.Participants[1])
	}
	if _, err := in.ListParticipants(ctx, id, 8, domain.ParticipantsFilter{Kind: domain.ParticipantsKicked}, 0, 50); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("удалённые обычному участнику: %v", err)
	}
	if err := in.BanMember(ctx, id, 7, 10); err != nil {
		t.Fatal(err)
	}
	kicked, err := in.ListParticipants(ctx, id, 7, domain.ParticipantsFilter{Kind: domain.ParticipantsKicked}, 0, 50)
	if err != nil || kicked.Count != 1 {
		t.Fatalf("удалённые: %+v %v", kicked, err)
	}
	if b, ok := kicked.Participants[0].(domain.ChannelParticipantBanned); !ok || !b.PFlags["left"] {
		t.Fatalf("удалённый: %#v", kicked.Participants[0])
	}
	// Счётчики карточки владельца.
	card, _ := in.ChatCard(ctx, id, 7)
	full := card.ToChannelFull()
	if full.AdminsCount != 2 || full.KickedCount == nil || *full.KickedCount != 1 || !full.PFlags["can_view_participants"] {
		t.Fatalf("счётчики владельца: %+v", full)
	}
	if c8, _ := in.ChatCard(ctx, id, 8); c8.ToChannelFull().KickedCount != nil || c8.ToChannelFull().AdminsCount != 2 {
		t.Fatalf("счётчики участника: %+v", c8.ToChannelFull())
	}
}

// channels.getParticipant: себя — Self, не участника — ErrNotFound
// (USER_NOT_PARTICIPANT), удалённого постороннему не показывают.
func TestGetParticipant(t *testing.T) {
	in, _, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	p, _, err := in.GetParticipant(ctx, id, 8, 8)
	if err != nil || p.Tag() != domain.ChannelParticipantSelfTag {
		t.Fatalf("себя: %#v %v", p, err)
	}
	if _, _, err := in.GetParticipant(ctx, id, 8, 99); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не участник: %v", err)
	}
	_ = in.BanMember(ctx, id, 7, 9)
	if _, _, err := in.GetParticipant(ctx, id, 8, 9); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("удалённый постороннему: %v", err)
	}
	if p, _, err := in.GetParticipant(ctx, id, 7, 9); err != nil || p.Tag() != domain.ChannelParticipantBannedTag {
		t.Fatalf("удалённый владельцу: %#v %v", p, err)
	}
}

// A2-07: вступление по @имени в группу — служебка, chat_update и кадр
// участника; в канал — без служебки.
func TestJoinPublic_Frames(t *testing.T) {
	in, fg, _, pub, s := newMembersTestInteractor(t)
	ctx := context.Background()
	search := newFakeSearchRepo()
	in.search = search
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "team", true, nil)
	search.usernames["team"] = id
	_ = fg
	pub.reset()
	if err := in.JoinPublic(ctx, "team", 8); err != nil {
		t.Fatal(err)
	}
	if msgs := s.messages[id]; len(msgs) == 0 {
		t.Fatal("нет служебки вступления")
	} else if add, ok := msgs[len(msgs)-1].Action.(domain.MessageActionChatAddUser); !ok || add.Users[0] != 8 {
		t.Fatalf("служебка: %#v", msgs[len(msgs)-1].Action)
	}
	if ps := framesOf(t, pub, 7, "chat_participant"); len(ps) != 1 {
		t.Fatalf("владельцу кадр участника: %d", len(ps))
	}
	if ups := framesOf(t, pub, 7, "chat_update"); len(ups) == 0 {
		t.Fatal("владельцу нет chat_update (число участников)")
	}
}

// Ревью #404 п. 2: чужое ограничение видит только админ с ban_users и сам
// ограниченный; обычному участнику — обычная строка, и в выдаче, и в
// getParticipant, и в кадре участника админу без ban_users.
func TestRestricted_HiddenFromNonBanViewers(t *testing.T) {
	in, fg, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9, 10})
	_ = fg.SetRole(ctx, id, 10, domain.RoleAdmin, domain.RightPinMessages, 7) // админ без ban_users
	pub.reset()
	if err := in.RestrictMember(ctx, id, 7, 8, domain.PermSendMedia, 0); err != nil {
		t.Fatal(err)
	}
	tagOf := func(viewer int64, f domain.ParticipantsFilterKind) string {
		t.Helper()
		page, err := in.ListParticipants(ctx, id, viewer, domain.ParticipantsFilter{Kind: f}, 0, 50)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range page.Participants {
			switch v := p.(type) {
			case domain.ChannelParticipantBanned:
				if v.Peer.(domain.PeerUser).UserID == 8 {
					return v.Tag()
				}
			case domain.ChannelParticipantReal:
				if v.UserID == 8 {
					return v.Tag()
				}
			case domain.ChannelParticipantSelf:
				if v.UserID == 8 {
					return v.Tag()
				}
			}
		}
		return ""
	}
	for _, f := range []domain.ParticipantsFilterKind{domain.ParticipantsRecent, domain.ParticipantsSearch, domain.ParticipantsMentions} {
		if got := tagOf(9, f); got != domain.ChannelParticipantTag {
			t.Fatalf("%s глазами участника: %q", f, got)
		}
		if got := tagOf(7, f); got != domain.ChannelParticipantBannedTag {
			t.Fatalf("%s глазами владельца: %q", f, got)
		}
	}
	if got := tagOf(8, domain.ParticipantsRecent); got != domain.ChannelParticipantBannedTag {
		t.Fatalf("своё ограничение: %q", got)
	}
	if p, _, err := in.GetParticipant(ctx, id, 9, 8); err != nil || p.Tag() != domain.ChannelParticipantTag {
		t.Fatalf("getParticipant глазами участника: %#v %v", p, err)
	}
	ps := framesOf(t, pub, 10, "chat_participant")
	if len(ps) != 1 {
		t.Fatalf("админу без ban_users кадров %d", len(ps))
	}
	if np, _ := ps[0]["new_participant"].(map[string]any); np["_"] != domain.ChannelParticipantTag {
		t.Fatalf("админу без ban_users ограничение раскрыто: %v", np)
	}
}

// Ревью #404 п. 3: смена прав чата по умолчанию — ограниченному свежий
// пер-зрительский снимок с новым действующим banned_rights.
func TestSetChatPermissions_RepublishesRestricted(t *testing.T) {
	in, _, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	if err := in.RestrictMember(ctx, id, 7, 8, domain.PermPinMessages, 0); err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMedia, 0); err != nil {
		t.Fatal(err)
	}
	var mine map[string]any
	for _, u := range framesOf(t, pub, 8, "chat_update") {
		if ch := chatOf(t, u); ch["banned_rights"] != nil {
			mine = ch
		}
	}
	if mine == nil {
		t.Fatal("ограниченный не получил снимок со своим banned_rights")
	}
	fl, _ := mine["banned_rights"].(map[string]any)["pFlags"].(map[string]any)
	if fl["send_media"] != true || fl["pin_messages"] != true {
		t.Fatalf("banned_rights = %v; want send_media ∪ pin_messages", fl)
	}
	for _, u := range framesOf(t, pub, 9, "chat_update") {
		if chatOf(t, u)["banned_rights"] != nil {
			t.Fatal("неограниченному ушёл личный снимок")
		}
	}
}

// Ревью #404 п. 5: владелец задаёт себе подпись; чужой админ себе — нет.
func TestPromoteAdmin_OwnerOwnRank(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	if err := in.PromoteAdmin(ctx, id, 7, 7, 0, ptr("основатель")); err != nil {
		t.Fatalf("владелец себе: %v", err)
	}
	if m, _ := fg.GetMember(ctx, id, 7); m.Rank != "основатель" || m.Role != domain.RoleCreator || m.Rights != domain.AllRights {
		t.Fatalf("владелец после подписи: %+v", m)
	}
	_ = fg.SetRole(ctx, id, 8, domain.RoleAdmin, domain.RightManageAdmins, 7)
	if err := in.PromoteAdmin(ctx, id, 8, 8, domain.AllRights, ptr("я главный")); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ себе: %v", err)
	}
	// Без поля rank подпись не трогается (старый клиент).
	_ = fg.SetRank(ctx, id, 8, "модер")
	if err := in.PromoteAdmin(ctx, id, 7, 8, domain.RightPinMessages, nil); err != nil {
		t.Fatal(err)
	}
	if m, _ := fg.GetMember(ctx, id, 8); m.Rank != "модер" {
		t.Fatalf("подпись стёрта: %+v", m)
	}
}

// Ревью #404 п. 11: повышение снимает личное ограничение — после
// разжалования оно не «воскресает».
func TestPromoteAdmin_ClearsRestriction(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	id, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	_ = in.RestrictMember(ctx, id, 7, 8, domain.PermSendMedia, 0)
	if err := in.PromoteAdmin(ctx, id, 7, 8, domain.RightPinMessages, nil); err != nil {
		t.Fatal(err)
	}
	if err := in.DemoteAdmin(ctx, id, 7, 8); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := fg.GetRestriction(ctx, id, 8); ok {
		t.Fatal("ограничение пережило повышение")
	}
}

// Ревью #404 п. 7: вступившему по ссылке — личный снимок (второе устройство
// видит канал); п. 11: повторная заявка кадра заявок не шлёт.
func TestJoinByLink_ViewerSnapshotAndRepeatRequest(t *testing.T) {
	in, _, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Канал", "", "", false)
	link, _ := in.CreateInvite(ctx, ch, 7, "", nil, false, nil)
	pub.reset()
	if _, _, err := in.JoinByToken(ctx, link.Token, 8); err != nil {
		t.Fatal(err)
	}
	if ups := framesOf(t, pub, 8, "chat_update"); len(ups) == 0 {
		t.Fatal("вступившему по ссылке нет личного снимка")
	}

	g, _, _ := in.CreateGroup(ctx, 7, "Team", "", "", false, nil)
	req, _ := in.CreateInvite(ctx, g, 7, "", nil, true, nil)
	_, _, _ = in.JoinByToken(ctx, req.Token, 9)
	pub.reset()
	_, _, _ = in.JoinByToken(ctx, req.Token, 9)
	if got := framesOf(t, pub, 7, "pending_join_requests"); len(got) != 0 {
		t.Fatalf("повторная заявка: кадров %d", len(got))
	}
}

// Ревью #404 п. 12: одобрение заявки в broadcast-канале — без служебки
// состава (isMembershipAction с JoinedByRequest).
func TestApproveJoinRequest_BroadcastNoService(t *testing.T) {
	in, _, _, _, s := newMembersTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Канал", "", "", false)
	req, _ := in.CreateInvite(ctx, ch, 7, "", nil, true, nil)
	_, _, _ = in.JoinByToken(ctx, req.Token, 8)
	before := len(s.messages[ch])
	if err := in.ApproveJoinRequest(ctx, ch, 7, 8); err != nil {
		t.Fatal(err)
	}
	if len(s.messages[ch]) != before {
		t.Fatalf("служебка вступления в канале: %#v", s.messages[ch][len(s.messages[ch])-1].Action)
	}
}
