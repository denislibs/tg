package http

import (
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Конвертер границы Bot API. Проверяется дефект 4 разбора: вид чата прибивался
// к "private" независимо от настоящего — бот в группе получал апдейт, где его
// же группа объявлена приватным чатом.
func TestBotAPIView_ChatTypeIsNotHardcoded(t *testing.T) {
	v := botAPIView{}
	for _, c := range []struct {
		ours string
		want string
	}{
		{domain.ChatTypePrivate, "private"},
		// Наша группа это супергруппа (решение №2: username, форумы и slowmode
		// в схеме есть только у channel).
		{domain.ChatTypeGroup, "supergroup"},
		{domain.ChatTypeChannel, "channel"},
		// Неизвестный вид деградирует в самое узкое, а не в самое широкое.
		{"неизвестно", "private"},
	} {
		got := v.Chat(7, c.ours, "Команда")
		if got["type"] != c.want {
			t.Errorf("chat type для %q = %v; want %q", c.ours, got["type"], c.want)
		}
		if got["id"] != int64(7) || got["title"] != "Команда" {
			t.Errorf("chat = %v", got)
		}
	}
	// Без заголовка ключа нет вовсе (у приватного чата его и не бывает).
	if _, ok := v.Chat(7, domain.ChatTypePrivate, "")["title"]; ok {
		t.Error("пустой title уехал ключом")
	}
}

// Пользователь на границе Bot API — first_name/last_name, никакого
// display_name: его нет ни у нас на проводе, ни в чужой документации.
func TestBotAPIView_User(t *testing.T) {
	u := domain.NewUser(42, domain.UserFlags{Bot: true})
	u.FirstName, u.LastName, u.Username = "Демо", "Бот", "demo_bot"
	got := botAPIView{}.User(u)
	if got["id"] != int64(42) || got["is_bot"] != true ||
		got["first_name"] != "Демо" || got["last_name"] != "Бот" || got["username"] != "demo_bot" {
		t.Fatalf("from = %v", got)
	}
	if _, ok := got["display_name"]; ok {
		t.Error("display_name уехал в Bot API")
	}
	// Пустые фамилия и username ключами не едут.
	plain := botAPIView{}.User(domain.NewUser(43, domain.UserFlags{}))
	if _, ok := plain["last_name"]; ok {
		t.Error("пустая фамилия уехала ключом")
	}
	if _, ok := plain["username"]; ok {
		t.Error("пустой username уехал ключом")
	}
}
