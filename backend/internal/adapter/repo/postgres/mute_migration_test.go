package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0104 схлопывает две колонки мьюта в одну: `muted BOOLEAN`
// («навсегда») исчезает, а его значение переносится в срок
// `muted_until = MuteUntilForever` — в схеме мьют выражает
// peerNotifySettings.mute_until, и второго способа сказать то же самое быть не
// должно (решение Р4 разбора диалогов).
//
// Цена ошибки здесь — молча РАЗМЬЮЧЕННЫЕ чаты у всех, кто глушил их «навсегда»:
// колонка удалена, значит потерянное значение восстановить неоткуда. Поэтому
// проверка на настоящих строках в настоящем Postgres.
//
// Схема та же, что у 0100–0103: откатываемся на версию назад (там ещё две
// колонки), пишем строки как их писал прежний код, накатываем 0104 и читаем
// ОБЫЧНЫМИ репозиториями — они знают только новую форму, поэтому
// «прочиталось» и значит «сконвертировалось».
const muteMigrationPrevVersion = 103

func TestMigration0104_MuteForeverBecomesDeadline(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, muteMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", muteMigrationPrevVersion, err)
	}

	forever := seedUser(t, pool, "+79990000401")   // заглушил навсегда
	temporary := seedUser(t, pool, "+79990000402") // заглушил на час
	expired := seedUser(t, pool, "+79990000403")   // срок уже вышел
	loud := seedUser(t, pool, "+79990000404")      // не глушил вовсе
	both := seedUser(t, pool, "+79990000405")      // и флаг, и срок разом

	var chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title) VALUES ('group','Группа') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	until := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	past := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	// Прежний код: «навсегда» — булев флаг, «на срок» — timestamptz.
	seed := func(userID int64, muted bool, mutedUntil *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_members (chat_id, user_id, role, muted, muted_until)
			 VALUES ($1,$2,'member',$3,$4)`, chatID, userID, muted, mutedUntil); err != nil {
			t.Fatalf("seed member %d: %v", userID, err)
		}
	}
	seed(forever, true, nil)
	seed(temporary, false, &until)
	seed(expired, false, &past)
	seed(loud, false, nil)
	// Обе колонки разом: «навсегда» обязан победить срок, иначе чат
	// размьютится через час у того, кто глушил его насовсем.
	seed(both, true, &until)

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0104: %v", err)
	}

	repo := NewGroupRepo(pool)
	settings := func(userID int64) domain.PeerNotifySettings {
		t.Helper()
		ns, err := repo.NotifySettings(ctx, chatID, userID)
		if err != nil {
			t.Fatalf("NotifySettings(%d): %v", userID, err)
		}
		return ns
	}

	now := time.Now()

	// ── 1. «Навсегда» стало сроком, и это ТОТ САМЫЙ срок оригинала ──────────
	// Число обязано совпасть побайтово: по нему клиент отличает «навсегда» от
	// «до такого-то часа» и решает, показывать ли срок.
	for _, userID := range []int64{forever, both} {
		ns := settings(userID)
		if ns.MuteUntil == nil || *ns.MuteUntil != domain.MuteUntilForever {
			t.Errorf("пользователь %d: mute_until = %v; want %d", userID, ns.MuteUntil, domain.MuteUntilForever)
		}
		if !ns.Muted(now) {
			t.Errorf("пользователь %d размьючен после миграции", userID)
		}
	}

	// ── 2. Временный мьют не тронут — со своим сроком ───────────────────────
	ns := settings(temporary)
	if ns.MuteUntil == nil || int64(*ns.MuteUntil) != until.Unix() {
		t.Errorf("временный мьют = %v; want %d", ns.MuteUntil, until.Unix())
	}
	if !ns.Muted(now) {
		t.Error("временный мьют перестал действовать")
	}

	// ── 3. Истёкший и никогда не заглушённый — не замьючены ─────────────────
	if settings(expired).Muted(now) {
		t.Error("истёкший мьют снова действует")
	}
	if got := settings(loud); got.Muted(now) || got.MuteUntil != nil {
		t.Errorf("незаглушённый чат = %+v; want ни срока, ни мьюта", got)
	}

	// ── 4. Колонки muted больше нет ─────────────────────────────────────────
	// Иначе «два механизма на один вопрос» остались бы жить, просто один из
	// них перестал бы читаться.
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.columns
		                 WHERE table_name='chat_members' AND column_name='muted')`).Scan(&exists); err != nil {
		t.Fatalf("проверка колонки: %v", err)
	}
	if exists {
		t.Error("колонка chat_members.muted осталась после наката")
	}

	// ── 5. Круг вниз-вверх ──────────────────────────────────────────────────
	// Down обязан быть исполнимым: без него миграцию нельзя откатить на живом
	// деплое. Повторный Up обязан вернуть ту же форму.
	if err := storepostgres.MigrateDownTo(url, muteMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	// После отката «навсегда» снова флаг, а срок снят: иначе чат оказался бы
	// заглушён дважды и снятие флага не сняло бы мьют.
	var mutedFlag bool
	var mutedUntil *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT muted, muted_until FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, forever).Scan(&mutedFlag, &mutedUntil); err != nil {
		t.Fatalf("чтение после отката: %v", err)
	}
	if !mutedFlag || mutedUntil != nil {
		t.Errorf("после отката muted=%v muted_until=%v; want true nil", mutedFlag, mutedUntil)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if got := settings(forever); got.MuteUntil == nil || *got.MuteUntil != domain.MuteUntilForever {
		t.Errorf("после круга вниз-вверх mute_until = %v; want %d", got.MuteUntil, domain.MuteUntilForever)
	}
}
