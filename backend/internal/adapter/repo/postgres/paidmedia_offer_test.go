package postgres

import (
	"context"
	"fmt"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Копия платного медиа (пересылка, зеркало) продаётся предложением исходника:
// продавец — автор исходника, разблокировка исходника открывает и копию, а
// автор копии своё «медиа» без покупки не скачивает (ревью #403, находка 1).
func TestPaidMedia_CopySoldBySourceOffer(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+79990000221")
	bob := seedUser(t, pool, "+79990000222")
	chat := seedPrivateChat(t, pool, alice, bob)
	var mediaID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','paid-offer','image/jpeg') RETURNING id`,
		alice).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	orig := seedMessage(t, pool, chat, alice, 1)
	cp := seedMessage(t, pool, chat, bob, 2)
	if _, err := pool.Exec(ctx, `UPDATE messages SET media_id=$1 WHERE id = ANY($2)`, mediaID, []int64{orig, cp}); err != nil {
		t.Fatal(err)
	}
	repo := NewPaidMediaRepo(pool)
	if err := repo.SetPrice(ctx, orig, 30, 0); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetPrice(ctx, cp, 30, orig); err != nil {
		t.Fatal(err)
	}
	offers, err := repo.Offers(ctx, []int64{orig, cp})
	if err != nil {
		t.Fatal(err)
	}
	if o := offers[cp]; o.OfferID != orig || o.SellerID != alice || o.Price != 30 {
		t.Fatalf("предложение копии %+v, want исходник %d продавец %d", o, orig, alice)
	}
	if o := offers[orig]; o.OfferID != orig || o.SellerID != alice {
		t.Fatalf("предложение исходника %+v", o)
	}
	access := NewMediaAccessRepo(pool)
	if ok, err := access.CanAccess(ctx, bob, mediaID); err != nil || ok {
		t.Fatalf("автор копии скачивает без покупки: ok=%v err=%v", ok, err)
	}
	if _, err := repo.Unlock(ctx, orig, bob); err != nil {
		t.Fatal(err)
	}
	if ok, err := access.CanAccess(ctx, bob, mediaID); err != nil || !ok {
		t.Fatalf("купивший исходник: ok=%v err=%v", ok, err)
	}
}

// P0-фикс 4 (аватар Алисы 404): замок закрывает файл ТОЛЬКО как вложение
// платного сообщения. Тот же файл бесплатным сообщением в другом чате или
// фото чата качается без покупки; прежде замок по media_id гасил все пути.
func TestPaidMedia_LockOnlyOnPaidMessagePath(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+79990000231")
	bob := seedUser(t, pool, "+79990000232")
	carol := seedUser(t, pool, "+79990000233")
	dave := seedUser(t, pool, "+79990000234")
	paidChat := seedPrivateChat(t, pool, alice, bob)
	freeChat := seedPrivateChat(t, pool, alice, carol)
	photoChat := seedPrivateChat(t, pool, alice, dave)
	var mediaID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','paid-paths','image/jpeg') RETURNING id`,
		alice).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	paid := seedMessage(t, pool, paidChat, alice, 1)
	free := seedMessage(t, pool, freeChat, alice, 1)
	if _, err := pool.Exec(ctx, `UPDATE messages SET media_id=$1 WHERE id = ANY($2)`, mediaID, []int64{paid, free}); err != nil {
		t.Fatal(err)
	}
	if err := NewPaidMediaRepo(pool).SetPrice(ctx, paid, 30, 0); err != nil {
		t.Fatal(err)
	}
	access := NewMediaAccessRepo(pool)

	if ok, err := access.CanAccess(ctx, bob, mediaID); err != nil || ok {
		t.Fatalf("получатель платного качает без покупки: ok=%v err=%v", ok, err)
	}
	if ok, err := access.CanAccess(ctx, alice, mediaID); err != nil || !ok {
		t.Fatalf("автор не качает своё: ok=%v err=%v", ok, err)
	}
	if ok, err := access.CanAccess(ctx, carol, mediaID); err != nil || !ok {
		t.Fatalf("бесплатное сообщение закрыто чужим платным: ok=%v err=%v", ok, err)
	}
	if ok, _ := access.CanAccess(ctx, dave, mediaID); ok {
		t.Fatal("предусловие: у dave пути к файлу нет")
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET photo_media_id=$1 WHERE id=$2`, mediaID, photoChat); err != nil {
		t.Fatal(err)
	}
	if ok, err := access.CanAccess(ctx, dave, mediaID); err != nil || !ok {
		t.Fatalf("фото чата закрыто замком платного сообщения: ok=%v err=%v", ok, err)
	}
}

// Отложенная пересылка платного (предложение — в params.fwd, строки paid_media
// у неё нет) байты без покупки не открывает; купил — открывает; исходник удалён
// — заперто, как у опубликованной копии. Бесплатная отложенная пересылка того же
// файла не запирается чужим платным (контрольные ревью p0-fix-4).
func TestPaidMedia_ScheduledForwardStaysLocked(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+79990000241")
	bob := seedUser(t, pool, "+79990000242")
	carol := seedUser(t, pool, "+79990000243")
	srcChat := seedPrivateChat(t, pool, alice, carol) // источник Бобу не виден
	dstChat := seedPrivateChat(t, pool, alice, bob)
	var mediaID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','paid-sched','image/jpeg') RETURNING id`,
		alice).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	paid := seedMessage(t, pool, srcChat, alice, 1)
	if _, err := pool.Exec(ctx, `UPDATE messages SET media_id=$1 WHERE id=$2`, mediaID, paid); err != nil {
		t.Fatal(err)
	}
	repo := NewPaidMediaRepo(pool)
	if err := repo.SetPrice(ctx, paid, 30, 0); err != nil {
		t.Fatal(err)
	}
	schedule := func(params string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`DELETE FROM scheduled_messages WHERE sender_id=$1`, bob); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, media_id, params, send_at) VALUES ($1,$2,'photo','',$3,$4::jsonb, now() + interval '1 day')`,
			dstChat, bob, mediaID, params); err != nil {
			t.Fatal(err)
		}
	}
	access := NewMediaAccessRepo(pool)
	can := func() bool {
		t.Helper()
		ok, err := access.CanAccess(ctx, bob, mediaID)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}

	// бесплатная отложенная пересылка — открыта, хотя файл платный в чужом чате
	schedule(`{"fwd":{"src_msg_id":1}}`)
	if !can() {
		t.Fatal("бесплатная отложенная пересылка заперта чужим платным")
	}

	offer := fmt.Sprintf(`{"fwd":{"src_msg_id":%d,"offer_id":%d,"offer_price":30}}`, paid, paid)
	schedule(offer)
	if can() {
		t.Fatal("отложенная пересылка платного открыла байты без покупки")
	}
	if _, err := repo.Unlock(ctx, paid, bob); err != nil {
		t.Fatal(err)
	}
	if !can() {
		t.Fatal("купивший не качает своё отложенное")
	}
	// исходник удалён: продавца нет, разблокировки ушли каскадом — заперто
	if _, err := pool.Exec(ctx, `DELETE FROM messages WHERE id=$1`, paid); err != nil {
		t.Fatal(err)
	}
	if can() {
		t.Fatal("удаление исходника открыло отложенную пересылку платного")
	}
}

// Исходник предложения удалён мягко (deleted_at): строка жива, продавец и
// разблокировки на месте — копия открыта купившему и заперта не купившему.
func TestPaidMedia_SoftDeletedSourceKeepsOffer(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+79990000261")
	bob := seedUser(t, pool, "+79990000262")
	carol := seedUser(t, pool, "+79990000263")
	dave := seedUser(t, pool, "+79990000264")
	srcChat := seedPrivateChat(t, pool, alice, carol)
	copyChat := seedPrivateChat(t, pool, bob, dave)
	var mediaID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','soft-src','image/jpeg') RETURNING id`,
		alice).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	orig := seedMessage(t, pool, srcChat, alice, 1)
	cp := seedMessage(t, pool, copyChat, bob, 1)
	if _, err := pool.Exec(ctx, `UPDATE messages SET media_id=$1 WHERE id = ANY($2)`, mediaID, []int64{orig, cp}); err != nil {
		t.Fatal(err)
	}
	repo := NewPaidMediaRepo(pool)
	if err := repo.SetPrice(ctx, orig, 30, 0); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetPrice(ctx, cp, 30, orig); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Unlock(ctx, orig, bob); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE messages SET deleted_at=now() WHERE id=$1`, orig); err != nil {
		t.Fatal(err)
	}
	access := NewMediaAccessRepo(pool)
	if ok, err := access.CanAccess(ctx, bob, mediaID); err != nil || !ok {
		t.Fatalf("купивший не качает копию мягко удалённого исходника: ok=%v err=%v", ok, err)
	}
	if ok, err := access.CanAccess(ctx, dave, mediaID); err != nil || ok {
		t.Fatalf("не купивший качает копию мягко удалённого исходника: ok=%v err=%v", ok, err)
	}
}
