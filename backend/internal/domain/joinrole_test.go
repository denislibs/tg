package domain

import (
	"encoding/json"
	"testing"
)

// A5-07 / A5-26: роль вступающего — по типу чата.
func TestJoinRole_ByChatType(t *testing.T) {
	if r := JoinRole(ChatTypeChannel); r != RoleSubscriber {
		t.Fatalf("канал → %q, ждали subscriber", r)
	}
	if r := JoinRole(ChatTypeGroup); r != RoleMember {
		t.Fatalf("группа → %q, ждали member", r)
	}
}

// VVA5a-01: у broadcast-канала нет default_banned_rights — иначе клиент
// (tweb hasRights) разрешает подписчику закреп; у группы они есть.
func TestToChannel_BroadcastWithoutDefaultBannedRights(t *testing.T) {
	ch := ChatRecord{ID: 1, Type: ChatTypeChannel, ViewerID: 5, MyRole: RoleSubscriber,
		Settings: ChatSettings{DefaultPerms: AllMemberPerms}}
	if got := ch.ToChannel(); got.DefaultBanned != nil {
		t.Fatalf("канал отдаёт default_banned_rights: %+v", got.DefaultBanned)
	}
	if got := (DialogRecord{ChatID: 1, Type: ChatTypeChannel}).ToChannel(); got.DefaultBanned != nil {
		t.Fatalf("строка списка канала отдаёт default_banned_rights: %+v", got.DefaultBanned)
	}
	g := ChatRecord{ID: 2, Type: ChatTypeGroup, ViewerID: 5, MyRole: RoleMember,
		Settings: ChatSettings{DefaultPerms: AllMemberPerms}}
	if got := g.ToChannel(); got.DefaultBanned == nil {
		t.Fatal("у группы пропали default_banned_rights")
	}
}

// A5-36: админ без единого права — всё равно админ (chatAdminRights есть).
func TestSetViewerMembership_AdminWithoutRights(t *testing.T) {
	var c Channel
	c.SetViewerMembership(RoleAdmin, 0)
	if c.AdminRights == nil {
		t.Fatal("админ с пустой маской остался без admin_rights")
	}
	c.SetViewerMembership(RoleMember, 0)
	if c.AdminRights != nil {
		t.Fatal("у участника появились admin_rights")
	}
}

// A5-30 / A5-37: биты anonymous и manage_topics едут флагами схемы туда и
// обратно.
func TestChatAdminRights_AnonymousManageTopics(t *testing.T) {
	ar := NewChatAdminRights(RightAnonymous | RightManageTopics)
	if !ar.Can("anonymous") || !ar.Can("manage_topics") {
		t.Fatalf("флаги не выставлены: %+v", ar.PFlags)
	}
	b, _ := json.Marshal(ar)
	var back ChatAdminRights
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.Rights() != RightAnonymous|RightManageTopics {
		t.Fatalf("обратно = %d", back.Rights())
	}
}
