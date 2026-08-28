package postgres

import (
	"github.com/jackc/pgx/v5"

	"github.com/messenger-denis/backend/internal/domain"
)

// Чтение пира в форме КОНСТРУКТОРА `user` — один список колонок и один
// сканер на все репозитории, которые отдают карточку пользователя (участники,
// авторы историй, реагировавшие, контакты, чёрный список, поиск).
//
// Раньше каждый такой запрос выбирал свой набор плоских полей — где-то
// display_name с avatar_url, где-то ещё и phone, — и наборы разъезжались:
// `verified` терялся в батче `GET /users?ids=` (дефект 5 разбора), а
// UserCard.Phone репозиторий заполнял, но витрина не сериализовала (дефект 7).
// С единым списком колонок такое расхождение выражается только одним способом
// — правкой ЭТОГО файла.

// userRealCols — колонки users для scanUserReal, в порядке сканирования.
// Префикс задаётся вызывающим (`u.`), потому что запросы почти всегда с JOIN.
func userRealCols(prefix string) string {
	return prefix + "id, " + prefix + "first_name, " + prefix + "last_name, " +
		prefix + "username, " + prefix + "avatar_media_id, " + prefix + "avatar_preview, " +
		prefix + "is_bot, " + prefix + "is_verified, " + prefix + "is_premium, " +
		prefix + "emoji_status, " + prefix + "deleted_at IS NOT NULL"
}

// userRealScan — приёмники под userRealCols. Промежуточная структура нужна
// потому, что конструктор собирается ПОСЛЕ скана: флаги живут в pFlags, а
// «фото нет» — это отдельный конструктор, а не пустое значение колонки.
type userRealScan struct {
	id           int64
	firstName    string
	lastName     string
	username     *string
	photoID      *int64
	photoPreview []byte
	isBot        bool
	isVerified   bool
	isPremium    bool
	emojiStatus  string
	deleted      bool
}

func (s *userRealScan) dest() []any {
	return []any{&s.id, &s.firstName, &s.lastName, &s.username, &s.photoID, &s.photoPreview,
		&s.isBot, &s.isVerified, &s.isPremium, &s.emojiStatus, &s.deleted}
}

// user собирает конструктор из просканированной строки. showPhoto=false —
// правило приватности не пускает зрителя к аватарке.
func (s *userRealScan) user(showPhoto bool) domain.UserReal {
	rec := domain.UserRecord{
		ID: s.id, FirstName: s.firstName, LastName: s.lastName,
		Username: s.username, PhotoID: s.photoID, PhotoPreview: s.photoPreview,
		IsBot: s.isBot, IsVerified: s.isVerified, IsPremium: s.isPremium,
		Deleted: s.deleted, EmojiStatus: s.emojiStatus,
	}
	return rec.ToUser(domain.UserFlags{}, nil, showPhoto)
}

// scanUserReal читает одну строку, выбранную userRealCols. Аватарка едет как
// есть — фильтр приватности накладывает витрина, у которой есть зритель.
func scanUserReal(row pgx.Row) (domain.UserReal, error) {
	var s userRealScan
	if err := row.Scan(s.dest()...); err != nil {
		return domain.UserReal{}, err
	}
	return s.user(true), nil
}
