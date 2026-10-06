package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Б-115/A4-07/A6-06: фильтры channels.getParticipants, count — всего по
// фильтру, «недавние» — по дате вступления, админы — создатель первым.
func TestGroupRepo_ListParticipantsFilters(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	r := NewGroupRepo(pool)
	owner := seedUser(t, pool, "+79990015001")
	adm := seedUser(t, pool, "+79990015002")
	m1 := seedUser(t, pool, "+79990015003")
	m2 := seedUser(t, pool, "+79990015004")
	bot := seedUser(t, pool, "+79990015005")
	kicked := seedUser(t, pool, "+79990015006")
	if _, err := pool.Exec(ctx, `UPDATE users SET is_bot = true WHERE id = $1`, bot); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO contacts (owner_id, user_id) VALUES ($1, $2)`, m1, m2); err != nil {
		t.Fatal(err)
	}
	chatID, err := r.CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().Add(-time.Hour)
	for k, row := range []struct {
		id     int64
		role   string
		rights domain.Rights
	}{{owner, domain.RoleCreator, domain.AllRights}, {adm, domain.RoleAdmin, domain.RightBanUsers},
		{m1, domain.RoleMember, 0}, {m2, domain.RoleMember, 0}, {bot, domain.RoleMember, 0}} {
		if err := r.AddMember(ctx, chatID, row.id, row.role, row.rights); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE chat_members SET joined_at = $3 WHERE chat_id = $1 AND user_id = $2`,
			chatID, row.id, base.Add(time.Duration(k)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.SetRole(ctx, chatID, adm, domain.RoleAdmin, domain.RightBanUsers, owner); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRank(ctx, chatID, adm, "модер"); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRestriction(ctx, domain.MemberRestriction{ChatID: chatID, UserID: m1, DeniedRights: domain.PermSendMedia, RestrictedBy: owner}); err != nil {
		t.Fatal(err)
	}
	if err := r.Ban(ctx, chatID, kicked, owner); err != nil {
		t.Fatal(err)
	}

	list := func(f domain.ParticipantsFilter, offset, limit int) ([]domain.Participant, int) {
		t.Helper()
		ps, total, err := r.ListParticipants(ctx, chatID, m1, f, offset, limit)
		if err != nil {
			t.Fatal(err)
		}
		return ps, total
	}
	ids := func(ps []domain.Participant) []int64 {
		out := make([]int64, 0, len(ps))
		for _, p := range ps {
			out = append(out, p.UserID)
		}
		return out
	}

	// Недавние: свежие сверху, страница 2 из 5, count — всего.
	ps, total := list(domain.ParticipantsFilter{Kind: domain.ParticipantsRecent}, 0, 2)
	if total != 5 || len(ps) != 2 || ps[0].UserID != bot || ps[1].UserID != m2 {
		t.Fatalf("recent: total=%d ids=%v", total, ids(ps))
	}
	if ps[0].JoinedAt.IsZero() {
		t.Fatal("date участника пуст (A4-16)")
	}
	ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsRecent}, 4, 2)
	if total != 5 || len(ps) != 1 || ps[0].UserID != owner {
		t.Fatalf("recent, хвост: total=%d ids=%v", total, ids(ps))
	}
	// Админы: создатель первым, ранг и назначивший.
	ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsAdmins}, 0, 50)
	if total != 2 || ps[0].UserID != owner || ps[1].UserID != adm || ps[1].Rank != "модер" || ps[1].PromotedBy != owner {
		t.Fatalf("admins: %+v", ps)
	}
	// Ограниченные — действующее ограничение участника.
	ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsBanned}, 0, 50)
	if total != 1 || ps[0].UserID != m1 || ps[0].Restriction == nil || ps[0].Restriction.CreatedAt.IsZero() {
		t.Fatalf("banned: %+v", ps)
	}
	// Удалённые — не участники, с датой.
	ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsKicked}, 0, 50)
	if total != 1 || !ps[0].Kicked || ps[0].UserID != kicked || ps[0].KickedBy != owner || ps[0].KickedAt.IsZero() {
		t.Fatalf("kicked: %+v", ps)
	}
	// Боты, контакты зрителя (m1 → m2).
	if ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsBots}, 0, 50); total != 1 || ps[0].UserID != bot {
		t.Fatalf("bots: %v", ids(ps))
	}
	if ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsContacts}, 0, 50); total != 1 || ps[0].UserID != m2 {
		t.Fatalf("contacts: %v", ids(ps))
	}
	if ps, total = list(domain.ParticipantsFilter{Kind: domain.ParticipantsMentions, TopMsgID: 1}, 0, 50); total != 5 || len(ps) != 5 {
		t.Fatalf("mentions: total=%d %v", total, ids(ps))
	}

	// Счётчики карточки.
	admins, k, b, err := r.ParticipantCounters(ctx, chatID)
	if err != nil || admins != 2 || k != 1 || b != 1 {
		t.Fatalf("counters = %d/%d/%d %v", admins, k, b, err)
	}

	// getParticipant: участник с ограничением, удалённый, посторонний.
	if p, err := r.GetParticipant(ctx, chatID, m1); err != nil || p.Restriction == nil || p.Role != domain.RoleMember {
		t.Fatalf("GetParticipant(m1) = %+v %v", p, err)
	}
	if p, err := r.GetParticipant(ctx, chatID, kicked); err != nil || !p.Kicked {
		t.Fatalf("GetParticipant(kicked) = %+v %v", p, err)
	}
	stranger := seedUser(t, pool, "+79990015007")
	if _, err := r.GetParticipant(ctx, chatID, stranger); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("GetParticipant(посторонний) = %v", err)
	}

	// SetJoinInfo: пригласивший и заявка.
	if err := r.SetJoinInfo(ctx, chatID, m2, owner, true); err != nil {
		t.Fatal(err)
	}
	if p, _ := r.GetParticipant(ctx, chatID, m2); p.InviterID != owner || !p.ViaRequest {
		t.Fatalf("join info: %+v", p)
	}
}

// A1-06/A4-06: действующее личное ограничение зрителя приезжает и в карточку,
// и в строку списка чатов; истёкшее — нет.
func TestGroupRepo_ViewerRestrictionInCardAndDialogs(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	r := NewGroupRepo(pool)
	owner := seedUser(t, pool, "+79990015011")
	u := seedUser(t, pool, "+79990015012")
	chatID, err := r.CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	if err != nil {
		t.Fatal(err)
	}
	_ = r.AddMember(ctx, chatID, owner, domain.RoleCreator, domain.AllRights)
	_ = r.AddMember(ctx, chatID, u, domain.RoleMember, 0)
	if err := r.SetRestriction(ctx, domain.MemberRestriction{ChatID: chatID, UserID: u, DeniedRights: domain.PermSendMedia, RestrictedBy: owner}); err != nil {
		t.Fatal(err)
	}
	card, err := r.Card(ctx, chatID, u)
	if err != nil || card.MyRestriction == nil || card.MyRestriction.DeniedRights != domain.PermSendMedia {
		t.Fatalf("Card.MyRestriction = %+v %v", card.MyRestriction, err)
	}
	if c0, _ := r.Card(ctx, chatID, 0); c0.MyRestriction != nil {
		t.Fatal("снимок без зрителя несёт ограничение")
	}
	ds, err := NewChatsRepo(pool).ListDialogs(ctx, u)
	if err != nil || len(ds) != 1 || ds[0].MyRestriction == nil {
		t.Fatalf("ListDialogs: %+v %v", ds, err)
	}
	past := time.Now().Add(-time.Minute)
	_ = r.SetRestriction(ctx, domain.MemberRestriction{ChatID: chatID, UserID: u, DeniedRights: domain.PermSendMedia, UntilDate: &past, RestrictedBy: owner})
	if c, _ := r.Card(ctx, chatID, u); c.MyRestriction != nil {
		t.Fatal("истёкшее ограничение в карточке")
	}
}

// Б-119: группа обсуждения знает свой канал.
func TestGroupRepo_CardLinkedChannel(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	r := NewGroupRepo(pool)
	owner := seedUser(t, pool, "+79990015021")
	ch, _ := r.CreateMultiMember(ctx, domain.ChatTypeChannel, "К", "", "", false, owner)
	g, _ := r.CreateMultiMember(ctx, domain.ChatTypeGroup, "О", "", "", false, owner)
	if err := r.SetDiscussion(ctx, ch, g); err != nil {
		t.Fatal(err)
	}
	if c, err := r.Card(ctx, g, owner); err != nil || c.LinkedChannelID != ch {
		t.Fatalf("LinkedChannelID = %d %v", c.LinkedChannelID, err)
	}
}

// Б-86: заявки страницами (свежие сверху, курсор, q, count — всего) и
// requests_pending/recent_requesters.
func TestJoinRequestRepo_PagesAndPending(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	g := NewGroupRepo(pool)
	jr := NewJoinRequestRepo(pool)
	owner := seedUser(t, pool, "+79990015031")
	chatID, _ := g.CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	var users []int64
	base := time.Now().Add(-time.Hour)
	for k := 0; k < 5; k++ {
		u := seedUser(t, pool, "+7999001504"+string(rune('0'+k)))
		users = append(users, u)
		if _, err := jr.Create(ctx, chatID, u, ""); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE join_requests SET created_at = $3 WHERE chat_id = $1 AND user_id = $2`,
			chatID, u, base.Add(time.Duration(k)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	page, total, err := jr.List(ctx, chatID, "", time.Time{}, 0, 2)
	if err != nil || total != 5 || len(page) != 2 || page[0].UserID != users[4] || page[1].UserID != users[3] {
		t.Fatalf("первая страница: %+v total=%d %v", page, total, err)
	}
	next, _, err := jr.List(ctx, chatID, "", page[1].CreatedAt, page[1].UserID, 2)
	if err != nil || len(next) != 2 || next[0].UserID != users[2] {
		t.Fatalf("вторая страница: %+v %v", next, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET display_name = 'Zed' WHERE id = $1`, users[0]); err != nil {
		t.Fatal(err)
	}
	if found, total, _ := jr.List(ctx, chatID, "ze", time.Time{}, 0, 50); total != 1 || found[0].UserID != users[0] {
		t.Fatalf("поиск: %+v total=%d", found, total)
	}
	n, recent, err := jr.Pending(ctx, chatID)
	if err != nil || n != 5 || len(recent) != 3 || recent[0] != users[4] {
		t.Fatalf("Pending = %d %v %v", n, recent, err)
	}
}

// Миграция 0150: админам без назначившего (до 0139) вписан владелец — так
// клиент (tweb canEditAdmin) и сервер одинаково дают их править только ему.
func TestMigration0150_PromotedByBackfill(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 139); err != nil {
		t.Fatalf("откат до 139: %v", err)
	}
	owner := seedUser(t, pool, "+79990015051")
	adm := seedUser(t, pool, "+79990015052")
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id) VALUES ('group','Г',$1) RETURNING id`, owner).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role, rights) VALUES ($1,$2,'creator',1023), ($1,$3,'admin',1)`,
		chatID, owner, adm); err != nil {
		t.Fatal(err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	m, err := NewGroupRepo(pool).GetMember(ctx, chatID, adm)
	if err != nil || m.PromotedBy != owner {
		t.Fatalf("promoted_by = %d %v; want %d", m.PromotedBy, err, owner)
	}
}

// Ревью #404 п. 6: курсор заявок — секунды провода; заявки внутри одной
// секунды при листании не теряются (дата хранится с точностью до секунды,
// 0151), в том числе старые строки с долями секунды.
func TestJoinRequestRepo_CursorWithinOneSecond(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	g := NewGroupRepo(pool)
	jr := NewJoinRequestRepo(pool)
	owner := seedUser(t, pool, "+79990015061")
	chatID, _ := g.CreateMultiMember(ctx, domain.ChatTypeGroup, "Г", "", "", false, owner)
	var users []int64
	for k := 0; k < 3; k++ {
		u := seedUser(t, pool, "+7999001507"+string(rune('0'+k)))
		users = append(users, u)
		if _, err := jr.Create(ctx, chatID, u, ""); err != nil {
			t.Fatal(err)
		}
	}
	var frac int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM join_requests WHERE chat_id=$1 AND created_at <> date_trunc('second', created_at)`, chatID).Scan(&frac); err != nil || frac != 0 {
		t.Fatalf("доли секунды в дате заявки: %d %v", frac, err)
	}
	// Все три — в одну секунду: листаем по одной, клиент шлёт дату в секундах.
	if _, err := pool.Exec(ctx, `UPDATE join_requests SET created_at = date_trunc('second', now()) WHERE chat_id = $1`, chatID); err != nil {
		t.Fatal(err)
	}
	seen := map[int64]bool{}
	var cursor time.Time
	var cursorUser int64
	for k := 0; k < 4; k++ {
		page, _, err := jr.List(ctx, chatID, "", cursor, cursorUser, 1)
		if err != nil {
			t.Fatal(err)
		}
		if len(page) == 0 {
			break
		}
		seen[page[0].UserID] = true
		cursor, cursorUser = time.Unix(page[0].CreatedAt.Unix(), 0), page[0].UserID
	}
	for _, u := range users {
		if !seen[u] {
			t.Fatalf("заявка %d потерялась при листании: %v", u, seen)
		}
	}
}

// Миграция 0152: служебки ограничения, уже лежащие в истории, удалены мягко —
// deleted_at и снятое действие (конструктора больше нет).
func TestMigration0152_DropRestrictService(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 151); err != nil {
		t.Fatalf("откат до 151: %v", err)
	}
	owner := seedUser(t, pool, "+79990015081")
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id) VALUES ('group','Г',$1) RETURNING id`, owner).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO messages (chat_id, sender_id, seq, type, text, action)
		VALUES ($1,$2,1,'service','', '{"_":"messageActionRestrict","user_id":5,"banned_rights":{"_":"chatBannedRights","pFlags":{},"until_date":0}}'),
		       ($1,$2,2,'service','', '{"_":"messageActionChatAddUser","users":[5]}')`, chatID, owner); err != nil {
		t.Fatal(err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат: %v", err)
	}
	var left, kept int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND action->>'_' = 'messageActionRestrict'`, chatID).Scan(&left)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND action->>'_' = 'messageActionChatAddUser'`, chatID).Scan(&kept)
	if left != 0 || kept != 1 {
		t.Fatalf("после 0152: restrict=%d, add_user=%d; want 0 и 1", left, kept)
	}
}
