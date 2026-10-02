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
		prefix + "emoji_status, " + prefix + "deleted_at IS NOT NULL, " + prefix + "is_service"
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
	isService    bool
}

func (s *userRealScan) dest() []any {
	return []any{&s.id, &s.firstName, &s.lastName, &s.username, &s.photoID, &s.photoPreview,
		&s.isBot, &s.isVerified, &s.isPremium, &s.emojiStatus, &s.deleted, &s.isService}
}

// user собирает конструктор из просканированной строки. showPhoto=false —
// правило приватности не пускает зрителя к аватарке.
func (s *userRealScan) user(showPhoto bool) domain.UserReal {
	rec := domain.UserRecord{
		ID: s.id, FirstName: s.firstName, LastName: s.lastName,
		Username: s.username, PhotoID: s.photoID, PhotoPreview: s.photoPreview,
		IsBot: s.isBot, IsVerified: s.isVerified, IsPremium: s.isPremium,
		IsService: s.isService, Deleted: s.deleted, EmojiStatus: s.emojiStatus,
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

// userSeenCols — userRealCols плюс то, что книга ЗРИТЕЛЯ говорит об этом
// пользователе: имя, под которым зритель его сохранил (NULL — не в книге), и
// есть ли зритель в книге самого пользователя. Выборка ДЛЯ ЗРИТЕЛЯ идёт только
// через эти колонки и userSeenScan — тогда карточка проходит
// domain.UserReal.SeenBy на любом пути (диалоги, история, участники, поиск,
// книга, чёрный список, реакции, истории), и в кэш клиента не попадает
// профильное имя контакта.
//
// viewer — SQL-выражение с id зрителя (`$1`, `c.owner_id`). Подзапросы, а не
// JOIN: колонки встают в любой запрос без правки его FROM, а поиск по
// первичному ключу contacts (owner_id, user_id) дешёв.
func userSeenCols(prefix, viewer string) string {
	return userRealCols(prefix) + ", " + contactViewCols(prefix+"id", viewer)
}

// contactViewCols — сами колонки книги зрителя для пользователя с id userID
// (SQL-выражение). Отдельно от userSeenCols для выборок, где колонки users
// перечислены своим списком (собеседник списка диалогов).
func contactViewCols(userID, viewer string) string {
	return "(SELECT ARRAY[vc.first_name, vc.last_name] FROM contacts vc" +
		" WHERE vc.owner_id = " + viewer + " AND vc.user_id = " + userID + ")" +
		", EXISTS(SELECT 1 FROM contacts vm WHERE vm.owner_id = " + userID + " AND vm.user_id = " + viewer + ")"
}

// userSeenScan — приёмники под userSeenCols.
type userSeenScan struct {
	userRealScan
	contactName []string // nil — пира нет в книге зрителя
	mutual      bool
}

func (s *userSeenScan) dest() []any {
	return append(s.userRealScan.dest(), &s.contactName, &s.mutual)
}

func (s *userSeenScan) view() domain.ContactView {
	v := domain.ContactView{Mutual: s.mutual}
	if len(s.contactName) == 2 {
		v.Contact, v.FirstName, v.LastName = true, s.contactName[0], s.contactName[1]
	}
	return v
}

// user — карточка глазами зрителя. showPhoto — как у userRealScan.user.
func (s *userSeenScan) user(showPhoto bool) domain.UserReal {
	return s.userRealScan.user(showPhoto).SeenBy(s.view())
}

// scanUserSeen читает одну строку, выбранную userSeenCols.
func scanUserSeen(row pgx.Row) (domain.UserReal, error) {
	var s userSeenScan
	if err := row.Scan(s.dest()...); err != nil {
		return domain.UserReal{}, err
	}
	return s.user(true), nil
}
