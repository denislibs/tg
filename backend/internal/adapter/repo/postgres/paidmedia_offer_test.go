package postgres

import (
	"context"
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
