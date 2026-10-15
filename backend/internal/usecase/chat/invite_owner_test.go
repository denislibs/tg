package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// inviteOwnerFixture — группа с создателем 7 и админом 8 (право invite_users),
// у каждого по одной ссылке. Участник 9 — без прав.
func inviteOwnerFixture(t *testing.T) (i *Interactor, chatID int64, creatorLink, adminLink domain.InviteLink) {
	t.Helper()
	in, fg, _ := newGroupTestInteractor(t)
	ctx := context.Background()
	id, _, err := in.CreateGroup(ctx, 7, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	_ = fg.AddMember(ctx, id, 8, domain.RoleAdmin, domain.RightInviteUsers)
	_ = fg.AddMember(ctx, id, 9, domain.RoleMember, 0)
	c, err := in.CreateInvite(ctx, id, 7, "c1", nil, false, nil)
	if err != nil {
		t.Fatalf("CreateInvite creator: %v", err)
	}
	a, err := in.CreateInvite(ctx, id, 8, "a1", nil, false, nil)
	if err != nil {
		t.Fatalf("CreateInvite admin: %v", err)
	}
	return in, id, c, a
}

func TestListInvites_AdminSeesOnlyOwn(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()

	got, err := i.ListInvites(ctx, id, 8, 0, false)
	if err != nil {
		t.Fatalf("ListInvites(admin): %v", err)
	}
	if !hasToken(got, a1.Token) || hasToken(got, c1.Token) {
		t.Fatalf("admin list = %+v; want only own link %s", got, a1.Token)
	}
	// admin_id == актор — то же, что без admin_id (клиент tweb шлёт inputUserSelf).
	got, err = i.ListInvites(ctx, id, 8, 8, false)
	if err != nil || !hasToken(got, a1.Token) || hasToken(got, c1.Token) {
		t.Fatalf("ListInvites(admin, admin_id=self) = %+v, %v", got, err)
	}
	// Создатель без admin_id тоже видит только свои.
	got, err = i.ListInvites(ctx, id, 7, 0, false)
	if err != nil || !hasToken(got, c1.Token) || hasToken(got, a1.Token) {
		t.Fatalf("creator own list = %+v, %v", got, err)
	}
}

func TestListInvites_OtherAdmin_RequiresCreator(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()

	if _, err := i.ListInvites(ctx, id, 8, 7, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin lists creator's links: want ErrForbidden, got %v", err)
	}
	got, err := i.ListInvites(ctx, id, 7, 8, false)
	if err != nil || !hasToken(got, a1.Token) || hasToken(got, c1.Token) {
		t.Fatalf("creator lists admin's links = %+v, %v", got, err)
	}
	// Участник без права не видит и свои.
	if _, err := i.ListInvites(ctx, id, 9, 0, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member list: want ErrForbidden, got %v", err)
	}
}

func TestEditInvite_ForeignLink_ForbiddenForAdmin(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()
	title := "x"
	revoked := true

	if _, err := i.EditInvite(ctx, id, 8, c1.Token, domain.InviteEdit{Title: &title}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin edits creator's link: want ErrForbidden, got %v", err)
	}
	if _, err := i.EditInvite(ctx, id, 8, c1.Token, domain.InviteEdit{Revoked: &revoked}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin revokes creator's link: want ErrForbidden, got %v", err)
	}
	// Своя — можно; чужая у создателя — можно.
	if _, err := i.EditInvite(ctx, id, 8, a1.Token, domain.InviteEdit{Title: &title}); err != nil {
		t.Fatalf("admin edits own link: %v", err)
	}
	if upd, err := i.EditInvite(ctx, id, 7, a1.Token, domain.InviteEdit{Revoked: &revoked}); err != nil || !upd.Revoked {
		t.Fatalf("creator revokes admin's link: %+v, %v", upd, err)
	}
	// Отозванную чужую ссылку админ тоже не правит (GetByToken отозванные скрывает —
	// проверка владельца не должна на этом пропускаться).
	if _, err := i.EditInvite(ctx, id, 7, c1.Token, domain.InviteEdit{Revoked: &revoked}); err != nil {
		t.Fatalf("creator revokes own: %v", err)
	}
	if _, err := i.EditInvite(ctx, id, 8, c1.Token, domain.InviteEdit{Title: &title}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin edits foreign revoked link: want ErrForbidden, got %v", err)
	}
	// Ссылки с таким токеном в чате нет — прежнее поведение репозитория, не отказ по владельцу.
	if _, err := i.EditInvite(ctx, id, 8, "no-such-token", domain.InviteEdit{Title: &title}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("edit of missing link: want ErrNotFound, got %v", err)
	}
	if err := i.DeleteInvite(ctx, id, 8, "no-such-token"); err != nil {
		t.Fatalf("delete of missing link must stay a no-op: %v", err)
	}
	if _, err := i.EditInvite(ctx, id, 8, c1.Token, domain.InviteEdit{Revoked: new(bool)}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin un-revokes creator's revoked link: want ErrForbidden, got %v", err)
	}
}

func TestInviteImporters_ForeignLink_ForbiddenForAdmin(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()

	if _, _, err := i.InviteImporters(ctx, id, 8, c1.Token); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin importers of creator's link: want ErrForbidden, got %v", err)
	}
	if _, _, err := i.InviteImporters(ctx, id, 8, a1.Token); err != nil {
		t.Fatalf("admin importers of own link: %v", err)
	}
	if _, _, err := i.InviteImporters(ctx, id, 7, a1.Token); err != nil {
		t.Fatalf("creator importers of admin's link: %v", err)
	}
}

func TestDeleteInvite_ForeignLink_ForbiddenForAdmin(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()
	revoked := true
	_, _ = i.EditInvite(ctx, id, 7, c1.Token, domain.InviteEdit{Revoked: &revoked}) // отозванная — тоже чужая

	if err := i.DeleteInvite(ctx, id, 8, c1.Token); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin deletes creator's link: want ErrForbidden, got %v", err)
	}
	if rev, _ := i.ListInvites(ctx, id, 7, 0, true); !hasToken(rev, c1.Token) {
		t.Fatal("creator's revoked link was deleted by foreign admin")
	}
	if err := i.DeleteInvite(ctx, id, 8, a1.Token); err != nil {
		t.Fatalf("admin deletes own: %v", err)
	}
	if err := i.DeleteInvite(ctx, id, 7, c1.Token); err != nil {
		t.Fatalf("creator deletes own: %v", err)
	}
	a2, _ := i.CreateInvite(ctx, id, 8, "a2", nil, false, nil)
	if act, _ := i.ListInvites(ctx, id, 7, 8, false); !hasToken(act, a2.Token) {
		t.Fatal("fixture: admin's second link missing")
	}
	if err := i.DeleteInvite(ctx, id, 7, a2.Token); err != nil {
		t.Fatalf("creator deletes admin's: %v", err)
	}
	if act, _ := i.ListInvites(ctx, id, 7, 8, false); hasToken(act, a2.Token) {
		t.Fatal("admin's link not deleted by creator")
	}
}

func TestDeleteAllRevoked_OnlyOwn(t *testing.T) {
	i, id, c1, a1 := inviteOwnerFixture(t)
	ctx := context.Background()
	revoked := true
	_, _ = i.EditInvite(ctx, id, 7, c1.Token, domain.InviteEdit{Revoked: &revoked})
	_, _ = i.EditInvite(ctx, id, 8, a1.Token, domain.InviteEdit{Revoked: &revoked})

	// Админ без admin_id чистит только свои отозванные.
	if err := i.DeleteAllRevoked(ctx, id, 8, 0); err != nil {
		t.Fatalf("DeleteAllRevoked(admin): %v", err)
	}
	if rev, _ := i.ListInvites(ctx, id, 8, 0, true); len(rev) != 0 {
		t.Fatalf("admin's revoked not deleted: %+v", rev)
	}
	if rev, _ := i.ListInvites(ctx, id, 7, 0, true); !hasToken(rev, c1.Token) {
		t.Fatal("creator's revoked link deleted by admin")
	}
	// Чужие — только создатель.
	if err := i.DeleteAllRevoked(ctx, id, 8, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("admin clears creator's revoked: want ErrForbidden, got %v", err)
	}
	// Создатель чистит отозванные админа (admin_id=8), а свои не трогает.
	a2, _ := i.CreateInvite(ctx, id, 8, "a2", nil, false, nil)
	_, _ = i.EditInvite(ctx, id, 8, a2.Token, domain.InviteEdit{Revoked: &revoked})
	if err := i.DeleteAllRevoked(ctx, id, 7, 8); err != nil {
		t.Fatalf("creator clears admin's revoked: %v", err)
	}
	if rev, _ := i.ListInvites(ctx, id, 7, 8, true); len(rev) != 0 {
		t.Fatalf("admin's revoked not cleared by creator: %+v", rev)
	}
	if rev, _ := i.ListInvites(ctx, id, 7, 0, true); !hasToken(rev, c1.Token) {
		t.Fatal("creator's own revoked link deleted by DeleteAllRevoked(admin_id=8)")
	}
}

func TestAdminsWithInvites_CreatorOnly(t *testing.T) {
	i, id, c1, _ := inviteOwnerFixture(t)
	ctx := context.Background()
	revoked := true
	_, _ = i.EditInvite(ctx, id, 7, c1.Token, domain.InviteEdit{Revoked: &revoked})
	_, _ = i.CreateInvite(ctx, id, 7, "c2", nil, false, nil)

	got, err := i.AdminsWithInvites(ctx, id, 7)
	if err != nil {
		t.Fatalf("AdminsWithInvites(creator): %v", err)
	}
	// У создателя ещё и начальная ссылка группы (CreateGroup) и c2; c1 отозвана.
	want := []domain.AdminInvites{{AdminID: 7, Active: 2, Revoked: 1}, {AdminID: 8, Active: 1}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("admins = %+v; want %+v", got, want)
	}
	if _, err := i.AdminsWithInvites(ctx, id, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("AdminsWithInvites(admin): want ErrForbidden, got %v", err)
	}
	if _, err := i.AdminsWithInvites(ctx, id, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("AdminsWithInvites(member): want ErrForbidden, got %v", err)
	}
}
