package domain

// ChatAccess — что зритель может с чатом, одним снимком: вид чата, публичность,
// членство с ролью и бан. Из него выводится ЕДИНСТВЕННЫЙ ответ на вопрос
// «пускать ли на чтение» (CanRead); проверок членства по местам больше нет.
type ChatAccess struct {
	Type   string // ChatTypeGroup | ChatTypeChannel | private | saved | secret
	Public bool   // chats.is_public
	Member bool   // есть строка chat_members
	Role   string // chat_members.role; "" — не участник
	Banned bool   // есть строка chat_bans
}

// CanRead — чат читается зрителем: он участник либо чат публичный, и он не
// забанен. Так отвечает Telegram: приватный канал или группа, где зритель не
// состоит, — CHANNEL_PRIVATE на любое чтение (история, сообщения по номерам,
// обсуждение, карточка, просмотры), публичный читается и без вступления
// (превью с кнопкой «Вступить», tweb input.ts:2650-2672), а забаненному
// закрыт и публичный.
func (a ChatAccess) CanRead() bool { return (a.Member || a.Public) && !a.Banned }

// IsAdmin — владелец или админ чата.
func (a ChatAccess) IsAdmin() bool {
	return a.Member && (a.Role == RoleCreator || a.Role == RoleAdmin)
}
