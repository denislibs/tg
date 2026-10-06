package privacy

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type mapsRepo struct {
	Repo
	maps, single int
}

func (r *mapsRepo) VisibleMaps(_ context.Context, _ int64, ids []int64, keys ...domain.PrivacyKey) (map[domain.PrivacyKey]map[int64]bool, error) {
	r.maps++
	out := map[domain.PrivacyKey]map[int64]bool{}
	for _, k := range keys {
		out[k] = map[int64]bool{}
		for _, id := range ids {
			out[k][id] = true
		}
	}
	return out, nil
}

func (r *mapsRepo) VisibleMap(context.Context, int64, []int64, domain.PrivacyKey) (map[int64]bool, error) {
	r.single++
	return map[int64]bool{}, nil
}

type countingPresence struct{ single, batch int }

func (p *countingPresence) Status(context.Context, int64) (bool, time.Time, time.Time) {
	p.single++
	return false, time.Time{}, time.Time{}
}

func (p *countingPresence) Statuses(_ context.Context, ids []int64) map[int64]domain.UserStatus {
	p.batch++
	out := map[int64]domain.UserStatus{}
	for _, id := range ids {
		out[id] = domain.NewUserStatusOnline(time.Now().Add(time.Minute))
	}
	return out
}

// Ревью #405, №5: ViewUsers доводит пачку карточек одним запросом правил и
// одним обращением к присутствию, а не по пользователю (N+1 к Redis).
func TestViewUsers_Batched(t *testing.T) {
	repo := &mapsRepo{}
	pres := &countingPresence{}
	in := New(repo)
	in.SetPresence(pres)
	users := []domain.UserReal{domain.NewUser(2, domain.UserFlags{}), domain.NewUser(3, domain.UserFlags{}), domain.NewUser(4, domain.UserFlags{})}
	in.ViewUsers(context.Background(), 1, users)
	if repo.maps != 1 || repo.single != 0 || pres.batch != 1 || pres.single != 0 {
		t.Fatalf("правила: maps=%d single=%d; присутствие: batch=%d single=%d", repo.maps, repo.single, pres.batch, pres.single)
	}
	if users[0].Status == nil || users[0].Status.Tag() != domain.UserStatusOnlineTag {
		t.Fatalf("статус = %v", users[0].Status)
	}
}
