package privacy

import (
	"context"
	"testing"
	"time"

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

func (profileRepo) PeerFullState(_ context.Context, viewerID, targetID int64) (domain.PeerFullState, error) {
	st := domain.PeerFullState{CommonChats: 2, PinnedMsgID: 5, StarGifts: 3}
	if viewerID != targetID {
		ns := domain.NewPeerNotifySettings(time.Time{}, nil, nil)
		st.NotifySettings = &ns
	}
	return st, nil
}

// A4-19: userFull несёт общие чаты, закреп лички, подарки и уведомления.
func TestProfile_PeerFullState(t *testing.T) {
	in := New(profileRepo{})
	full, err := in.Profile(context.Background(), 7, 8)
	if err != nil {
		t.Fatal(err)
	}
	f := full.FullUser
	if f.CommonChatsCount != 2 || f.PinnedMsgID != 5 || f.StargiftsCount != 3 || f.NotifySettings == nil {
		t.Fatalf("userFull = %+v, want common_chats_count/pinned_msg_id/stargifts_count/notify_settings", f)
	}
}

// botProfileRepo — как profileRepo, но пользователь 42 — бот.
type botProfileRepo struct{ profileRepo }

func (botProfileRepo) GetUser(_ context.Context, id int64) (domain.UserRecord, error) {
	return domain.UserRecord{ID: id, IsBot: id == 42, Bio: "био"}, nil
}

type fakeBotInfo struct {
	calls int
}

func (f *fakeBotInfo) BotInfo(_ context.Context, botID, viewerID int64) (*domain.BotInfo, string, error) {
	f.calls++
	info := domain.NewBotInfo(botID, "Что умеет бот", []domain.BotCommand{{Command: "start", Description: "начать"}})
	return &info, "О боте", nil
}

// Профиль бота несёт userFull.bot_info (описание и команды) и about бота;
// профиль человека — ничего лишнего и не зовёт источник.
func TestProfile_BotInfoOfBot(t *testing.T) {
	src := &fakeBotInfo{}
	in := New(botProfileRepo{})
	in.SetBotInfo(src)
	ctx := context.Background()

	bot, err := in.Profile(ctx, 7, 42)
	if err != nil {
		t.Fatal(err)
	}
	bi := bot.FullUser.BotInfo
	if bi == nil || bi.UserID != 42 || bi.Description != "Что умеет бот" || len(bi.Commands) != 1 || bi.Commands[0].Command != "start" {
		t.Fatalf("bot_info = %+v", bi)
	}
	if bot.FullUser.About != "О боте" {
		t.Fatalf("about бота = %q; want \"О боте\" (BotAccount.About), не био пользователя", bot.FullUser.About)
	}

	human, err := in.Profile(ctx, 7, 8)
	if err != nil {
		t.Fatal(err)
	}
	if human.FullUser.BotInfo != nil || src.calls != 1 {
		t.Fatalf("у человека bot_info=%+v, обращений к источнику %d", human.FullUser.BotInfo, src.calls)
	}
}
