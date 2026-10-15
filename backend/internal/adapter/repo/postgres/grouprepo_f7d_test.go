package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф7-Д: InsertMember сообщает о реальной вставке (повторный вход — false и
// member_count не растёт), EditTitle/EditAbout — об изменении значения и не
// трогают соседние колонки.
func TestGroupRepo_InsertMemberAndEdits(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7201")
	user := seedUser(t, pool, "+7202")
	groups := NewGroupRepo(pool)
	id, err := groups.CreateMultiMember(ctx, "group", "Т", "о", "f7d_repo_grp", true, owner)
	if err != nil {
		t.Fatal(err)
	}

	if ins, err := groups.InsertMember(ctx, id, user, domain.RoleMember, 0); err != nil || !ins {
		t.Fatalf("первая вставка: ins=%v err=%v", ins, err)
	}
	if ins, err := groups.InsertMember(ctx, id, user, domain.RoleMember, 0); err != nil || ins {
		t.Fatalf("повторная вставка: ins=%v err=%v; ждали false", ins, err)
	}
	var cnt int
	if err := pool.QueryRow(ctx, `SELECT member_count FROM chats WHERE id=$1`, id).Scan(&cnt); err != nil || cnt != 1 {
		t.Fatalf("member_count = %d err=%v; ждали 1 (создатель в CreateMultiMember не считается)", cnt, err)
	}

	if ch, err := groups.EditTitle(ctx, id, "Т"); err != nil || ch {
		t.Fatalf("то же название: changed=%v err=%v", ch, err)
	}
	if ch, err := groups.EditTitle(ctx, id, "Новое"); err != nil || !ch {
		t.Fatalf("новое название: changed=%v err=%v", ch, err)
	}
	if ch, err := groups.EditAbout(ctx, id, "о"); err != nil || ch {
		t.Fatalf("то же описание: changed=%v err=%v", ch, err)
	}
	if ch, err := groups.EditAbout(ctx, id, "новое о"); err != nil || !ch {
		t.Fatalf("новое описание: changed=%v err=%v", ch, err)
	}
	var title, about, username string
	if err := pool.QueryRow(ctx, `SELECT title, about, COALESCE(username,'') FROM chats WHERE id=$1`, id).Scan(&title, &about, &username); err != nil {
		t.Fatal(err)
	}
	if title != "Новое" || about != "новое о" || username != "f7d_repo_grp" {
		t.Fatalf("после правок: %q %q %q", title, about, username)
	}
}
