package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// «Уведомления включены» в статистике канала — те же эффективно незаглушённые
// подписчики, что получают пуш (domain.ChatMuted): NULL наследует выключенный
// тип канала, явное «уведомлять» (0) — исключение, срок в будущем — заглушён.
func TestStatsRepo_NotificationsOnRespectsTypeAndExplicitChoice(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	author := seedUser(t, pool, "+7970")
	inherits := seedUser(t, pool, "+7971") // тип выключен, чат не тронут -> выкл
	explicit := seedUser(t, pool, "+7972") // тип выключен, чат явно включён -> вкл
	plain := seedUser(t, pool, "+7973")    // тип по умолчанию -> вкл
	timed := seedUser(t, pool, "+7974")    // срок в будущем -> выкл
	ch := createGroupLike(t, pool, "channel", author)
	groups := NewGroupRepo(pool)
	for _, u := range []int64{inherits, explicit, plain, timed} {
		if err := groups.AddMember(ctx, ch, u, domain.RoleSubscriber, 0); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(t, pool, `INSERT INTO notify_settings (user_id, channels_muted) VALUES ($1,true), ($2,true)`, inherits, explicit)
	mustExec(t, pool, `UPDATE chat_members SET muted_until = to_timestamp(0) WHERE chat_id=$1 AND user_id=$2`, ch, explicit)
	mustExec(t, pool, `UPDATE chat_members SET muted_until = now() + interval '1 hour' WHERE chat_id=$1 AND user_id=$2`, ch, timed)

	on, err := NewStatsRepo(pool).NotificationsOn(ctx, ch, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	// автор (тип по умолчанию, чат не тронут), explicit, plain
	if on != 3 {
		t.Fatalf("NotificationsOn = %d, want 3", on)
	}
}
