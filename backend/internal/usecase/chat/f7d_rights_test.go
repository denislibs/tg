package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Регрессии Ф7-Д «Права в группе» (MC-11, MC-12, MC-13).

// MC-11: описание правит ТОЛЬКО описание. Прежде EditInfo писал title, about и
// username одним UPDATE, и админ с change_info, менявший описание, затирал
// публичное имя группы значением из своего устаревшего кэша.
func TestEditAbout_KeepsUsernameAndTitle(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, err := in.CreateGroup(ctx, 7, "Группа", "было", "grp", true, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	if err := fg.SetRole(ctx, g, 8, domain.RoleAdmin, domain.RightChangeInfo, 7); err != nil {
		t.Fatal(err)
	}

	if err := in.EditAbout(ctx, g, 8, "новое"); err != nil {
		t.Fatalf("EditAbout: %v", err)
	}
	c, _ := fg.Card(ctx, g, 7)
	if c.About != "новое" || c.Username != "grp" || c.Title != "Группа" {
		t.Fatalf("после EditAbout: about=%q username=%q title=%q; ждали «новое», grp, «Группа»", c.About, c.Username, c.Title)
	}
}

// MC-11: название правит только название; служебка уходит лишь при смене.
func TestEditTitle_PostsServiceOnChange(t *testing.T) {
	in, fg, _, _, s := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, err := in.CreateGroup(ctx, 7, "А", "описание", "grp", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	service := func() int {
		n := 0
		for _, m := range s.messages[g] {
			if _, ok := m.Action.(domain.MessageActionChatEditTitle); ok {
				n++
			}
		}
		return n
	}

	if err := in.EditTitle(ctx, g, 7, "Б"); err != nil {
		t.Fatalf("EditTitle: %v", err)
	}
	if service() != 1 {
		t.Fatalf("служебок о смене названия = %d, ждали 1", service())
	}
	if err := in.EditTitle(ctx, g, 7, "Б"); err != nil {
		t.Fatalf("EditTitle повтор: %v", err)
	}
	if service() != 1 {
		t.Fatalf("повтор того же названия добавил служебку: %d", service())
	}
	c, _ := fg.Card(ctx, g, 7)
	if c.Title != "Б" || c.About != "описание" || c.Username != "grp" {
		t.Fatalf("после EditTitle: title=%q about=%q username=%q", c.Title, c.About, c.Username)
	}
}

// MC-11: право change_info нужно обоим.
func TestEditTitleAbout_NeedChangeInfo(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8, 9})
	_ = fg.SetRole(ctx, g, 9, domain.RoleAdmin, domain.RightPinMessages, 7)
	// Дефолт участника без change_info.
	_ = fg.SetPermissions(ctx, g, domain.AllMemberPerms&^domain.PermChangeInfo, 0)
	for _, actor := range []int64{8, 9} {
		if err := in.EditTitle(ctx, g, actor, "захват"); !errors.Is(err, domain.ErrForbidden) {
			t.Fatalf("EditTitle от %d без права: %v", actor, err)
		}
		if err := in.EditAbout(ctx, g, actor, "захват"); !errors.Is(err, domain.ErrForbidden) {
			t.Fatalf("EditAbout от %d без права: %v", actor, err)
		}
	}
}

// MC-12: channels.editAdmin для не-участника — вступление и права за один
// вызов (tweb addBotToChat.ts:41-58, :117-135). Служебка «добавил(а)», ровно
// один кадр участника «не было → admin».
func TestPromoteAdmin_NonMemberJoinsAsAdmin(t *testing.T) {
	in, fg, _, pub, s := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)
	pub.reset()

	if err := in.PromoteAdmin(ctx, g, 7, 10, domain.RightPinMessages|domain.RightChangeInfo, nil); err != nil {
		t.Fatalf("PromoteAdmin не-участника: %v", err)
	}
	m, err := fg.GetMember(ctx, g, 10)
	if err != nil || m.Role != domain.RoleAdmin || m.Rights != domain.RightPinMessages|domain.RightChangeInfo || m.PromotedBy != 7 {
		t.Fatalf("строка участника: %+v err=%v; ждали admin с правами, promoted_by=7", m, err)
	}
	msgs := s.messages[g]
	if add, ok := msgs[len(msgs)-1].Action.(domain.MessageActionChatAddUser); !ok || len(add.Users) != 1 || add.Users[0] != 10 {
		t.Fatalf("служебка: %#v", msgs[len(msgs)-1].Action)
	}
	ps := framesOf(t, pub, 7, "chat_participant")
	if len(ps) != 1 {
		t.Fatalf("кадров участника актору: %d, ждали 1", len(ps))
	}
	if _, has := ps[0]["prev_participant"]; has {
		t.Fatalf("prev_participant есть у не-участника: %v", ps[0]["prev_participant"])
	}
	if np, _ := ps[0]["new_participant"].(map[string]any); np["_"] != domain.ChannelParticipantAdminTag {
		t.Fatalf("new_participant = %v; ждали admin", np)
	}
}

// MC-12: запрет приглашений у цели — отказ, строки участника нет.
func TestPromoteAdmin_NonMemberPrivacy(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	in.SetPrivacy(denyInvites{deny: map[int64]bool{10: true}})
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)

	if err := in.PromoteAdmin(ctx, g, 7, 10, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("PromoteAdmin при запрете приглашений: %v, ждали ErrPrivacy", err)
	}
	if _, err := fg.GetMember(ctx, g, 10); err == nil {
		t.Fatal("запретивший приглашения оказался в группе")
	}
}

// MC-12: забаненного не-участника админ без ban_users не возвращает — ни
// вступлением, ни правами.
func TestPromoteAdmin_BannedNonMemberNeedsBanUsers(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8, 9})
	_ = fg.SetRole(ctx, g, 8, domain.RoleAdmin, domain.RightManageAdmins|domain.RightPinMessages, 7)
	_ = fg.Ban(ctx, g, 9, 7)
	_ = fg.RemoveMember(ctx, g, 9)

	if err := in.PromoteAdmin(ctx, g, 8, 9, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ без ban_users вернул забаненного: %v", err)
	}
	if _, err := fg.GetMember(ctx, g, 9); err == nil {
		t.Fatal("забаненный оказался в группе")
	}
	// Владелец (ban_users есть) — возвращает и снимает бан.
	if err := in.PromoteAdmin(ctx, g, 7, 9, domain.RightPinMessages, nil); err != nil {
		t.Fatalf("владелец не вернул забаненного: %v", err)
	}
	if m, err := fg.GetMember(ctx, g, 9); err != nil || m.Role != domain.RoleAdmin {
		t.Fatalf("после возврата: %+v err=%v", m, err)
	}
}

// MC-12: право на назначение по-прежнему обязательно — не-участника без
// manage_admins у актора назначить нельзя.
func TestPromoteAdmin_NonMemberStillNeedsManageAdmins(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	if err := in.PromoteAdmin(ctx, g, 8, 10, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("участник без manage_admins назначил: %v", err)
	}
	if _, err := fg.GetMember(ctx, g, 10); err == nil {
		t.Fatal("отказ оставил строку участника")
	}
}

// MC-13: создатель вышел и вернулся по публичному имени — снова владелец, а не
// рядовой участник.
func TestCreatorRejoinGetsCreatorRole(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	search := newFakeSearchRepo()
	in.search = search
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "grp", true, []int64{8})
	search.usernames["grp"] = g

	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatalf("создатель не вышел: %v", err)
	}
	if err := in.JoinPublic(ctx, "grp", 7); err != nil {
		t.Fatalf("возврат по имени: %v", err)
	}
	m, err := fg.GetMember(ctx, g, 7)
	if err != nil || m.Role != domain.RoleCreator {
		t.Fatalf("вернувшийся создатель: %+v err=%v; ждали creator", m, err)
	}
	// Чужой вход по имени — по-прежнему рядовой.
	if err := in.JoinPublic(ctx, "grp", 9); err != nil {
		t.Fatal(err)
	}
	if m, _ := fg.GetMember(ctx, g, 9); m.Role != domain.RoleMember {
		t.Fatalf("чужой вход: роль %q", m.Role)
	}
	// И вернувшийся создатель снова правит тип.
	if err := in.SetChatType(ctx, g, 7, true, "grp2"); err != nil {
		t.Fatalf("SetChatType вернувшимся создателем: %v", err)
	}
}

// MC-13: пока создатель вышел, его права признаёт сервер без строки участника
// (tweb hasRights.ts:6-7, :25-27): тип группы и назначение админа.
func TestLeftCreator_RightsWithoutMemberRow(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "grp", true, []int64{8})
	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := fg.GetMember(ctx, g, 7); err == nil {
		t.Fatal("создатель остался участником")
	}

	if err := in.SetChatType(ctx, g, 7, true, "grp2"); err != nil {
		t.Fatalf("SetChatType вышедшим создателем: %v", err)
	}
	if err := in.PromoteAdmin(ctx, g, 7, 8, domain.RightPinMessages, nil); err != nil {
		t.Fatalf("PromoteAdmin вышедшим создателем: %v", err)
	}
	// Вышедший НЕ-создатель прав не имеет.
	setMember(fg, g, 9, domain.RoleAdmin, domain.AllRights, 7)
	_ = fg.RemoveMember(ctx, g, 9)
	if err := in.SetChatType(ctx, g, 9, true, "grp3"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("SetChatType вышедшим админом: %v", err)
	}
	if err := in.PromoteAdmin(ctx, g, 9, 8, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("PromoteAdmin вышедшим админом: %v", err)
	}
}

// MC-13: отправка вышедшего создателя сначала возвращает его в чат (строка
// creator), и сообщение попадает в его ленту. Tweb: «creator can still send
// messages to left channel» (hasRights.ts:6-7).
func TestLeftCreator_SendRejoins(t *testing.T) {
	in, fg, _, pub, s := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatal(err)
	}
	pub.reset()

	msg, err := in.Send(ctx, SendInput{ChatID: g, SenderID: 7, Text: "я вернулся", ClientMsgID: "c1"})
	if err != nil {
		t.Fatalf("Send вышедшего создателя: %v", err)
	}
	m, gerr := fg.GetMember(ctx, g, 7)
	if gerr != nil || m.Role != domain.RoleCreator {
		t.Fatalf("после отправки: %+v err=%v; ждали creator", m, gerr)
	}
	if msg.ID == 0 || s.messages[g][len(s.messages[g])-1].Text != "я вернулся" {
		t.Fatalf("сообщения нет в чате: %+v", s.messages[g])
	}
	// Автор получил своё сообщение живьём и в журнале (он в веере).
	if len(framesOf(t, pub, 7, "new_message")) == 0 {
		t.Fatal("автору не доставлено его сообщение")
	}
}

// MC-13: то же для опроса и чек-листа (свои гейты членства).
func TestLeftCreator_PollAndChecklistRejoin(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	in.polls = newFakePolls()
	in.checklists = newFakeChecklists()
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SendPoll(ctx, SendPollInput{ChatID: g, SenderID: 7, Question: "Q", Options: []string{"a", "b"}, ClientMsgID: "p1"}); err != nil {
		t.Fatalf("SendPoll вышедшего создателя: %v", err)
	}
	if m, err := fg.GetMember(ctx, g, 7); err != nil || m.Role != domain.RoleCreator {
		t.Fatalf("после опроса: %+v err=%v", m, err)
	}
	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SendChecklist(ctx, SendChecklistInput{ChatID: g, SenderID: 7, Title: "T", Items: []string{"x"}, ClientMsgID: "k1"}); err != nil {
		t.Fatalf("SendChecklist вышедшего создателя: %v", err)
	}
	if m, err := fg.GetMember(ctx, g, 7); err != nil || m.Role != domain.RoleCreator {
		t.Fatalf("после чек-листа: %+v err=%v", m, err)
	}
}

// MC-13: вышедший не-создатель по-прежнему не пишет (гость обсуждения не
// считается: чат не привязан к каналу).
func TestLeftMember_SendStillForbidden(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	if err := in.RemoveMember(ctx, g, 8, 8); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: g, SenderID: 8, Text: "x", ClientMsgID: "c2"}); err == nil {
		t.Fatal("вышедший участник отправил сообщение")
	}
	if _, err := fg.GetMember(ctx, g, 8); err == nil {
		t.Fatal("отправка вернула вышедшего участника в чат")
	}
}

// MC-13: забаненный создатель (бан поставили до выхода — нештатно, но строка
// бана вправе быть) не обходит бан отправкой.
func TestLeftCreator_BannedDoesNotRejoin(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)
	_ = fg.RemoveMember(ctx, g, 7)
	_ = fg.Ban(ctx, g, 7, 7)
	if _, err := in.Send(ctx, SendInput{ChatID: g, SenderID: 7, Text: "x", ClientMsgID: "c3"}); err == nil {
		t.Fatal("забаненный создатель вернулся отправкой")
	}
	if _, err := fg.GetMember(ctx, g, 7); err == nil {
		t.Fatal("бан обойдён")
	}
}

// Ревью: админ с add_admins, которого назначил вышедший создатель, не может
// вернуть создателя в чат своей ролью — ни назначением, ни баном.
func TestLeftCreator_NotPromotedNotBannedByAdmin(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "grp", true, []int64{8})
	_ = fg.SetRole(ctx, g, 8, domain.RoleAdmin, domain.RightManageAdmins|domain.RightBanUsers|domain.RightInviteUsers, 7)
	if err := in.RemoveMember(ctx, g, 7, 7); err != nil {
		t.Fatal(err)
	}
	if err := in.PromoteAdmin(ctx, g, 8, 7, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ назначил вышедшего создателя: %v", err)
	}
	if err := in.BanMember(ctx, g, 8, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ забанил вышедшего создателя: %v", err)
	}
	if _, err := fg.GetMember(ctx, g, 7); err == nil {
		t.Fatal("создатель вернулся чужой ролью")
	}
}

// Ревью: отвергнутая отправка вышедшего создателя состав не меняет.
func TestLeftCreator_RejectedSendDoesNotRejoin(t *testing.T) {
	in, fg, _, _, s := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	_ = in.RemoveMember(ctx, g, 7, 7)
	before := len(s.messages[g])
	long := make([]rune, maxMessageRunes+1)
	for k := range long {
		long[k] = 'я'
	}
	if _, err := in.Send(ctx, SendInput{ChatID: g, SenderID: 7, Text: string(long), ClientMsgID: "l1"}); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("слишком длинное: %v", err)
	}
	if _, err := fg.GetMember(ctx, g, 7); err == nil {
		t.Fatal("отвергнутая отправка вернула создателя в чат")
	}
	if len(s.messages[g]) != before {
		t.Fatalf("отвергнутая отправка добавила служебку: %d -> %d", before, len(s.messages[g]))
	}
}

// Ревью: публикация отложенного по расписанию создателя в чат не возвращает.
func TestLeftCreator_ScheduledPublishDoesNotRejoin(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	_ = in.RemoveMember(ctx, g, 7, 7)
	if _, err := in.Send(ctx, SendInput{ChatID: g, SenderID: 7, Text: "по расписанию", ClientMsgID: "s1", fromSchedule: true}); err == nil {
		t.Fatal("отложенное вышедшего создателя опубликовано")
	}
	if _, err := fg.GetMember(ctx, g, 7); err == nil {
		t.Fatal("публикация по расписанию вернула создателя")
	}
}

// Ревью п. 4: интерфейс показывает вышедшему создателю «Изменить» и «Удалить» —
// сервер признаёт их (tweb hasRights.ts:25-27).
func TestLeftCreator_EditAndDelete(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	_ = in.RemoveMember(ctx, g, 7, 7)
	if err := in.EditAbout(ctx, g, 7, "описание"); err != nil {
		t.Fatalf("EditAbout вышедшим создателем: %v", err)
	}
	if c, _ := fg.Card(ctx, g, 8); c.About != "описание" {
		t.Fatalf("описание не записалось: %q", c.About)
	}
	if err := in.EditTitle(ctx, g, 7, "Новое"); err != nil {
		t.Fatalf("EditTitle вышедшим создателем: %v", err)
	}
	if err := in.DeleteGroup(ctx, g, 7); err != nil {
		t.Fatalf("DeleteGroup вышедшим создателем: %v", err)
	}
}

// Ревью п. 5: служебка «добавил(а)» от имени вышедшего создателя не теряется.
func TestLeftCreator_PromoteNonMemberPostsService(t *testing.T) {
	in, _, _, _, s := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)
	_ = in.RemoveMember(ctx, g, 7, 7)
	if err := in.PromoteAdmin(ctx, g, 7, 10, domain.RightPinMessages, nil); err != nil {
		t.Fatal(err)
	}
	msgs := s.messages[g]
	add, ok := msgs[len(msgs)-1].Action.(domain.MessageActionChatAddUser)
	if !ok || len(add.Users) != 1 || add.Users[0] != 10 {
		t.Fatalf("служебка «добавил(а)» потеряна: %#v", msgs[len(msgs)-1].Action)
	}
}

// Ревью п. 7: ввод не-участника назначением требует права звать, как AddMember.
func TestPromoteAdmin_NonMemberNeedsInviteRight(t *testing.T) {
	in, fg, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8, 9})
	_ = fg.SetRole(ctx, g, 8, domain.RoleAdmin, domain.RightManageAdmins|domain.RightPinMessages, 7)
	if err := in.PromoteAdmin(ctx, g, 8, 10, domain.RightPinMessages, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ без invite_users ввёл не-участника: %v", err)
	}
	if _, err := fg.GetMember(ctx, g, 10); err == nil {
		t.Fatal("не-участник вошёл")
	}
	// Тот же админ правит права УЖЕ участника — invite_users не нужен.
	if err := in.PromoteAdmin(ctx, g, 8, 9, domain.RightPinMessages, nil); err != nil {
		t.Fatalf("правка прав: %v", err)
	}
}

// Ревью п. 8: второй вход параллельного пути не считается вступлением.
func TestAdmit_SecondEntryIsNotJoin(t *testing.T) {
	in, _, _, _, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)
	if joined, err := in.admit(ctx, g, 8, 8, admitSelf); err != nil || !joined {
		t.Fatalf("первый вход: joined=%v err=%v", joined, err)
	}
	if joined, err := in.admit(ctx, g, 8, 8, admitSelf); err != nil || joined {
		t.Fatalf("второй вход: joined=%v err=%v; ждали joined=false", joined, err)
	}
}

// Ревью п. 12: то же значение — ни служебки, ни снимка чата.
func TestEditAboutTitle_UnchangedIsSilent(t *testing.T) {
	in, _, _, pub, _ := newMembersTestInteractor(t)
	ctx := context.Background()
	g, _, _ := in.CreateGroup(ctx, 7, "Группа", "о", "", false, []int64{8})
	pub.reset()
	if err := in.EditAbout(ctx, g, 7, "о"); err != nil {
		t.Fatal(err)
	}
	if err := in.EditTitle(ctx, g, 7, "Группа"); err != nil {
		t.Fatal(err)
	}
	if n := pub.countFor(8); n != 0 {
		t.Fatalf("неизменённые значения разослали %d кадров", n)
	}
}
