package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Публичные имена пользователей и чатов — одно пространство (Telegram,
// миграция 0134): его держат и проверки, и ВСЕ пути записи, включая
// создание чата с именем и имя бота.
func TestUsernameNamespace_SharedBetweenUsersAndChats(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	uid := seedUser(t, pool, "+7101")
	auth := NewAuthRepo(pool)
	groups := NewGroupRepo(pool)
	bots := NewBotAPIRepo(pool)

	name := "shared_name"
	if _, err := auth.SetUsername(ctx, uid, &name); err != nil {
		t.Fatal(err)
	}
	if _, err := groups.CreateMultiMember(ctx, "channel", "C", "", "Shared_Name", true, uid); !isUniqueViolation(err) {
		t.Fatalf("чат создан с именем пользователя: err = %v; want unique_violation", err)
	}

	chatID, err := groups.CreateMultiMember(ctx, "channel", "C", "", "chat_name", true, uid)
	if err != nil {
		t.Fatal(err)
	}
	if taken, err := bots.UsernameTaken(ctx, "CHAT_NAME"); err != nil || !taken {
		t.Fatalf("имя чата свободно для бота: taken=%v err=%v", taken, err)
	}
	if free, err := auth.UsernameAvailable(ctx, "chat_name", uid); err != nil || free {
		t.Fatalf("имя чата свободно для пользователя: free=%v err=%v", free, err)
	}
	chatName := "chat_name"
	if _, err := auth.SetUsername(ctx, uid, &chatName); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("имя чата сохранилось пользователю: err = %v; want ErrConflict", err)
	}
	if free, err := groups.UsernameAvailable(ctx, "chat_name", chatID); err != nil || !free {
		t.Fatalf("своё имя чата занято: free=%v err=%v", free, err)
	}
	if free, err := groups.UsernameAvailable(ctx, "shared_name", chatID); err != nil || free {
		t.Fatalf("имя пользователя свободно для чата: free=%v err=%v", free, err)
	}
	if err := groups.EditInfo(ctx, chatID, "C", "", "shared_name"); !isUniqueViolation(err) {
		t.Fatalf("EditInfo отдал чату имя пользователя: err = %v; want unique_violation", err)
	}
}
