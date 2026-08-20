package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

// Кэш маршалит доменную структуру БЕЗ json-тегов — ключи это имена полей Go, и
// круг «записали → прочитали» здесь не формальность: внутри строки лежит
// ОБЪЕДИНЕНИЕ (notify_settings.other_sound), которое обычным json.Unmarshal в
// интерфейс не читается вовсе. Молчаливая потеря звука выглядела бы как
// «настройка не сохранилась», а не как ошибка.
func TestDialogsCache_RoundTrip(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	c := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer c.Close()
	cache := NewDialogsCache(c)
	ctx := context.Background()

	if got, ok := cache.Get(ctx, 1); ok {
		t.Fatalf("промах кэша вернул %v", got)
	}

	until := time.Unix(domain.MuteUntilForever, 0)
	previews := false
	peer := domain.NewUser(42, domain.UserFlags{Premium: true})
	want := []domain.DialogRecord{{
		ChatID:         8,
		Type:           domain.ChatTypeGroup,
		Title:          "Группа",
		NotifySettings: domain.NewPeerNotifySettings(until, &previews, domain.NewNotificationSoundNone()),
		Folder:         domain.FolderArchive,
		TopMessageID:   901,
		TopMessageSeq:  7,
		TTLPeriod:      86400,
		Peer:           &peer,
	}}
	cache.Set(ctx, 1, want)

	got, ok := cache.Get(ctx, 1)
	if !ok || len(got) != 1 {
		t.Fatalf("чтение кэша = %v, %v", got, ok)
	}
	d := got[0]
	// Номер последнего сообщения обязан пережить круг: именно он уезжает в
	// dialog.top_message, а 0 в этом пространстве значит «самое новое».
	if d.TopMessageID != 901 || d.TopMessageSeq != 7 || d.Folder != domain.FolderArchive || d.TTLPeriod != 86400 {
		t.Errorf("строка после круга = %+v", d)
	}
	if d.NotifySettings.MuteUntil == nil || *d.NotifySettings.MuteUntil != domain.MuteUntilForever {
		t.Errorf("mute_until после круга = %v; want %d", d.NotifySettings.MuteUntil, domain.MuteUntilForever)
	}
	if d.NotifySettings.ShowPreviews == nil || *d.NotifySettings.ShowPreviews {
		t.Errorf("show_previews после круга = %v; want явное false", d.NotifySettings.ShowPreviews)
	}
	if d.NotifySettings.OtherSound == nil || d.NotifySettings.OtherSound.Tag() != domain.NotificationSoundNoneTag {
		t.Errorf("other_sound после круга = %v; want notificationSoundNone", d.NotifySettings.OtherSound)
	}
	if d.Peer == nil || d.Peer.ID != 42 || !d.Peer.PFlags["premium"] {
		t.Errorf("собеседник после круга = %+v", d.Peer)
	}

	// Префикс ключа — часть контракта развёртывания: форма строки менялась на
	// шаге B диалогов и снова на шаге B сообщений (появился TopMessageSeq), и
	// старые блобы обязаны перестать НАХОДИТЬСЯ, а не прочитаться нулями
	// (см. докблок DialogsCache).
	if _, err := mr.Get("dialogs4:1"); err != nil {
		t.Errorf("ключ кэша не dialogs4: %v", mr.Keys())
	}
}
