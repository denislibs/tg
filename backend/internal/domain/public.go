package domain

// PublicProfile — публичная карточка по username для страницы-превью
// (аналог t.me/username): пользователь или группа/канал с публичным именем.
type PublicProfile struct {
	Kind          string // 'user' | 'group' | 'channel'
	Title         string
	Username      string
	About         string // bio пользователя / описание чата
	AvatarMediaID int64  // 0 — нет фото
	MemberCount   int    // только для групп/каналов
	Verified      bool
}
