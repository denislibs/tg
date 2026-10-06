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
	if locked, err := repo.LockedMedia(ctx, bob, mediaID); err != nil || !locked {
		t.Fatalf("автор копии скачивает без покупки: locked=%v err=%v", locked, err)
	}
	if _, err := repo.Unlock(ctx, orig, bob); err != nil {
		t.Fatal(err)
	}
	if locked, err := repo.LockedMedia(ctx, bob, mediaID); err != nil || locked {
		t.Fatalf("купивший исходник: locked=%v err=%v", locked, err)
	}
}
