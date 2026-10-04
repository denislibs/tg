package privacy

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// profileRepo — ровно то, что зовёт Profile; остальное Repo не нужно.
type profileRepo struct{ Repo }

func (profileRepo) GetUser(_ context.Context, id int64) (domain.UserRecord, error) {
	return domain.UserRecord{ID: id}, nil
}
func (profileRepo) IsBlocked(context.Context, int64, int64) (bool, error) { return false, nil }
func (profileRepo) TTLPeriod(context.Context, int64, int64) (int, error)  { return 0, nil }
func (profileRepo) ChatTheme(context.Context, int64, int64) (string, error) {
	return "", nil
}
func (profileRepo) Get(context.Context, int64, domain.PrivacyKey) (domain.PrivacyRuleRecord, error) {
	return domain.PrivacyRuleRecord{}, domain.ErrNotFound
}
func (profileRepo) IsContact(context.Context, int64, int64) (bool, error) { return true, nil }
func (profileRepo) ContactCard(context.Context, int64, int64) (domain.ContactCard, error) {
	return domain.ContactCard{}, nil
}

// Самому себе не звонят: у своей карточки флагов звонка нет (у оригинала
// кнопки звонка в «Избранном» нет — tweb topbar.ts verifyCallButton :409-415
// решает только по phone_calls_available/video_calls_available). Чужому —
// по правилу PrivacyCalls.
func TestProfile_CallsUnavailableForSelf(t *testing.T) {
	i := New(profileRepo{})
	ctx := context.Background()

	self, err := i.Profile(ctx, 7, 7)
	if err != nil {
		t.Fatal(err)
	}
	if self.FullUser.PhoneCallsAvailable() || self.FullUser.VideoCallsAvailable() {
		t.Fatalf("своя карточка со звонком: %+v", self.FullUser.PFlags)
	}

	other, err := i.Profile(ctx, 8, 7)
	if err != nil {
		t.Fatal(err)
	}
	if !other.FullUser.PhoneCallsAvailable() || !other.FullUser.VideoCallsAvailable() {
		t.Fatalf("чужая карточка без звонка: %+v", other.FullUser.PFlags)
	}
}
