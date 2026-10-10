package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0139 разводит роли по типу чата (A5-07, A5-26): вступившие в КАНАЛ
// по ссылке, добавлением или одобрением лежали 'member' и получали дефолтные
// права группы, а вступившие в ГРУППУ по @имени — 'subscriber' без прав.
// Заодно админам групп выдаётся manage_topics (темами прежде управлял любой
// админ), а группе обсуждения открывается история. Проверяем на настоящих
// строках: откат на версию назад, строки как их писал прежний код, накат и
// чтение обычным репозиторием.
func TestMigration0139_JoinRoleByChatType(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 138); err != nil {
		t.Fatalf("откат до 138: %v", err)
	}
	owner := seedUser(t, pool, "+79990001370")
	sub := seedUser(t, pool, "+79990001371")
	adm := seedUser(t, pool, "+79990001372")
	gadm := seedUser(t, pool, "+79990001379")
	var channelID, groupID, discID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id) VALUES ('channel','К',$1) RETURNING id`, owner).Scan(&channelID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id) VALUES ('group','Г',$1) RETURNING id`, owner).Scan(&groupID); err != nil {
		t.Fatal(err)
	}
	// Группа обсуждения со скрытой историей.
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id, history_for_new) VALUES ('group','О',$1,false) RETURNING id`, owner).Scan(&discID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, channelID, discID); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		chat, user int64
		role       string
		rights     int
	}{
		{channelID, owner, "creator", 255}, {channelID, sub, "member", 0}, {channelID, adm, "admin", 1},
		{groupID, owner, "creator", 255}, {groupID, sub, "subscriber", 0}, {groupID, adm, "member", 0},
		{groupID, gadm, "admin", 64},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role, rights) VALUES ($1,$2,$3,$4)`,
			row.chat, row.user, row.role, row.rights); err != nil {
			t.Fatal(err)
		}
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат: %v", err)
	}

	r := NewGroupRepo(pool)
	for _, want := range []struct {
		chat, user int64
		role       string
		rights     domain.Rights
	}{
		{channelID, sub, domain.RoleSubscriber, 0},
		{channelID, adm, domain.RoleAdmin, domain.RightPostMessages},
		{channelID, owner, domain.RoleCreator, domain.AllRights},
		{groupID, sub, domain.RoleMember, 0},
		{groupID, adm, domain.RoleMember, 0},
		// manage_topics — да, anonymous — нет (A5-37).
		{groupID, gadm, domain.RoleAdmin, domain.RightChangeInfo | domain.RightManageTopics},
	} {
		m, err := r.GetMember(ctx, want.chat, want.user)
		if err != nil {
			t.Fatal(err)
		}
		// Назначивший у прежних админов — владелец: его вписывает 0150 (п. 5
		// ревью #401), у остальных — нет.
		wantBy := int64(0)
		if want.role == domain.RoleAdmin {
			wantBy = owner
		}
		if m.Role != want.role || m.Rights != want.rights || m.PromotedBy != wantBy {
			t.Errorf("чат %d, пользователь %d: %+v, ждали роль %q и права %d", want.chat, want.user, m, want.role, want.rights)
		}
	}
	if s, err := r.Settings(ctx, discID); err != nil || !s.HistoryForNew {
		t.Fatalf("у группы обсуждения история осталась скрытой: %+v %v", s, err)
	}
}

// Стенды, где эта миграция уже лежала под номером 0137 (до влития 0138):
// в goose_db_version есть 137 без файла и колонка promoted_by. goose.Up обязан
// пройти 0138 и 0139 без ошибки, а 0139 — повторно безопасна.
func TestMigration0139_AfterPhantom0137(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 136); err != nil {
		t.Fatalf("откат до 136: %v", err)
	}
	if _, err := pool.Exec(ctx, `ALTER TABLE chat_members ADD COLUMN promoted_by BIGINT`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO goose_db_version (version_id, is_applied) VALUES (137, true)`); err != nil {
		t.Fatal(err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат поверх фантомной 137: %v", err)
	}
	var applied []int64
	rows, err := pool.Query(ctx, `SELECT version_id FROM goose_db_version WHERE version_id BETWEEN 137 AND 139 AND is_applied ORDER BY version_id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var v int64
		_ = rows.Scan(&v)
		applied = append(applied, v)
	}
	rows.Close()
	if len(applied) < 3 || applied[0] != 137 || applied[1] != 138 || applied[2] != 139 {
		t.Fatalf("применены версии %v, ждали [137 138 139 …]", applied)
	}
}

// promoted_by пишется и читается; SetRole не-участника — ErrNotFound (A5-36).
func TestGroupRepo_SetRolePromotedBy(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	r := NewGroupRepo(pool)
	owner := seedUser(t, pool, "+79990001373")
	u := seedUser(t, pool, "+79990001374")
	chatID, err := r.CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.AddMember(ctx, chatID, u, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRole(ctx, chatID, u, domain.RoleAdmin, domain.RightBanUsers, owner); err != nil {
		t.Fatal(err)
	}
	if m, _ := r.GetMember(ctx, chatID, u); m.PromotedBy != owner {
		t.Fatalf("promoted_by = %d, ждали %d", m.PromotedBy, owner)
	}
	if err := r.SetRole(ctx, chatID, u, domain.RoleMember, 0, 0); err != nil {
		t.Fatal(err)
	}
	if m, _ := r.GetMember(ctx, chatID, u); m.PromotedBy != 0 {
		t.Fatalf("снятый админ хранит promoted_by = %d", m.PromotedBy)
	}
	if err := r.SetRole(ctx, chatID, owner+u+1000, domain.RoleAdmin, 0, owner); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetRole не-участника = %v, ждали ErrNotFound", err)
	}
}

// Лимит использований держит сам UPDATE (VA2-04): последнее место достаётся
// одному.
func TestInviteRepo_IncUsesRespectsLimit(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+79990001375")
	chatID, err := NewGroupRepo(pool).CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	one := 1
	link, err := NewInviteRepo(pool).Create(ctx, chatID, owner, "tok-0137", "", &one, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	inv := NewInviteRepo(pool)
	if err := inv.IncUses(ctx, link.ID); err != nil {
		t.Fatalf("первый вход: %v", err)
	}
	if err := inv.IncUses(ctx, link.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("второй вход по ссылке с лимитом 1 = %v, ждали ErrForbidden", err)
	}
}

// TokenFor различает «заявки нет» и «заявка без ссылки» (A5-10в).
func TestJoinRequestRepo_TokenForExists(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+79990001376")
	u := seedUser(t, pool, "+79990001377")
	chatID, err := NewGroupRepo(pool).CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	jr := NewJoinRequestRepo(pool)
	if _, ok, err := jr.TokenFor(ctx, chatID, u); err != nil || ok {
		t.Fatalf("заявки нет: ok=%v err=%v", ok, err)
	}
	if _, err := jr.Create(ctx, chatID, u, "tok"); err != nil {
		t.Fatal(err)
	}
	if tok, ok, err := jr.TokenFor(ctx, chatID, u); err != nil || !ok || tok != "tok" {
		t.Fatalf("заявка есть: %q ok=%v err=%v", tok, ok, err)
	}
}

// ByRoot находит тему по корню треда (Send проверяет closed, A5-25); тред не
// тема — ErrNotFound.
func TestTopicsRepo_ByRoot(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+79990001378")
	chatID, err := NewGroupRepo(pool).CreateMultiMember(ctx, domain.ChatTypeGroup, "Ф", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	tr := NewTopicsRepo(pool)
	created, err := tr.Create(ctx, domain.ForumTopicRecord{ChatID: chatID, RootMsgID: 777, Title: "Тема", CreatedBy: owner})
	if err != nil {
		t.Fatal(err)
	}
	if err := tr.SetClosed(ctx, created.ID, true); err != nil {
		t.Fatal(err)
	}
	got, err := tr.ByRoot(ctx, chatID, 777)
	if err != nil || got.ID != created.ID || !got.Closed {
		t.Fatalf("ByRoot = %+v, %v", got, err)
	}
	if _, err := tr.ByRoot(ctx, chatID, 778); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ByRoot не темы = %v, ждали ErrNotFound", err)
	}
}
