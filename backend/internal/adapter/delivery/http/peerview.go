package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// Витрина пиров: общие куски для всех ручек, отдающих пользователей и чаты
// конструкторами схемы (`user`, `channel`).
//
// Здесь же живёт вход в единственный сборщик карточки `user` глазами зрителя
// (viewUsers): «фото не показываем» выражается ОДНИМ способом — конструктор
// userProfilePhotoEmpty, — номер и статус тоже решает правило приватности.

// viewUsers доводит карточки `user` до вида глазами зрителя — тем же
// сборщиком, что у usecase (privacy.ViewUsers → domain.UserViewRules): фото,
// номер и статус по правилам приватности. Правит срез на месте.
//
// Проверяющий необязателен: без него — domain.UncheckedUserViewRules.
func viewUsers(r *http.Request, privacy PrivacyQuery, users []domain.UserReal) {
	if len(users) == 0 {
		return
	}
	viewer, _ := UserFromContext(r.Context())
	if privacy == nil {
		domain.UncheckedUserViewRules(viewer.ID, users).Apply(users)
		return
	}
	privacy.ViewUsers(r.Context(), viewer.ID, users)
}

// channelsOf — краткие конструкторы `channel` для списка строк chats.
func channelsOf(records []domain.ChatRecord) []domain.Chat {
	out := make([]domain.Chat, 0, len(records))
	for _, c := range records {
		out = append(out, c.ToChannel())
	}
	return out
}
