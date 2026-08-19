package domain

import "time"

// Виды чата в НАШЕЙ таблице chats. Наружу они не выходят: на проводе вид чата
// это выбор конструктора (channel + pFlags.broadcast/megagroup — решение №2
// разбора), а приватного чата как сущности нет вовсе (решение №1).
const (
	ChatTypePrivate = "private"
	ChatTypeGroup   = "group"
	ChatTypeChannel = "channel"
	ChatTypeSaved   = "saved"
	ChatTypeSecret  = "secret"
)

// ChatBrief — строка chats в объёме, которого хватает на конструктор `channel`:
// снимок «личности отправителя» send-as и её автора в бабле.
type ChatBrief struct {
	ID           int64
	Type         string // group | channel | ...
	Title        string
	PhotoID      *int64 // chats.photo_media_id (nil — фото нет)
	PhotoPreview []byte // stripped-превью фото (media.blur_preview)
}

// ToChannel — конструктор `channel` из снимка. Вид чата выражен флагами
// broadcast/megagroup, а не строкой: решение №2 разбора.
func (b ChatBrief) ToChannel() Channel {
	return NewChannel(b.ID, b.Title, b.ChatPhoto(), time.Time{}, ChannelFlags{
		Broadcast: b.Type == ChatTypeChannel,
		Megagroup: b.Type == ChatTypeGroup,
	})
}

// ChatPhoto — объединение ChatPhoto для этого снимка: «фото нет» это
// состояние (chatPhotoEmpty), а не пустая строка URL.
func (b ChatBrief) ChatPhoto() ChatPhoto {
	if b.PhotoID == nil {
		return NewChatPhotoEmpty()
	}
	return NewChatPhoto(*b.PhotoID, b.PhotoPreview, false)
}

// SendAsPeer — доступная «личность отправителя» (Telegram channels.getSendAs):
// сам пользователь, канал (где он владелец/админ) или сама супергруппа
// (анонимный админ). Peer — ссылка на пир (peerUser | peerChannel), User/Chat —
// её тело: ровно раскладка channels.sendAsPeers{peers, chats, users}.
type SendAsPeer struct {
	Peer Peer
	User *UserReal
	Chat *Channel
}

type ChatMember struct {
	ChatID, UserID int64
	Role           string
	LastReadSeq    int64
	UnreadCount    int
	// UnreadMentionsCount — число непрочитанных сообщений, где участник упомянут
	// (Telegram unread_mentions_count); отдельный бейдж «@» поверх обычного unread.
	UnreadMentionsCount int
	Muted               bool
}

// Dialog is a chat-list read model: a chat + the viewer's read state + last message.
type Dialog struct {
	ChatID      int64
	Type        string
	Title       string
	Username    string
	LastReadSeq int64
	// PeerReadSeq is the OTHER side's read horizon (read_outbox): the peer's
	// last_read_seq for a private chat, the MIN across other members for a group
	// (read-by-all), 0 for channels. Used for outgoing sent/read ticks
	// (message seq <= PeerReadSeq ⇒ delivered+read ✓✓).
	PeerReadSeq int64
	UnreadCount int
	// UnreadMentionsCount — непрочитанные упоминания зрителя в этом чате
	// (Telegram unread_mentions_count); клиент рисует отдельный бейдж «@».
	UnreadMentionsCount int
	// UnreadReactionsCount — непрочитанные реакции на сообщения зрителя в этом
	// чате (Telegram unread_reactions_count); клиент рисует отдельный бейдж-сердце.
	UnreadReactionsCount int
	Muted                bool
	// Pinned — диалог закреплён вверху списка; Archived — убран в «Архив»
	// (пер-юзерные флаги членства, tweb pinned dialogs + folder_id=1).
	Pinned   bool
	Archived bool
	// IsForum — в группе включены темы (клиент рендерит список топиков).
	IsForum bool
	// NotifyPreview — показывать текст сообщения в уведомлении для этого чата
	// (per-chat override; по умолчанию true). NotifySound — 'default'|'none'
	// (per-chat: 'none' — беззвучное уведомление без полного mute). Резолвятся из
	// chat_members.notify_preview/notify_sound (NULL → дефолт), как tweb
	// getPeerLocalSettings (per-peer поле поверх типа).
	NotifyPreview bool
	NotifySound   string
	HasLast       bool
	LastSeq       int64
	LastText      string
	LastSenderID  int64
	LastAt        time.Time
	// LastMediaID/LastType describe the last message's media for the sidebar
	// preview thumbnail + type label (0/"" when it's a plain text message).
	LastMediaID int64
	LastType    string
	// LastForwarded is true when the last message was forwarded (shows a forward
	// arrow before the chat-list preview, like Telegram).
	LastForwarded bool
	// LastSenderName is the last message sender's short name (first name, else
	// display name) — for the "Имя: …" preview prefix in group chats.
	LastSenderName string
	// LastEncBody — шифр-блоб последнего сообщения секретного чата (nil у обычных).
	// Сервер plaintext не знает; клиент расшифровывает его ключом из IndexedDB для
	// превью в списке (как tweb показывает расшифрованный текст).
	LastEncBody []byte
	// PhotoID/PhotoPreview — фото группы/канала (chats.photo_media_id и
	// media.blur_preview по нему); nil — фото нет. У приватного чата аватарка
	// едет на самом пире (Peer.Photo), как в оригинале.
	PhotoID      *int64
	PhotoPreview []byte
	// Peer — собеседник приватного чата в форме конструктора `user` (nil у
	// групп и каналов). Прежний плоский DialogPeer с display_name/avatar_url
	// исчез: имя собирает клиент, аватарка адресуется id медиа.
	Peer *UserReal
	// AutoDeletePeriod — период автоудаления сообщений чата в секундах (0 — выкл).
	AutoDeletePeriod int
	// ThemeID — id выбранной темы оформления чата (пресет на клиенте); ""
	// означает «тема не задана» (дефолтное оформление). Применяется к обоим
	// участникам (Telegram messages.setChatTheme).
	ThemeID string
}

// ChatPhoto — фото группы/канала как объединение схемы; «фото нет» это
// состояние (chatPhotoEmpty), а не пустая строка URL.
func (d Dialog) ChatPhoto() ChatPhoto {
	if d.PhotoID == nil {
		return NewChatPhotoEmpty()
	}
	return NewChatPhoto(*d.PhotoID, d.PhotoPreview, false)
}

// DialogFolder — РЕАЛЬНАЯ папка выборки диалогов. Порт tweb REAL_FOLDER_ID
// (lib/appManagers/constants.ts:37-39): на сервере существуют ровно две папки,
// «все чаты» и «архив»; пользовательские папки — клиентский фильтр поверх них
// и до бэкенда не доходят.
type DialogFolder int

const (
	// FolderGlobal — запрос без папки: весь набор. Нулевое значение выбрано
	// сознательно — уже существующие domain.DialogPage{} без явного поля
	// обязаны означать «как раньше», а не «всё, кроме архива». Порт tweb
	// GLOBAL_FOLDER_ID (dialogs.ts:68).
	FolderGlobal DialogFolder = iota
	// FolderAll — всё, кроме архива (на проводе folder_id=0, tweb FOLDER_ID_ALL).
	FolderAll
	// FolderArchive — только архив (на проводе folder_id=1, tweb FOLDER_ID_ARCHIVE).
	FolderArchive
)

// DialogPage — запрос страницы списка диалогов.
//
// Курсор — chat_id последнего полученного диалога, а не смещение: список
// переупорядочивается между запросами (новое сообщение поднимает чат наверх),
// и позиционный offset дал бы пропуски и дубли. Порядок задаёт ChatsRepo.
// ListDialogs (pinned_at, last message date, chat_id) и он строго тотальный.
type DialogPage struct {
	// 0 — без пагинации: весь список. Отрицательный Limit sliceDialogPage
	// трактует так же, как 0 (весь остаток от курсора); отсечение
	// отрицательных значений в 0 — забота HTTP-слоя (Task 3), не домена.
	Limit int
	// 0 — с начала. Неизвестный id трактуется как «с начала» (чат мог уехать
	// в архив или быть удалён между страницами); клиент сливает страницы по
	// chat_id, поэтому последствие — повторная страница, а не дыра.
	OffsetChatID int64
	// Выборка, внутри которой считаются Count, IsEnd и курсор. FolderGlobal
	// (нулевое значение) — весь набор.
	Folder DialogFolder
}

// DialogPageResult — страница плюс метаданные для виртуального списка:
// Count даёт высоту списка и число плейсхолдеров, IsEnd останавливает догрузку.
type DialogPageResult struct {
	Dialogs []Dialog
	// Размер ПОЛНОГО набора, не страницы; от Limit и курсора не зависит.
	Count int
	IsEnd bool
}

// Member is a full membership row (role + admin rights + mute).
type Member struct {
	ChatID, UserID int64
	Role           string
	Rights         Rights
	Muted          bool
}

// ChatRecord — СТРОКА таблицы chats глазами зрителя, а не объект провода.
// Наружу из неё собираются ДВА конструктора схемы: краткий `channel` (едет со
// списками) и полный `channelFull` (экран информации) — ToChannel/ToChannelFull
// ниже. Прежняя ChatCard склеивала их в одну плоскую карточку, из-за чего
// `GET /chats/{id}/card` и кадр chat_update отдавали одно и то же в двух разных
// формах.
type ChatRecord struct {
	ID       int64
	Type     string // private | group | channel | saved | secret
	Title    string
	Username string
	About    string
	// PhotoID/PhotoPreview — chats.photo_media_id и stripped-превью по нему;
	// PhotoW/PhotoH/PhotoSize — геометрия оригинала из media (нужна лестнице
	// размеров channelFull.chat_photo, которая едет ПОЛНЫМ Photo).
	PhotoID      *int64
	PhotoPreview []byte
	PhotoW       int
	PhotoH       int
	PhotoSize    int64
	CreatorID    int64
	MemberCount  int
	CreatedAt    time.Time
	// ViewerID — чьими глазами прочитана строка; 0 означает СНИМОК БЕЗ ЗРИТЕЛЯ
	// (кадр chat_update один на всех участников). Различать обязательно:
	// «зритель не состоит в чате» и «зрителя не спрашивали» дают одинаковый
	// пустой MyRole, но первое — это pFlags.left, а второе — отсутствие любых
	// флагов членства. Перепутать значит разослать всем участникам снимок, в
	// котором они из чата вышли.
	ViewerID int64
	// MyRole/MyRights — членство ЗРИТЕЛЯ. Отдельным полем роль наружу не
	// выходит (решение №3): creator это pFlags.creator, admin — наличие
	// admin_rights.
	MyRole           string
	MyRights         Rights
	Muted            bool
	DiscussionChatID int64
	IsForum          bool
	// PinnedMsgID — закреплённое сообщение чата (0 — нет).
	PinnedMsgID int64
	// Горизонты чтения зрителя и счётчик непрочитанного: обязательные
	// параметры channelFull (read_inbox_max_id / read_outbox_max_id /
	// unread_count).
	ReadInboxMaxID  int64
	ReadOutboxMaxID int64
	UnreadCount     int
	// Signatures/SignatureProfiles — подписи постов канала (Telegram
	// channels.toggleSignatures): показывать имя постящего админа и, опционально,
	// ссылку на его профиль. Актуальны только для каналов.
	Signatures        bool
	SignatureProfiles bool
	// Group-wide settings (edit screens): default member permissions, slowmode,
	// reaction policy, history visibility for new members.
	Settings ChatSettings
}

// ChatPhoto — объединение ChatPhoto для строки: «фото нет» это состояние.
func (c ChatRecord) ChatPhoto() ChatPhoto {
	if c.PhotoID == nil {
		return NewChatPhotoEmpty()
	}
	return NewChatPhoto(*c.PhotoID, c.PhotoPreview, false)
}

// FullPhoto — ПОЛНОЕ Photo с лестницей размеров: channelFull.chat_photo
// открывается в медиавьювере, поэтому одного id ему мало. nil — фото нет.
func (c ChatRecord) FullPhoto() *Photo {
	if c.PhotoID == nil {
		return nil
	}
	sizes := make([]PhotoSize, 0, 2)
	if len(c.PhotoPreview) > 0 {
		sizes = append(sizes, NewPhotoStrippedSize(c.PhotoPreview))
	}
	sizes = append(sizes, NewPhotoSize(SizeTypeFull, c.PhotoW, c.PhotoH, c.PhotoSize))
	return NewPhoto(*c.PhotoID, sizes)
}

// ToChannel — краткий конструктор `channel`: то, что едет со списками. Права
// зрителя (admin_rights) и ограничения обычного участника
// (default_banned_rights) — часть краткой формы по схеме.
func (c ChatRecord) ToChannel() Channel {
	out := NewChannel(c.ID, c.Title, c.ChatPhoto(), c.CreatedAt, ChannelFlags{
		Creator:           c.ViewerID != 0 && c.MyRole == RoleCreator,
		Left:              c.ViewerID != 0 && c.MyRole == "",
		Broadcast:         c.Type == ChatTypeChannel,
		Megagroup:         c.Type == ChatTypeGroup,
		Signatures:        c.Signatures,
		SignatureProfiles: c.SignatureProfiles,
		SlowmodeEnabled:   c.Settings.SlowmodeSeconds > 0,
		Forum:             c.IsForum,
		HasLink:           c.DiscussionChatID != 0,
	})
	out.Username = c.Username
	out.ParticipantsCount = c.MemberCount
	out.SendPaidMessagesStars = int64(c.Settings.ChargeStars)
	if c.ViewerID != 0 && c.MyRights != 0 {
		ar := NewChatAdminRights(c.MyRights)
		out.AdminRights = &ar
	}
	// ChatSettings.DefaultPerms — что участнику МОЖНО, а chatBannedRights —
	// что НЕЛЬЗЯ: NewChatBannedRights инвертирует. Ловушка выписана в его
	// докблоке; персональные ограничения (MemberRestriction.DeniedRights) —
	// уже готовые запреты и инверсии НЕ требуют.
	db := NewChatBannedRights(c.Settings.DefaultPerms, time.Time{})
	out.DefaultBanned = &db
	return out
}

// ToChannelFull — полный конструктор `channelFull`: экран информации.
func (c ChatRecord) ToChannelFull() ChannelFull {
	// history_for_new («история видна новым участникам») и hidden_prehistory
	// схемы — ОДНО И ТО ЖЕ свойство с противоположным знаком.
	out := NewChannelFull(c.ID, c.About, c.FullPhoto(), !c.Settings.HistoryForNew)
	out.ReadInboxMaxID = c.ReadInboxMaxID
	out.ReadOutboxMaxID = c.ReadOutboxMaxID
	out.UnreadCount = c.UnreadCount
	out.ParticipantsCount = c.MemberCount
	out.PinnedMsgID = int(c.PinnedMsgID)
	out.LinkedChatID = c.DiscussionChatID
	out.SlowmodeSeconds = c.Settings.SlowmodeSeconds
	out.TTLPeriod = c.Settings.AutoDeletePeriod
	out.AvailableReactions = c.Settings.ToChatReactions()
	out.SendPaidMessagesStars = int64(c.Settings.ChargeStars)
	return out
}

// InviteLink is a join token for a chat.
type InviteLink struct {
	ID               int64
	ChatID           int64
	Token            string
	CreatedBy        int64
	UsageLimit       *int
	Uses             int
	Revoked          bool
	RequiresApproval bool
	// Title — человекочитаемое имя ссылки (Telegram exportedChatInvite.title);
	// "" — без имени.
	Title string
	// ExpiresAt — срок действия ссылки; nil — бессрочная.
	ExpiresAt *time.Time
}

// InviteEdit carries the optional fields of an invite-link edit (PATCH). A nil
// pointer / false "set" flag leaves that column unchanged; the flags exist for
// the nullable columns where nil is itself a meaningful value ("unlimited" /
// "no expiry").
type InviteEdit struct {
	Title            *string
	RequiresApproval *bool
	Revoked          *bool
	// UsageLimit is applied only when SetUsageLimit is true; a nil value then
	// means "unlimited".
	UsageLimit    *int
	SetUsageLimit bool
	// ExpiresAt is applied only when SetExpiry is true; a nil value then means
	// "no expiry".
	ExpiresAt *time.Time
	SetExpiry bool
}

// InviteImporter is one user who joined a chat through a specific invite link.
type InviteImporter struct {
	UserID   int64
	JoinedAt time.Time
}

// JoinRequest is a pending request to join a chat via an approval-required link.
type JoinRequest struct {
	ChatID    int64
	UserID    int64
	CreatedAt time.Time
}

// BannedUser is one row of a chat's removed-users list.
type BannedUser struct {
	UserID   int64
	BannedBy int64
}

// MemberRestriction is a per-user granular restriction (Telegram
// ChatBannedRights): DeniedRights is a MemberPerms bitmask of what this member
// is NOT allowed to do, until UntilDate (nil — indefinitely). Distinct from a
// full ban (chat_bans / removal); the member stays in the chat but is limited.
type MemberRestriction struct {
	ChatID       int64
	UserID       int64
	DeniedRights MemberPerms
	UntilDate    *time.Time
	RestrictedBy int64
}

// Active reports whether the restriction is currently in effect at time now
// (an expired UntilDate means it no longer applies).
func (r MemberRestriction) Active(now time.Time) bool {
	return r.UntilDate == nil || r.UntilDate.After(now)
}

// ToChatBannedRights — персональное ограничение как конструктор схемы.
//
// ⚠ ЛОВУШКА ПОЛЯРНОСТИ, ради которой метод и существует. Тип MemberPerms в
// нашем коде носят ДВА поля с противоположным смыслом:
//
//	ChatSettings.DefaultPerms  — что участнику МОЖНО (дефолт 31 = всё);
//	MemberRestriction.DeniedRights — что участнику НЕЛЬЗЯ.
//
// NewChatBannedRights принимает РАЗРЕШЕНИЯ и инвертирует их сам. Значит
// DefaultPerms передаётся как есть, а DeniedRights — перевёрнутым; передать
// сюда DeniedRights напрямую значит выдать запрещённое за разрешённое и
// наоборот, то есть снять с человека ровно те ограничения, которые на него
// наложили. Единственное место, где этот переворот записан.
func (r MemberRestriction) ToChatBannedRights() ChatBannedRights {
	var until time.Time
	if r.UntilDate != nil {
		until = *r.UntilDate
	}
	return NewChatBannedRights(AllMemberPerms&^r.DeniedRights, until)
}

// SavedDialog is one grouped row of Saved Messages («Избранное» → таб «Чаты»):
// all saved messages attributed to one source peer (tweb saved dialogs).
// Kind 'self' («Мои заметки») groups the user's own non-forwarded notes.
type SavedDialog struct {
	Kind    string // 'self' | 'user' | 'chat'
	PeerID  PeerID // знаковый ключ источника; NullPeerID для 'self'
	Title   string // resolved peer title ('' for 'self' — client names it)
	PhotoID *int64 // media id аватарки источника; nil — фото нет
	Count   int
	Last    Message
}

// ChannelUpdate is one entry in a channel's per-channel updates log
// (the catch-up feed read by GET /channels/{id}/difference).
type ChannelUpdate struct {
	Pts      int64
	PtsCount int
	Type     string // тип апдейта (new_message/chat_update/boost_update) — для типизированного difference
	Payload  []byte
}
