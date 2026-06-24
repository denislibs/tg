package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestChannelRepo_AppendAndSince(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7100")
	g := NewGroupRepo(pool)
	chID, _ := g.CreateMultiMember(ctx, "channel", "News", "", "", true, u)
	r := NewChannelRepo(pool)

	p1, err := r.AppendUpdate(ctx, chID, json.RawMessage(`{"msg_id":1}`))
	if err != nil || p1 != 1 {
		t.Fatalf("append1: pts=%d err=%v", p1, err)
	}
	p2, _ := r.AppendUpdate(ctx, chID, json.RawMessage(`{"msg_id":2}`))
	if p2 != 2 {
		t.Fatalf("append2 pts=%d", p2)
	}

	cur, _ := r.CurrentPts(ctx, chID)
	if cur != 2 {
		t.Fatalf("current pts=%d", cur)
	}

	ups, err := r.UpdatesSince(ctx, chID, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 1 || ups[0].Pts != 2 {
		t.Fatalf("since(1)=%+v", ups)
	}
	_ = domain.ChannelUpdate{}
}
