package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Регрессии пачки Ф-1б «Роли, админы, вступление» (аудит 2026-10-05).

// setMember кладёт строку участника как есть — как её оставил бы прежний код
// или назначение админа.
func setMember(fg *fakeGroupRepo, chatID, userID int64, role string, rights domain.Rights, promotedBy int64) {
	fg.mu.Lock()
	defer fg.mu.Unlock()
	if fg.members[chatID] == nil {
		fg.members[chatID] = map[int64]domain.Member{}
	}
	fg.members[chatID][userID] = domain.Member{ChatID: chatID, UserID: userID, Role: role, Rights: rights, PromotedBy: promotedBy}
}

func roleOf(t *testing.T, fg *fakeGroupRepo, chatID, userID int64) string {
	t.Helper()
	m, err := fg.GetMember(context.Background(), chatID, userID)
	if err != nil {
		return ""
	}
	return m.Role
}

func newChannelChat(t *testing.T, fg *fakeGroupRepo, creator int64) int64 {
	t.Helper()
	ctx := context.Background()
	id, err := fg.CreateMultiMember(ctx, domain.ChatTypeChannel, "Канал", "", "", false, creator)
	if err != nil {
		t.Fatal(err)
	}
	setMember(fg, id, creator, domain.RoleCreator, domain.AllRights, 0)
	return id
}

// ── A5-07, A5-26, A6-05: роль по типу чата ─────────────────────────────────

func TestJoin_ChannelGivesSubscriberWithoutGroupRights(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	ch := newChannelChat(t, fg, 7)
	link, err := i.CreateInvite(ctx, ch, 7, "", nil, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := i.JoinByToken(ctx, link.Token, 8); err != nil {
		t.Fatal(err)
	}
	if r := roleOf(t, fg, ch, 8); r != domain.RoleSubscriber {
		t.Fatalf("вступивший в канал по ссылке: роль %q, ждали subscriber", r)
	}
	if err := i.EditInfo(ctx, ch, 8, "захват", "", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик переименовал канал: %v", err)
	}
	// Добавление админом и снятие админа — тоже подписчик.
	if err := i.AddMember(ctx, ch, 7, 9); err != nil {
		t.Fatal(err)
	}
	if r := roleOf(t, fg, ch, 9); r != domain.RoleSubscriber {
		t.Fatalf("добавленный в канал: роль %q", r)
	}
	if err := i.PromoteAdmin(ctx, ch, 7, 9, domain.RightPostMessages); err != nil {
		t.Fatal(err)
	}
	if err := i.DemoteAdmin(ctx, ch, 7, 9); err != nil {
		t.Fatal(err)
	}
	if r := roleOf(t, fg, ch, 9); r != domain.RoleSubscriber {
		t.Fatalf("снятый админ канала: роль %q, ждали subscriber", r)
	}
	// Строка 'member' в канале (до миграции 0137) прав группы не даёт.
	setMember(fg, ch, 10, domain.RoleMember, 0, 0)
	if err := i.EditInfo(ctx, ch, 10, "захват", "", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member в канале переименовал его: %v", err)
	}
}

func TestJoinPublic_GroupGivesMemberWhoCanPin(t *testing.T) {
	i, fg, fs, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	gid, _, err := i.CreateGroup(ctx, 7, "Публичная", "", "pubg", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	fs.usernames["pubg"] = gid
	if err := i.JoinPublic(ctx, "pubg", 8); err != nil {
		t.Fatal(err)
	}
	if r := roleOf(t, fg, gid, 8); r != domain.RoleMember {
		t.Fatalf("вступивший в группу по @имени: роль %q, ждали member", r)
	}
	msg, err := i.Send(ctx, SendInput{ChatID: gid, SenderID: 7, Text: "пост"})
	if err != nil {
		t.Fatal(err)
	}
	if err := i.SetPin(ctx, gid, msg.ID, 8, true); err != nil {
		t.Fatalf("участник группы с дефолтным правом не закрепил: %v", err)
	}
}

// ── A5-08, A5-09, A5-36: управляемость цели ────────────────────────────────

func newGroupWith(t *testing.T, i *Interactor, fg *fakeGroupRepo, members ...int64) int64 {
	t.Helper()
	gid, _, err := i.CreateGroup(context.Background(), 7, "Группа", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, uid := range members {
		setMember(fg, gid, uid, domain.RoleMember, 0, 0)
	}
	return gid
}

func TestPromoteDemote_TargetGate(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 8, 9, 10)
	if err := i.PromoteAdmin(ctx, g, 7, 8, domain.RightManageAdmins); err != nil {
		t.Fatal(err)
	}
	if m, _ := fg.GetMember(ctx, g, 8); m.PromotedBy != 7 {
		t.Fatalf("promoted_by = %d, ждали 7", m.PromotedBy)
	}
	if err := i.PromoteAdmin(ctx, g, 8, 8, domain.AllRights); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ выдал права себе: %v", err)
	}
	if err := i.PromoteAdmin(ctx, g, 8, 9, domain.AllRights); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ выдал права, которых у него нет: %v", err)
	}
	if err := i.DemoteAdmin(ctx, g, 8, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ снял владельца: %v", err)
	}
	if r := roleOf(t, fg, g, 7); r != domain.RoleCreator {
		t.Fatalf("владелец стал %q", r)
	}
	if err := i.PromoteAdmin(ctx, g, 8, 9, domain.RightManageAdmins); err != nil {
		t.Fatalf("подмножество своих прав: %v", err)
	}
	if err := i.PromoteAdmin(ctx, g, 7, 10, domain.RightBanUsers); err != nil {
		t.Fatal(err)
	}
	if err := i.DemoteAdmin(ctx, g, 8, 10); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ снял чужого админа: %v", err)
	}
	if err := i.PromoteAdmin(ctx, g, 8, 10, domain.RightManageAdmins); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ переписал права чужого админа: %v", err)
	}
	if err := i.DemoteAdmin(ctx, g, 8, 9); err != nil {
		t.Fatalf("назначивший не снял своего админа: %v", err)
	}
	if err := i.DemoteAdmin(ctx, g, 7, 10); err != nil {
		t.Fatalf("владелец не снял админа: %v", err)
	}
	// Не участник — ErrNotFound, а не «невидимый админ».
	if err := i.PromoteAdmin(ctx, g, 7, 99, domain.RightBanUsers); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повышение не-участника = %v, ждали ErrNotFound", err)
	}
	if _, err := fg.GetMember(ctx, g, 99); err == nil {
		t.Fatal("не-участник появился в чате")
	}
}

func TestKickBanRestrict_TargetGate(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 10)
	setMember(fg, g, 8, domain.RoleAdmin, domain.RightBanUsers, 7)
	setMember(fg, g, 9, domain.RoleAdmin, domain.RightPinMessages, 7)
	for name, err := range map[string]error{
		"кик владельца":        i.RemoveMember(ctx, g, 8, 7),
		"кик чужого админа":    i.RemoveMember(ctx, g, 8, 9),
		"бан владельца":        i.BanMember(ctx, g, 8, 7),
		"бан чужого админа":    i.BanMember(ctx, g, 8, 9),
		"ограничить владельца": i.RestrictMember(ctx, g, 8, 7, domain.PermSendMessages, 0),
	} {
		if !errors.Is(err, domain.ErrForbidden) {
			t.Errorf("%s = %v, ждали ErrForbidden", name, err)
		}
	}
	if roleOf(t, fg, g, 7) == "" || roleOf(t, fg, g, 9) == "" {
		t.Fatal("владелец или чужой админ выгнан")
	}
	if err := i.RestrictMember(ctx, g, 8, 99, domain.PermSendMessages, 0); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ограничение не-участника = %v, ждали ErrNotFound", err)
	}
	if err := i.RemoveMember(ctx, g, 8, 10); err != nil {
		t.Fatalf("кик участника: %v", err)
	}
	if err := i.BanMember(ctx, g, 8, 11); err != nil {
		t.Fatalf("бан не-участника: %v", err)
	}
	if err := i.RemoveMember(ctx, g, 7, 9); err != nil {
		t.Fatalf("владелец не выгнал админа: %v", err)
	}
}

// ── A5-10, A6-02, VA2-04: одна точка вступления ────────────────────────────

func TestJoin_BanHoldsOnEveryPath(t *testing.T) {
	i, fg, fs, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "Новости", "", "", true)
	gid, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	post, err := i.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	root, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	_ = fg.Ban(ctx, gid, 8, 7)

	// (а) комментарий и ответ в тред не возвращают забаненного. Отказ даёт
	// гейт чтения обсуждения (RequireChannelCommentsRead): забаненному в группе
	// обсуждения комментарии канала не видны — ErrNotFound, как CHANNEL_PRIVATE.
	if _, err := i.PostComment(ctx, ch, post.ID, 8, "я вернулся", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("комментарий забаненного = %v, ждали ErrNotFound", err)
	}
	if _, err := i.Send(ctx, SendInput{ChatID: gid, SenderID: 8, Text: "я вернулся", ThreadRootID: &root}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ответ в тред забаненного = %v, ждали ErrNotFound", err)
	}
	if roleOf(t, fg, gid, 8) != "" {
		t.Fatal("забаненный вступил в группу обсуждения")
	}

	// (б) @имя.
	pub, _, _ := i.CreateGroup(ctx, 7, "Публичная", "", "pub", true, nil)
	fs.usernames["pub"] = pub
	_ = fg.Ban(ctx, pub, 8, 7)
	if err := i.JoinPublic(ctx, "pub", 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("вход по @имени забаненного = %v", err)
	}
	// (г) ссылка на папку.
	if err := i.JoinFolderChat(ctx, pub, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("вход по ссылке на папку забаненного = %v", err)
	}
	if roleOf(t, fg, pub, 8) != "" {
		t.Fatal("забаненный вступил в публичную группу")
	}
}

func TestApproveJoinRequest_OnlyExistingRequestAndBan(t *testing.T) {
	i, fg, fjr := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg)
	setMember(fg, g, 8, domain.RoleAdmin, domain.RightInviteUsers, 7)
	// (в) заявки нет — одобрять нечего.
	if err := i.ApproveJoinRequest(ctx, g, 8, 20); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("одобрение несуществующей заявки = %v, ждали ErrNotFound", err)
	}
	if roleOf(t, fg, g, 20) != "" {
		t.Fatal("одобрение без заявки добавило пользователя")
	}
	// Заявка есть, но пользователь забанен: вернуть может только админ с ban_users.
	_ = fjr.Create(ctx, g, 21, "")
	_ = fg.Ban(ctx, g, 21, 7)
	if err := i.ApproveJoinRequest(ctx, g, 8, 21); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("одобрение забаненного без ban_users = %v", err)
	}
	if err := i.ApproveJoinRequest(ctx, g, 7, 21); err != nil {
		t.Fatalf("владелец не одобрил: %v", err)
	}
	if banned, _ := fg.IsBanned(ctx, g, 21); banned || roleOf(t, fg, g, 21) != domain.RoleMember {
		t.Fatalf("после одобрения владельцем: бан=%v роль=%q", banned, roleOf(t, fg, g, 21))
	}
}

func TestJoinByLink_UsageLimit(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg)
	one := 1
	link, err := i.CreateInvite(ctx, g, 7, "", &one, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := i.JoinByToken(ctx, link.Token, 8); err != nil {
		t.Fatal(err)
	}
	if _, _, err := i.JoinByToken(ctx, link.Token, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("второй вход по ссылке с лимитом 1 = %v, ждали ErrForbidden", err)
	}
	if roleOf(t, fg, g, 9) != "" {
		t.Fatal("вход сверх лимита добавил участника")
	}
}

// ── A5-15: личные ограничения в memberCan ──────────────────────────────────

func TestMemberCan_PersonalRestriction(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 8)
	denied := domain.PermPinMessages | domain.PermChangeInfo | domain.PermAddMembers
	_ = fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: g, UserID: 8, DeniedRights: denied, RestrictedBy: 7})
	if err := i.EditInfo(ctx, g, 8, "новое", "", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("ограниченный сменил инфо: %v", err)
	}
	if err := i.AddMember(ctx, g, 8, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("ограниченный пригласил: %v", err)
	}
	if ok, _ := i.memberCan(ctx, g, 8, domain.PermPinMessages, domain.RightPinMessages); ok {
		t.Fatal("ограниченный может закреплять")
	}
	past := time.Now().Add(-time.Minute)
	_ = fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: g, UserID: 8, DeniedRights: denied, UntilDate: &past, RestrictedBy: 7})
	if err := i.EditInfo(ctx, g, 8, "новое", "", ""); err != nil {
		t.Fatalf("истёкшее ограничение всё ещё действует: %v", err)
	}
}

// ── матрица прав = tweb hasRights ──────────────────────────────────────────

// A5-21: тема группы — право change_info.
func TestSetChatTheme_GroupNeedsChangeInfo(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 8)
	_ = fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: g, UserID: 8, DeniedRights: domain.AllMemberPerms, RestrictedBy: 7})
	if err := i.SetChatTheme(ctx, g, 8, "🐥"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("ограниченный сменил тему группы: %v", err)
	}
	if err := i.SetChatTheme(ctx, g, 7, "🐥"); err != nil {
		t.Fatalf("владелец не сменил тему: %v", err)
	}
}

// A5-27: в канале закрепляет админ с post_messages; подписчик — нет.
func TestSetPin_ChannelAdminByPostMessages(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "Новости", "", "", false)
	setMember(fg, ch, 8, domain.RoleAdmin, domain.RightPostMessages, 7)
	setMember(fg, ch, 9, domain.RoleSubscriber, 0, 0)
	post, err := i.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := i.SetPin(ctx, ch, post.ID, 8, true); err != nil {
		t.Fatalf("админ канала с post_messages не закрепил: %v", err)
	}
	if err := i.SetPin(ctx, ch, post.ID, 9, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик закрепил: %v", err)
	}
}

// A5-29: тип чата и форум — только владелец.
func TestTypeAndForum_CreatorOnly(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	i.SetTopics(newFakeTopicRepo())
	ctx := context.Background()
	g := newGroupWith(t, i, fg)
	setMember(fg, g, 8, domain.RoleAdmin, domain.RightChangeInfo, 7)
	if err := i.SetChatType(ctx, g, 8, true, "zahvat"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ сменил тип чата: %v", err)
	}
	if _, err := i.CheckChatUsername(ctx, g, 8, "zahvat"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ проверил имя для смены типа: %v", err)
	}
	if err := i.SetForum(ctx, g, 8, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("админ включил форум: %v", err)
	}
	if err := i.SetChatType(ctx, g, 7, true, "svoyo"); err != nil {
		t.Fatalf("владелец не сменил тип: %v", err)
	}
	if err := i.SetForum(ctx, g, 7, true); err != nil {
		t.Fatalf("владелец не включил форум: %v", err)
	}
}

// A5-30, VA5b-02, A5-25: одно canManageTopic.
func TestTopics_CanManageTopic(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ft := newFakeTopicRepo()
	i.SetTopics(ft)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 9, 11)
	setMember(fg, g, 8, domain.RoleAdmin, domain.RightChangeInfo|domain.RightPinMessages, 7)
	setMember(fg, g, 10, domain.RoleAdmin, domain.RightManageTopics, 7)
	topic, _ := ft.Create(ctx, domain.ForumTopicRecord{ChatID: g, RootMsgID: 500, Title: "Тема", CreatedBy: 9})

	for name, err := range map[string]error{
		"закрыть":    i.CloseTopic(ctx, topic.ID, 8, true),
		"править":    i.EditTopic(ctx, topic.ID, 8, "x", "", 0),
		"скрыть":     i.SetTopicHidden(ctx, topic.ID, 8, true),
		"закрепить":  i.SetTopicPinned(ctx, topic.ID, 8, true),
		"чужой член": i.CloseTopic(ctx, topic.ID, 11, true),
	} {
		if !errors.Is(err, domain.ErrForbidden) {
			t.Errorf("%s темы без manage_topics = %v, ждали ErrForbidden", name, err)
		}
	}
	if err := i.SetTopicPinned(ctx, topic.ID, 10, true); err != nil {
		t.Fatalf("админ с manage_topics не закрепил тему: %v", err)
	}
	if err := i.CloseTopic(ctx, topic.ID, 9, true); err != nil {
		t.Fatalf("автор не закрыл свою тему: %v", err)
	}

	// A5-25: в закрытую тему пишет только тот, кто ей управляет.
	root := topic.RootMsgID
	if _, err := i.Send(ctx, SendInput{ChatID: g, SenderID: 11, Text: "в закрытую", ThreadRootID: &root}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("участник написал в закрытую тему: %v", err)
	}
	if err := i.checkTopicOpen(ctx, SendInput{ChatID: g, SenderID: 10, ThreadRootID: &root}); err != nil {
		t.Fatalf("управляющий темами не пишет в закрытую тему: %v", err)
	}

	// VA5b-02: вышедший автор свою тему больше не правит.
	if err := i.RemoveMember(ctx, g, 9, 9); err != nil {
		t.Fatal(err)
	}
	if err := i.CloseTopic(ctx, topic.ID, 9, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("вышедший автор правит тему: %v", err)
	}
}

// A5-37: писать от имени группы — право anonymous.
func TestGetSendAs_GroupNeedsAnonymous(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg)
	setMember(fg, g, 8, domain.RoleAdmin, domain.RightBanUsers, 7)
	setMember(fg, g, 9, domain.RoleAdmin, domain.RightAnonymous, 7)
	asGroup := func(uid int64) bool {
		ok, err := i.canSendAs(ctx, uid, g, g)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}
	if asGroup(8) {
		t.Fatal("админ без anonymous пишет от имени группы")
	}
	if !asGroup(9) || !asGroup(7) {
		t.Fatal("админ с anonymous или владелец не пишет от имени группы")
	}
}

// A5-38: опрос, гео, контакт и чек-лист — медиа для запрета send_media.
func TestCheckSendAllowed_NonTextIsMedia(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 8, 9)
	_ = fg.SetPermissions(ctx, g, domain.AllMemberPerms&^domain.PermSendMedia, 0)
	id, lat := int64(1), 1.0
	for name, in := range map[string]SendInput{
		"опрос":    {PollID: &id},
		"чек-лист": {ChecklistID: &id},
		"гео":      {GeoLat: &lat, GeoLng: &lat},
		"контакт":  {ContactUserID: &id},
	} {
		in.ChatID, in.SenderID = g, 8
		if err := i.checkSendAllowed(ctx, in); !errors.Is(err, domain.ErrForbidden) {
			t.Errorf("%s при запрете медиа = %v, ждали ErrForbidden", name, err)
		}
	}
	if err := i.checkSendAllowed(ctx, SendInput{ChatID: g, SenderID: 8, Text: "текст"}); err != nil {
		t.Fatalf("текст при запрете медиа: %v", err)
	}
	// Личный запрет медиа — так же.
	_ = fg.SetPermissions(ctx, g, domain.AllMemberPerms, 0)
	_ = fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: g, UserID: 9, DeniedRights: domain.PermSendMedia, RestrictedBy: 7})
	if err := i.checkSendAllowed(ctx, SendInput{ChatID: g, SenderID: 9, PollID: &id}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("опрос при личном запрете медиа = %v", err)
	}
}

// Группа обсуждения: при привязке история открывается, скрыть её нельзя —
// как и у канала (Telegram CHAT_LINK_EXISTS, tweb setDiscussionGroup).
func TestDiscussion_HistoryAlwaysVisible(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "Новости", "", "", false)
	g, _, err := i.CreateGroup(ctx, 7, "Обсуждение", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	other, _, _ := i.CreateGroup(ctx, 7, "Другая", "", "", false, nil)
	_ = fg.SetHistoryForNew(ctx, g, false)
	if _, err := i.LinkDiscussion(ctx, ch, g, 7); err != nil {
		t.Fatal(err)
	}
	if s, _ := fg.Settings(ctx, g); !s.HistoryForNew {
		t.Fatal("при привязке история группы обсуждения осталась скрытой")
	}
	if err := i.SetChatHistoryForNew(ctx, g, 7, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("скрыть историю группы обсуждения = %v, ждали ErrForbidden", err)
	}
	if err := i.SetChatHistoryForNew(ctx, ch, 7, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("скрыть историю канала = %v, ждали ErrForbidden", err)
	}
	if err := i.SetChatHistoryForNew(ctx, other, 7, false); err != nil {
		t.Fatalf("обычная группа: %v", err)
	}
}

// restrictionErrGroups — GroupRepo, у которого чтение личных ограничений падает.
type restrictionErrGroups struct{ *fakeGroupRepo }

func (restrictionErrGroups) GetRestriction(context.Context, int64, int64) (domain.MemberRestriction, bool, error) {
	return domain.MemberRestriction{}, false, errors.New("db down")
}

// Сбой чтения ограничения — отказ, а не пропуск.
func TestRestricted_ReadErrorDenies(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	g := newGroupWith(t, i, fg, 8)
	i.groups = restrictionErrGroups{fg}
	if err := i.EditInfo(ctx, g, 8, "новое", "", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка инфо при сбое чтения ограничения = %v, ждали ErrForbidden", err)
	}
	if err := i.checkSendAllowed(ctx, SendInput{ChatID: g, SenderID: 8, Text: "т"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("отправка при сбое чтения ограничения = %v, ждали ErrForbidden", err)
	}
}

// ── fake TopicRepo ─────────────────────────────────────────────────────────

type fakeTopicRepo struct {
	mu     sync.Mutex
	nextID int64
	topics map[int64]domain.ForumTopicRecord
}

func newFakeTopicRepo() *fakeTopicRepo {
	return &fakeTopicRepo{topics: map[int64]domain.ForumTopicRecord{}}
}

func (r *fakeTopicRepo) Create(_ context.Context, t domain.ForumTopicRecord) (domain.ForumTopicRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	t.ID = r.nextID
	r.topics[t.ID] = t
	return t, nil
}

func (r *fakeTopicRepo) ByID(_ context.Context, id int64) (domain.ForumTopicRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.topics[id]
	if !ok {
		return domain.ForumTopicRecord{}, domain.ErrNotFound
	}
	return t, nil
}

func (r *fakeTopicRepo) ByRoot(_ context.Context, chatID, rootMsgID int64) (domain.ForumTopicRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.topics {
		if t.ChatID == chatID && t.RootMsgID == rootMsgID {
			return t, nil
		}
	}
	return domain.ForumTopicRecord{}, domain.ErrNotFound
}

func (r *fakeTopicRepo) update(id int64, fn func(*domain.ForumTopicRecord)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.topics[id]
	if !ok {
		return domain.ErrNotFound
	}
	fn(&t)
	r.topics[id] = t
	return nil
}

func (r *fakeTopicRepo) SetClosed(_ context.Context, id int64, closed bool) error {
	return r.update(id, func(t *domain.ForumTopicRecord) { t.Closed = closed })
}

func (r *fakeTopicRepo) EditTopic(_ context.Context, id int64, title, iconEmoji string, iconColor int) error {
	return r.update(id, func(t *domain.ForumTopicRecord) { t.Title, t.IconEmoji, t.IconColor = title, iconEmoji, iconColor })
}

func (r *fakeTopicRepo) SetHidden(_ context.Context, id int64, hidden bool) error {
	return r.update(id, func(t *domain.ForumTopicRecord) { t.Hidden = hidden })
}

func (r *fakeTopicRepo) SetPinned(_ context.Context, id int64, pinned bool) error {
	return r.update(id, func(t *domain.ForumTopicRecord) { t.Pinned = pinned })
}

func (r *fakeTopicRepo) EnsureGeneralTopic(ctx context.Context, chatID, createdBy int64) (domain.ForumTopicRecord, error) {
	return r.Create(ctx, domain.ForumTopicRecord{ChatID: chatID, Title: "General", IsGeneral: true, CreatedBy: createdBy})
}

func (r *fakeTopicRepo) ListByChat(context.Context, int64, int64) ([]domain.TopicRow, error) {
	return nil, nil
}

func (r *fakeTopicRepo) SetTopicRead(context.Context, int64, int64, int64, int64) error { return nil }

func (r *fakeTopicRepo) SetTopicMuted(context.Context, int64, int64, int64, bool) error { return nil }
