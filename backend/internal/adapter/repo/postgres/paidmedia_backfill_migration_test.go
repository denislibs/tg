package postgres

import (
	"context"
	"fmt"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0192 — бэкфилл предложений копий старой формы (до 0140): пересланная
// копия продавалась пересылающим (своя строка paid_media без источника), зеркало
// платного поста раздавалось даром (строки paid_media нет). После миграции обе
// продаются предложением исходника, а бесплатные копии не трогаются.
// 0192 не зависит от 0184–0191 (зарезервированы планами): откат — ровно на один шаг,
// до 191, а не до 183, иначе тест гонял бы чужие миграции вниз и вверх.
const paidBackfillPrevVersion = 191

func TestMigration0192_PaidMediaBackfillOffers(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, paidBackfillPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", paidBackfillPrevVersion, err)
	}

	alice := seedUser(t, pool, "+79990000251")
	bob := seedUser(t, pool, "+79990000252")
	chat := seedPrivateChat(t, pool, alice, bob)
	var mediaID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','backfill','image/jpeg') RETURNING id`,
		alice).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	msg := func(sender int64, seq int64, fwdFrom int64, mirror bool) int64 {
		t.Helper()
		id := seedMessage(t, pool, chat, sender, seq)
		exec(`UPDATE messages SET media_id=$2, is_discussion_mirror=$3,
			fwd_from_chat_id=CASE WHEN $4::bigint = 0 THEN NULL ELSE $5::bigint END,
			fwd_from_msg_id=NULLIF($4::bigint, 0) WHERE id=$1`, id, mediaID, mirror, fwdFrom, chat)
		return id
	}

	paid := msg(alice, 1, 0, false)
	exec(`INSERT INTO paid_media (message_id, price_stars) VALUES ($1, 30)`, paid)
	// (а) старая копия: своя строка без источника — продавал пересылающий
	oldCopy := msg(bob, 2, paid, false)
	exec(`INSERT INTO paid_media (message_id, price_stars) VALUES ($1, 30)`, oldCopy)
	// (б) зеркало платного поста без строки paid_media
	mirror := msg(alice, 3, paid, true)
	// бесплатный исходник, его копия и зеркало — не трогаются
	free := msg(alice, 4, 0, false)
	freeCopy := msg(bob, 5, free, false)
	freeMirror := msg(alice, 6, free, true)
	// покупатель старой копии: платил пересылающему (разблокировка лежит на копии)
	carol := seedUser(t, pool, "+79990000253")
	exec(`INSERT INTO paid_media_unlocks (message_id, user_id) VALUES ($1, $2)`, oldCopy, carol)
	// цепочка: копия новой формы от копии старой (source = oldCopy, как писал Offers
	// до схлопывания), её покупатель разблокировал предложение oldCopy
	dave := seedUser(t, pool, "+79990000254")
	for _, uid := range []int64{carol, dave} {
		exec(`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, chat, uid)
	}
	chained := msg(bob, 7, paid, false)
	exec(`INSERT INTO paid_media (message_id, price_stars, source_message_id) VALUES ($1, 30, $2)`, chained, oldCopy)
	exec(`INSERT INTO paid_media_unlocks (message_id, user_id) VALUES ($1, $2)`, oldCopy, dave)
	// отложенная пересылка старой копии хранит offer_id = oldCopy
	var sched int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, send_at, params)
		 VALUES ($1, $2, now() + interval '1 day', $3::jsonb) RETURNING id`,
		chat, bob, fmt.Sprintf(`{"fwd":{"offer_id":%d,"offer_price":30}}`, oldCopy)).Scan(&sched); err != nil {
		t.Fatal(err)
	}

	if err := storepostgres.MigrateUpTo(url, paidBackfillPrevVersion+1); err != nil {
		t.Fatalf("миграция 0192: %v", err)
	}

	source := func(id int64) (int64, int64, bool) {
		t.Helper()
		var price int64
		var src *int64
		err := pool.QueryRow(ctx, `SELECT price_stars, source_message_id FROM paid_media WHERE message_id=$1`, id).Scan(&price, &src)
		if err != nil {
			return 0, 0, false
		}
		if src == nil {
			return price, 0, true
		}
		return price, *src, true
	}
	if price, src, ok := source(oldCopy); !ok || src != paid || price != 30 {
		t.Fatalf("старая копия: ok=%v src=%d price=%d, want src=%d", ok, src, price, paid)
	}
	if price, src, ok := source(mirror); !ok || src != paid || price != 30 {
		t.Fatalf("зеркало платного поста: ok=%v src=%d price=%d, want src=%d", ok, src, price, paid)
	}
	if _, src, ok := source(paid); !ok || src != 0 {
		t.Fatalf("исходник изменился: ok=%v src=%d", ok, src)
	}
	for _, id := range []int64{free, freeCopy, freeMirror} {
		if _, _, ok := source(id); ok {
			t.Fatalf("бесплатное сообщение %d стало платным", id)
		}
	}
	// цепочка схлопнута до исходника
	if _, src, ok := source(chained); !ok || src != paid {
		t.Fatalf("копия от копии: ok=%v src=%d, want %d", ok, src, paid)
	}
	var offer int64
	if err := pool.QueryRow(ctx, `SELECT (params->'fwd'->>'offer_id')::bigint FROM scheduled_messages WHERE id=$1`, sched).Scan(&offer); err != nil || offer != paid {
		t.Fatalf("отложенная пересылка: offer_id=%d err=%v, want %d", offer, err, paid)
	}
	// покупки не потеряны: разблокировки копии и цепочки переехали на исходник
	access := NewMediaAccessRepo(pool)
	for name, uid := range map[string]int64{"покупатель старой копии": carol, "покупатель цепочки": dave} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM paid_media_unlocks WHERE message_id=$1 AND user_id=$2`, paid, uid).Scan(&n); err != nil || n != 1 {
			t.Fatalf("%s: разблокировка исходника n=%d err=%v", name, n, err)
		}
		if ok, err := access.CanAccess(ctx, uid, mediaID); err != nil || !ok {
			t.Fatalf("%s не скачивает после миграции: ok=%v err=%v", name, ok, err)
		}
	}

}
