package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// f6-geo: «стоп» трансляции необратим на уровне строки (тик без stopped не
// стирает флаг, иначе запоздавший тик воскрешает остановленную трансляцию), а
// удалённое сообщение координат не принимает.
func TestMessagesRepo_UpdateGeoLive_StopSticky_DeletedGuard(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7972")
	b := seedUser(t, pool, "+7973")
	chatID := createPrivate(t, pool, a, b)

	lat, lng, period := 10.0, 20.0, 900
	seq, _ := msgs.NextSeq(ctx, chatID)
	ins, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "geo",
		GeoLat: &lat, GeoLng: &lng, GeoLivePeriod: &period})
	if err != nil {
		t.Fatal(err)
	}

	m, err := msgs.UpdateGeoLive(ctx, ins.ID, 11, 21, nil, false)
	if err != nil || m.GeoLiveStopped || *m.GeoLat != 11 {
		t.Fatalf("тик: %+v, %v", m, err)
	}
	if m, err = msgs.UpdateGeoLive(ctx, ins.ID, 12, 22, nil, true); err != nil || !m.GeoLiveStopped {
		t.Fatalf("стоп: %+v, %v", m, err)
	}
	if m, err = msgs.UpdateGeoLive(ctx, ins.ID, 13, 23, nil, false); err != nil || !m.GeoLiveStopped {
		t.Fatalf("запоздавший тик снял остановку: %+v, %v", m, err)
	}

	if _, err := msgs.SoftDelete(ctx, ins.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := msgs.UpdateGeoLive(ctx, ins.ID, 14, 24, nil, false); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("тик по удалённому: %v, want ErrNotFound", err)
	}
}
