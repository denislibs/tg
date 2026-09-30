package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Служебный аккаунт Telegram (777000) приходит клиенту ТЕМИ ЖЕ флагами на
// любом пути карточки. Клиент tweb отличает его от человека по
// `pFlags.support` (getUserStatusString.ts:34-37, appImManager.ts:3725,
// appUsersManager.ts:903/:1028), а флаг был только в колонке `is_service` —
// ни один скан его не читал, и на проводе 777000 был обычным человеком.
//
// Пути разные потому, что колонки у них выписаны РАЗНЫМИ списками: общий
// userRealCols (батч `GET /users?ids=`, поиск, контакты…), ручной LATERAL
// списка диалогов, userCols авторизации и свой список PrivacyRepo.GetUser
// (профиль `GET /users/{id}`). Флаг, потерянный на одном из них, мигал бы на
// клиенте: карточка пира пере-кладывается каждым ответом.
func TestServiceAccount_SupportFlagOnEveryCardPath(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	viewer := seedUser(t, pool, "+79990001111")

	check := func(path string, u domain.UserReal) {
		t.Helper()
		if u.ID != domain.ServiceUserID {
			t.Fatalf("%s: id = %d; want %d", path, u.ID, domain.ServiceUserID)
		}
		if !u.Support() {
			t.Errorf("%s: pFlags.support потерян у 777000", path)
		}
		if !u.Verified() {
			t.Errorf("%s: pFlags.verified потерян у 777000", path)
		}
	}

	// userRealCols — батч карточек.
	users, err := NewGroupRepo(pool).UsersByIDs(ctx, []int64{domain.ServiceUserID})
	if err != nil || len(users) != 1 {
		t.Fatalf("UsersByIDs = %v, %v", users, err)
	}
	check("UsersByIDs", users[0])

	// userCols — полная строка авторизации.
	rec, err := NewAuthRepo(pool).GetByID(ctx, domain.ServiceUserID)
	if err != nil {
		t.Fatalf("AuthRepo.GetByID: %v", err)
	}
	check("AuthRepo.GetByID", rec.ToUser(domain.UserFlags{}, nil, true))
	// Номер — настоящий номер 777000 (миграция 0133): строка «Phone» профиля
	// оригинала показывает «+42 777», а не заглушку безномерного аккаунта.
	if rec.Phone != "+42777" {
		t.Errorf("phone 777000 = %q; want +42777", rec.Phone)
	}

	// Свой список колонок профиля.
	prec, err := NewPrivacyRepo(pool).GetUser(ctx, domain.ServiceUserID)
	if err != nil {
		t.Fatalf("PrivacyRepo.GetUser: %v", err)
	}
	check("PrivacyRepo.GetUser", prec.ToUser(domain.UserFlags{}, nil, true))

	// LATERAL собеседника в списке диалогов.
	createPrivate(t, pool, viewer, domain.ServiceUserID)
	dialogs, err := NewChatsRepo(pool).ListDialogs(ctx, viewer)
	if err != nil || len(dialogs) != 1 || dialogs[0].Peer == nil {
		t.Fatalf("ListDialogs = %+v, %v", dialogs, err)
	}
	check("ListDialogs", *dialogs[0].Peer)

	// Обычный человек флага не получает — предикат не «любой собеседник».
	human, err := NewGroupRepo(pool).UsersByIDs(ctx, []int64{viewer})
	if err != nil || len(human) != 1 {
		t.Fatalf("UsersByIDs(viewer) = %v, %v", human, err)
	}
	if human[0].Support() {
		t.Error("pFlags.support у обычного пользователя")
	}
}

// Счётчик истории — то, что видит ЗРИТЕЛЬ, а не все строки чата: шапка
// «Избранного» показывает его как «N messages» (tweb topbar.ts
// `messagesCounter`). Скрытое «у себя» и очищенное до горизонта в него не
// входит — ровно как не входит в окно GetHistory.
func TestMessagesRepo_CountMessagesIsViewerVisible(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990002221")
	b := seedUser(t, pool, "+79990002222")
	chatID := createPrivate(t, pool, a, b)

	var ids []int64
	for i := 0; i < 4; i++ {
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatal(err)
		}
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "m"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	// a скрыл у себя последнее и очистил историю до seq 1.
	if err := msgs.HideForUser(ctx, a, ids[3]); err != nil {
		t.Fatal(err)
	}
	if n, err := msgs.CountMessages(ctx, chatID, a, 1); err != nil || n != 2 {
		t.Fatalf("CountMessages(a, cleared=1) = %d, %v; want 2", n, err)
	}
	// У b ничего не скрыто и не очищено.
	if n, err := msgs.CountMessages(ctx, chatID, b, 0); err != nil || n != 4 {
		t.Fatalf("CountMessages(b) = %d, %v; want 4", n, err)
	}
}
