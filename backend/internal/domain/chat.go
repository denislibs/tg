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

// DialogRecord — СТРОКА витрины списка чатов глазами зрителя, а не объект
// провода. Наружу из неё собирается конструктор `dialog` вместе с векторами
// контейнера messages.dialogs (см. mtdialog.go): сам dialog несёт только
// состояние чтения и место в списке, а title/username/photo уезжают в `chats`,
// собеседник — в `users`, последнее сообщение — в `messages` и адресуется
// числом top_message.
//
// Имя с суффиксом Record — тот же приём и та же причина, что у
// UserRecord/ChatRecord (шаг C пиров): `Dialog` это имя ОБЪЕДИНЕНИЯ схемы, а
// плоская строка выборки объединением не является и никогда им не была.
// Разбор полей (что куда уезжает) — docs/readiness/tl-dialogs-analysis.md,
// исполняется шагом B.
type DialogRecord struct {
	ChatID int64
	// Type — вид чата из НАШЕЙ колонки chats.type. Наружу не выходит (решение
	// Р8): вид выражают конструктор пира и флаги Chat. Здесь он остаётся потому,
	// что нужен серверу: по нему считается адрес пира (peeraddr.go) и собирается
	// вектор chats контейнера.
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
	// NotifySettings — пер-чатное переопределение уведомлений ЦЕЛИКОМ, а не три
	// плоских поля (решение Р4). Прежние Muted/NotifyPreview/NotifySound
	// схлопнулись сюда: мьют это СРОК (mute_until), а звук — объединение
	// NotificationSound, а не строка. Замьючен ли чат сейчас, отвечает
	// единственный предикат PeerNotifySettings.Muted.
	NotifySettings PeerNotifySettings
	// Pinned — диалог закреплён вверху списка (пер-юзерный флаг членства).
	Pinned bool
	// Folder — реальная папка диалога: FolderAll — общий список, FolderArchive —
	// архив. Прежний `archived: bool` исчез: на проводе это folder_id, и
	// значения перечисления совпадают с проводными (решение Р5).
	Folder FolderID
	// IsForum — в группе включены темы (клиент рендерит список топиков).
	IsForum bool
	// TopMessageID — id ПОСЛЕДНЕГО сообщения чата (messages.id) с учётом
	// пер-юзерной очистки истории (seq > cleared_max_seq); 0 — сообщений нет.
	// Прежняя выжимка last_* (текст, тип, имя автора, признак пересылки…) с
	// провода ушла целиком: сообщение адресуется числом top_message, а сам
	// объект едет вектором messages контейнера (решение Р3). Здесь хранится
	// именно id строки: по нему сообщение достаётся пакетным запросом; на
	// провод же уходит TopMessageSeq (см. ниже).
	TopMessageID int64
	// TopMessageSeq — НОМЕР того же сообщения в чате, то есть ровно то число,
	// которым поле схемы dialog.top_message адресует сообщение наружу. Едет
	// рядом с TopMessageID из ОДНОЙ строки выборки (тот же LATERAL): собирать
	// его поиском по загруженным сообщениям нельзя — промах давал бы тихий 0,
	// а 0 в этом пространстве значит «самое новое».
	TopMessageSeq int64
	// PhotoID/PhotoPreview — фото группы/канала (chats.photo_media_id и
	// media.blur_preview по нему); nil — фото нет. У приватного чата аватарка
	// едет на самом пире (Peer.Photo), как в оригинале.
	PhotoID      *int64
	PhotoPreview []byte
	// Peer — собеседник приватного чата в форме конструктора `user` (nil у
	// групп и каналов). Наружу уезжает вектором users контейнера — вместе с
	// авторами последних сообщений.
	Peer *UserReal
	// TTLPeriod — период автоудаления сообщений чата в секундах (0 — выкл);
	// на проводе ttl_period (решение Р6).
	TTLPeriod int
}

// ToDialog — конструктор `dialog` из строки витрины. Пир и seq последнего
// сообщения приходят снаружи: первый зависит от ЗРИТЕЛЯ (см. peeraddr.go),
// второй читается из самого сообщения, которое едет вектором messages.
func (d DialogRecord) ToDialog(peer Peer, topMessage int64) DialogReal {
	out := NewDialog(peer, topMessage, d.NotifySettings, d.Pinned)
	out.ReadInboxMaxID = d.LastReadSeq
	out.ReadOutboxMaxID = d.PeerReadSeq
	out.UnreadCount = d.UnreadCount
	out.UnreadMentionsCount = d.UnreadMentionsCount
	out.UnreadReactionsCount = d.UnreadReactionsCount
	out.FolderID = int(d.Folder)
	out.TTLPeriod = d.TTLPeriod
	out.Secret = d.Type == ChatTypeSecret
	return out
}

// ToChannel — краткий конструктор `channel` для вектора chats контейнера:
// группа и канал различаются флагами, а не строкой (решение №2 разбора пиров).
// У приватного чата и «Избранного» тела чата нет вовсе — там пир это
// собеседник, поэтому вызывать имеет смысл только для многочленных чатов.
func (d DialogRecord) ToChannel() Channel {
	out := NewChannel(d.ChatID, d.Title, d.ChatPhoto(), time.Time{}, ChannelFlags{
		Broadcast: d.Type == ChatTypeChannel,
		Megagroup: d.Type == ChatTypeGroup,
		Forum:     d.IsForum,
	})
	out.Username = d.Username
	return out
}

// ChatPhoto — фото группы/канала как объединение схемы; «фото нет» это
// состояние (chatPhotoEmpty), а не пустая строка URL.
func (d DialogRecord) ChatPhoto() ChatPhoto {
	if d.PhotoID == nil {
		return NewChatPhotoEmpty()
	}
	return NewChatPhoto(*d.PhotoID, d.PhotoPreview, false)
}

// FolderID — РЕАЛЬНАЯ папка диалога. Порт tweb REAL_FOLDER_ID
// (lib/appManagers/constants.ts:37-39): на сервере существуют ровно две папки,
// «все чаты» и «архив»; пользовательские папки — клиентский фильтр поверх них
// (domain.DialogFilter) и до бэкенда не доходят.
//
// Значения совпадают с проводным dialog.folder_id, и это не совпадение: «папка
// не указана» выражается ОТСУТСТВИЕМ значения (у запроса — нулевым указателем,
// на проводе — отсутствием ключа), а не третьим членом перечисления. Порт tweb
// GLOBAL_FOLDER_ID (storages/dialogs.ts:68 — это `undefined`); прежний
// FolderGlobal был выдуман нами и разводил перечисление с проводом.
//
// Имя DialogFolder освобождено под конструктор схемы (решение Р2): dialogFolder
// это СТРОКА-ПАПКА в списке чатов, а здесь перечислена сама папка.
type FolderID int

const (
	// FolderAll — общий список чатов (на проводе folder_id=0, tweb FOLDER_ID_ALL).
	FolderAll FolderID = 0
	// FolderArchive — архив (на проводе folder_id=1, tweb FOLDER_ID_ARCHIVE).
	FolderArchive FolderID = 1
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
	// Folder — выборка, внутри которой считаются Count и курсор. nil — «папка
	// не указана», то есть весь набор: у оригинала это GLOBAL_FOLDER_ID =
	// undefined, а не отдельное значение перечисления.
	Folder *FolderID
}

// DialogPageResult — страница плюс размер набора для виртуального списка.
//
// Булева «это всё» здесь нет: на проводе конец списка выражает ОТСУТСТВИЕ
// count, то есть выбор конструктора — messages.dialogs против
// messages.dialogsSlice (решение Р1). Клиент оригинала читает именно так:
// `isEnd = !count || dialogsLength >= count || !items.length`
// (tweb appMessagesManager.ts:3614,3629), и наш is_end ему не нужен.
type DialogPageResult struct {
	Dialogs []DialogRecord
	// Размер ПОЛНОГО набора, не страницы; от Limit и курсора не зависит.
	Count int
	// Whole — набор отдан ЦЕЛИКОМ (ни курсора, ни отсечения по лимиту). Отвечает
	// ровно на один вопрос: какой из двух конструкторов контейнера собирать.
	Whole bool
}

// Member is a membership row (role + admin rights).
type Member struct {
	ChatID, UserID int64
	Role           string
	Rights         Rights
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
	MyRole   string
	MyRights Rights
	// NotifySettings — пер-чатное переопределение уведомлений ЗРИТЕЛЯ целиком
	// (мьют сроком, превью, звук), а не плоское булево `muted` рядом с
	// конструктором. nil — зрителя не спрашивали (ViewerID == 0): снимок
	// chat_update один на всех участников, и чужие настройки уведомлений в нём
	// были бы прямой ложью. Параметр channelFull.notify_settings по схеме
	// ОБЯЗАТЕЛЬНЫЙ — поэтому это указатель, а не пустой конструктор: пустой
	// означал бы «переопределения нет», то есть конкретный ответ.
	NotifySettings   *PeerNotifySettings
	DiscussionChatID int64
	IsForum          bool
	// ThemeEmoticon — тема оформления чата (chat_theme.theme_id); "" — тема не
	// задана. Прежде ехала полем каждой строки списка диалогов; в схеме её место
	// — полная карточка (chatFull/channelFull.theme_emoticon), решение Р7.
	ThemeEmoticon string
	// PinnedMsgID — закреплённое сообщение чата НОМЕРОМ в чате (0 — нет):
	// в схеме chatFull.pinned_msg_id адресует сообщение в его пире.
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
	out.ThemeEmoticon = c.ThemeEmoticon
	out.NotifySettings = c.NotifySettings
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
