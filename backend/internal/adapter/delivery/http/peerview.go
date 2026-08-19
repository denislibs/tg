package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// Витрина пиров: общие куски для всех ручек, отдающих пользователей и чаты
// конструкторами схемы (`user`, `channel`).
//
// Здесь же живёт единственный способ погасить аватарку по правилу приватности.
// Раньше каждая ручка гасила по-своему — где-то обнуляла avatar_url, где-то
// забывала обнулить рядом лежащее avatar_preview (и превью выдавало скрытое
// фото). Теперь «фото не показываем» выражается ОДНИМ способом: конструктор
// userProfilePhotoEmpty, то есть «фото нет» как состояние.

// gatePhotos гасит аватарки тех пользователей списка, которым правило
// profile_photo не пускает зрителя. Правит срез на месте.
//
// Проверяющий необязателен: без него фото видно всем — та же мягкая
// деградация, что у остальных опциональных зависимостей, и то же прежнее
// поведение. Сам зритель видит своё фото всегда.
func gatePhotos(r *http.Request, privacy PrivacyQuery, users []domain.UserReal) {
	if privacy == nil || len(users) == 0 {
		return
	}
	viewer, _ := UserFromContext(r.Context())
	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	allowed, err := privacy.VisibleMap(r.Context(), viewer.ID, ids, domain.PrivacyProfilePhoto)
	if err != nil {
		return
	}
	for i := range users {
		if users[i].ID == viewer.ID || allowed[users[i].ID] {
			continue
		}
		users[i].Photo = domain.NewUserProfilePhotoEmpty()
	}
}

// channelsOf — краткие конструкторы `channel` для списка строк chats.
func channelsOf(records []domain.ChatRecord) []domain.Chat {
	out := make([]domain.Chat, 0, len(records))
	for _, c := range records {
		out = append(out, c.ToChannel())
	}
	return out
}
