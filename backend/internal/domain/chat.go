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

// ChatBrief — название и вид чата: подпись там, где карточки пира у получателя
// нет и не будет (имя автора кросс-чатного ответа, чат в апдейте бота).
// Конструктор `channel` из него НЕ собирается: урезанный не-min `channel`
// клиент оригинала кладёт поверх лежащей карточки целиком (tweb
// appChatsManager.saveApiChat → safeReplaceObject) и снимает со зрителя
// права. Карточки чатов собирает один сборщик — ChatRecord.ToChannel.
type ChatBrief struct {
	ID    int64
	Type  string // group | channel | ...
	Title string
}

// SendAsPeerRecord — доступная «личность отправителя» (Telegram channels.getSendAs):
// сам пользователь, канал (где он владелец/админ) или сама супергруппа
// (анонимный админ). Peer — ссылка на пир (peerUser | peerChannel), User/Chat —
// её тело: ровно раскладка channels.sendAsPeers{peers, chats, users}.
type SendAsPeerRecord struct {
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
	// ChannelPts — pts журнала broadcast-канала (chats.channel_pts) → dialog.pts.
	ChannelPts int64
	// PhotoID/PhotoPreview — фото группы/канала (chats.photo_media_id и
	// media.blur_preview по нему); nil — фото нет. У приватного чата аватарка
	// едет на самом пире (Peer.Photo), как в оригинале.
	PhotoID      *int64
	PhotoPreview []byte
	// Peer — собеседник приватного чата в форме конструктора `user` (nil у
	// групп и каналов). Наружу уезжает вектором users контейнера — вместе с
	// авторами последних сообщений.
	Peer *UserReal
	// PeerPhone — номер собеседника, прочитанный, но не показанный: строка
	// списка живёт в кэше (JSON), где скрытое поле карточки теряется, поэтому
	// номер едет рядом и возвращается в карточку на витрине
	// (UserReal.WithHiddenPhone) — показывает его правило приватности.
	PeerPhone string `json:",omitempty"`
	// TTLPeriod — период автоудаления сообщений чата в секундах (0 — выкл);
	// на проводе ttl_period (решение Р6).
	TTLPeriod int
	// JoinedAt — когда ЗРИТЕЛЬ вступил в этот чат (chat_members.joined_at).
	// Это и есть обязательный channel.date краткой формы — см. ToChannel.
	//
	// Подстановка даты создания, как у ChatRecord.ChannelDate, здесь не нужна:
	// список диалогов строится ОТ членства (ListDialogs идёт по chat_members
	// зрителя), поэтому в каждой его строке зритель — участник по построению.
	JoinedAt time.Time
	// Поля полного `channel` (см. ToChannel): число участников, членство
	// ЗРИТЕЛЯ (роль и права его строки chat_members) и настройки группы, из
	// которых собираются флаги и default_banned_rights. Зритель здесь участник
	// по построению — та же оговорка, что у JoinedAt.
	MemberCount       int
	MyRole            string
	MyRights          Rights
	Signatures        bool
	SignatureProfiles bool
	DiscussionChatID  int64
	// Settings — только то, что едет в краткую форму: DefaultPerms,
	// SlowmodeSeconds, ChargeStars.
	Settings ChatSettings
	// MyRestriction — действующее личное ограничение зрителя (см. ChatRecord).
	MyRestriction *MemberRestriction
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
	if d.Type == ChatTypeChannel {
		out.Pts = d.ChannelPts
	}
	return out
}

// ToChannel — конструктор `channel` для вектора chats контейнера:
// группа и канал различаются флагами, а не строкой (решение №2 разбора пиров).
// У приватного чата и «Избранного» тела чата нет вовсе — там пир это
// собеседник, поэтому вызывать имеет смысл только для многочленных чатов.
//
// date едет ДАТОЙ ВСТУПЛЕНИЯ зрителя (JoinedAt), а не датой создания чата: см.
// ChatRecord.ChannelDate — там же и цена ошибки.
//
// Это ПОЛНЫЙ `channel` зрителя, тот же, что собирает карточка
// (ChatRecord.ToChannel): число участников, членство зрителя и ограничения
// обычного участника. Клиент оригинала заменяет им лежащую карточку целиком
// (tweb appChatsManager.saveApiChat → safeReplaceObject, :268), поэтому
// урезанная строка списка затирала карточку: после каждого перечитывания
// списка шапка группы показывала «1 участник», а композер — «запрещено
// отправлять сообщения» (hasRights без default_banned_rights отвечает «нельзя»).
func (d DialogRecord) ToChannel() Channel {
	out := NewChannel(d.ChatID, d.Title, d.ChatPhoto(), d.JoinedAt, ChannelFlags{
		Broadcast:         d.Type == ChatTypeChannel,
		Megagroup:         d.Type == ChatTypeGroup,
		Signatures:        d.Signatures,
		SignatureProfiles: d.SignatureProfiles,
		SlowmodeEnabled:   d.Settings.SlowmodeSeconds > 0,
		Forum:             d.IsForum,
		HasLink:           d.DiscussionChatID != 0,
	})
	out.Username = d.Username
	out.ParticipantsCount = d.MemberCount
	out.SendPaidMessagesStars = int64(d.Settings.ChargeStars)
	out.SetViewerMembership(d.MyRole, d.MyRights)
	// Та же инверсия «можно → нельзя» и то же правило для broadcast, что у
	// карточки (см. ChatRecord.ToChannel).
	if d.Type != ChatTypeChannel {
		db := NewChatBannedRights(d.Settings.DefaultPerms, time.Time{})
		out.DefaultBanned = &db
		out.BannedRights = ViewerBannedRights(d.MyRestriction, d.Settings.DefaultPerms, time.Now())
	}
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
	// PromotedBy — кто назначил админа (channelParticipantAdmin.promoted_by);
	// 0 — не админ. Админам до миграции 0139 миграция 0150 вписала владельца:
	// править их, как и прежде, может только он (tweb canEditAdmin).
	PromotedBy int64
	// Rank — подпись админа/владельца (channelParticipantAdmin.rank, Б-117).
	Rank string
	// InviterID — кто привёл: добавивший или создатель ссылки; 0 — вошёл сам.
	InviterID int64
	// ViaRequest — вошёл одобренной заявкой (channelParticipantSelf.via_request).
	ViaRequest bool
	// JoinedAt — дата вступления (обязательный date участника).
	JoinedAt time.Time
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
	// MyJoinedAt — когда ЗРИТЕЛЬ вступил в чат (chat_members.joined_at той же
	// строки членства, что MyRole/MyRights). Нулевое время — зритель не
	// состоит либо зрителя не спрашивали (ViewerID == 0). Наружу поле выходит
	// не само по себе, а обязательным channel.date — см. ChannelDate.
	MyJoinedAt time.Time
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
	// Hidden — чат зрителю НЕ читается (не участник, не публичный, не группа
	// обсуждения читаемого канала либо забанен): наружу уходит честный `min`
	// без членства и прав. Ссылка на такой чат приезжает из чужого контента
	// (заголовок пересылки, автор send-as), и имя с аватаркой ему положены, а
	// ограничения обычного участника — нет: tweb hasRights берёт
	// default_banned_rights как права зрителя, и чужие настройки чата,
	// слитые поверх лежащей карточки, блокировали ввод (A1-01).
	Hidden bool
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
	// MyRestriction — действующее личное ограничение ЗРИТЕЛЯ (chat_restrictions);
	// nil — его нет или зрителя не спрашивали. Наружу — channel.banned_rights
	// (ViewerBannedRights).
	MyRestriction *MemberRestriction
	// Counters — счётчики участников, которые зрителю положено видеть
	// (channelFull admins_count/kicked_count/…); nil — не спрашивали (снимок
	// chat_update без зрителя или зритель не участник).
	Counters *ParticipantCounters
	// LinkedChannelID — у группы обсуждения: канал, к которому она привязана
	// (обратный discussion_chat_id). Наружу — channelFull.linked_chat_id группы
	// (Б-119, tweb chatDiscussion: «Привязанный канал»).
	LinkedChannelID int64
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

// ChannelDate — что уезжает в обязательный `channel.date` (int, СЕКУНДЫ).
//
// По схеме это НЕ дата создания чата: date — дата ВСТУПЛЕНИЯ зрителя, и датой
// создания она подменяется только тому, кто в чате не состоит. Пока сюда ехал
// CreatedAt, участник получал дату создания канала — то есть поле было
// заполнено правдоподобно и неверно.
//
// Читает его клиент оригинала, когда вставляет служебное «вы вступили в
// канал»: бабл messageActionChannelJoined КЛИЕНТСКИЙ и встаёт в историю ПО
// ЭТОЙ ДАТЕ, между сообщением новее и сообщением старее
// (tweb appMessagesManager.ts:6888-6930, getDetailsForChannelJoinedService).
// Дата создания, отданная участнику, увела бы бабл в самое начало истории — а
// это единственное место, к которому у оригинала цепляются «Похожие каналы»
// (tweb bubbles.ts:7028-7118, класс bubble-similar-channels).
//
// Снимок БЕЗ ЗРИТЕЛЯ (ViewerID == 0 — кадр chat_update один на всех
// участников) отдаёт 0, ровно как соседние горизонты чтения channelFull в том
// же снимке: «не спрашивали». Чужая дата вступления, разосланная всем, была бы
// прямой ложью, а дата создания — ложью правдоподобной, которую клиент от
// ответа не отличит. Ноль он отличает, и это его штатная ветка:
// `if(!date || …) return` (tweb appMessagesManager.ts:6896).
func (c ChatRecord) ChannelDate() time.Time {
	// Порядок проверок значим: «зрителя не спрашивали» гасит поле ПЕРВЫМ, до
	// любой даты. Иначе случайно заполненная MyJoinedAt утекла бы в кадр,
	// который уходит всем участникам разом.
	if c.ViewerID == 0 {
		return time.Time{}
	}
	if c.MyJoinedAt.IsZero() {
		return c.CreatedAt
	}
	return c.MyJoinedAt
}

// ToChannel — краткий конструктор `channel`: то, что едет со списками. Права
// зрителя (admin_rights) и ограничения обычного участника
// (default_banned_rights) — часть краткой формы по схеме.
func (c ChatRecord) ToChannel() Channel {
	if c.Hidden && c.ViewerID != 0 {
		return c.toMinChannel()
	}
	out := NewChannel(c.ID, c.Title, c.ChatPhoto(), c.ChannelDate(), ChannelFlags{
		// Снимок без зрителя (chat_update, один на всех участников) — это и
		// есть min-конструктор схемы: членства в нём нет, потому что его не
		// спрашивали. Без флага клиент принимал его за полный `channel`
		// зрителя и затирал им карточку: создатель после смены фото группы
		// оставался без pFlags.creator и admin_rights.
		Min:               c.ViewerID == 0,
		Left:              c.ViewerID != 0 && c.MyRole == "",
		Broadcast:         c.Type == ChatTypeChannel,
		Megagroup:         c.Type == ChatTypeGroup,
		Signatures:        c.Signatures,
		SignatureProfiles: c.SignatureProfiles,
		SlowmodeEnabled:   c.Settings.SlowmodeSeconds > 0,
		Forum:             c.IsForum,
		// has_link — у канала есть группа обсуждения ЛИБО группа сама служит
		// обсуждением канала (Б-119).
		HasLink: c.DiscussionChatID != 0 || c.LinkedChannelID != 0,
	})
	out.Username = c.Username
	out.ParticipantsCount = c.MemberCount
	out.SendPaidMessagesStars = int64(c.Settings.ChargeStars)
	if c.ViewerID != 0 {
		out.SetViewerMembership(c.MyRole, c.MyRights)
	}
	// ChatSettings.DefaultPerms — что участнику МОЖНО, а chatBannedRights —
	// что НЕЛЬЗЯ: NewChatBannedRights инвертирует. Ловушка выписана в его
	// докблоке; персональные ограничения (MemberRestriction.DeniedRights) —
	// уже готовые запреты и инверсии НЕ требуют.
	//
	// У broadcast-канала дефолтных прав участника нет: подписчик не делает
	// ничего, а права админа едут admin_rights. Клиент оригинала на этом и
	// стоит — hasRights без admin_rights берёт default_banned_rights, и пустой
	// набор запретов у канала значил бы «подписчику можно закреплять».
	if c.Type != ChatTypeChannel {
		db := NewChatBannedRights(c.Settings.DefaultPerms, time.Time{})
		out.DefaultBanned = &db
		// Личное ограничение зрителя (A1-06/A4-06): прежде поле не писал никто,
		// и ограниченный видел активные скрепку и поле ввода, а сервер молча
		// отвечал forbidden. Снимок без зрителя его не несёт — ограничение чужое.
		if c.ViewerID != 0 && c.MyRole != "" {
			out.BannedRights = ViewerBannedRights(c.MyRestriction, c.Settings.DefaultPerms, time.Now())
		}
	}
	return out
}

// toMinChannel — `min`-конструктор для чата, который зрителю не читается:
// имя, @имя, аватарка и общие свойства чата (вид, форум, подписи, связь).
// Ни членства, ни default_banned_rights, ни даты, ни числа участников: это не
// «зритель не состоит», а «не спрашивали» — клиент берёт из `min` общее, а
// пер-зрительское и отсутствующее оставляет от лежащей карточки (tweb
// appChatsManager.saveApiChat, :229-231, :239-244).
func (c ChatRecord) toMinChannel() Channel {
	out := NewChannel(c.ID, c.Title, c.ChatPhoto(), time.Time{}, ChannelFlags{
		Min:               true,
		Broadcast:         c.Type == ChatTypeChannel,
		Megagroup:         c.Type == ChatTypeGroup,
		Signatures:        c.Signatures,
		SignatureProfiles: c.SignatureProfiles,
		SlowmodeEnabled:   c.Settings.SlowmodeSeconds > 0,
		Forum:             c.IsForum,
		HasLink:           c.DiscussionChatID != 0 || c.LinkedChannelID != 0,
	})
	out.Username = c.Username
	return out
}

// SetViewerMembership — членство ЗРИТЕЛЯ в краткой форме: pFlags.creator и
// admin_rights. Одно место на все сборки `channel`, у которых зритель известен
// (карточка, строка списка чатов, пер-зрительский снимок chat_update).
//
// Зачем отдельно: `channel` — объект ГЛАЗАМИ ЗРИТЕЛЯ, и клиент оригинала
// заменяет им лежащую карточку целиком (tweb appChatsManager.saveApiChat →
// safeReplaceObject). Конструктор, собранный без этих полей, для клиента
// значит «я не создатель и не админ» — а не «не спрашивали». Так строка
// списка чатов снимала с создателя его права сразу после смены фото группы.
func (c *Channel) SetViewerMembership(role string, rights Rights) {
	setPFlag(&c.PFlags, "creator", role == RoleCreator)
	c.AdminRights = nil
	// Админ без единого права — всё равно админ (tweb just_admin смотрит на сам
	// конструктор chatAdminRights): по пустой маске конструктор не опускается.
	if role == RoleCreator || role == RoleAdmin {
		ar := NewChatAdminRights(rights)
		c.AdminRights = &ar
	}
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
	// can_view_stats — зритель-зависимый, как и notify_settings: статистику
	// видят создатель и админы канала/группы (тот же допуск, что у ручки
	// GET /channels/{id}/stats). Снимок без зрителя флага не несёт.
	setPFlag(&out.PFlags, "can_view_stats", c.ViewerID != 0 &&
		(c.Type == ChatTypeChannel || c.Type == ChatTypeGroup) &&
		(c.MyRole == RoleCreator || c.MyRole == RoleAdmin))
	if c.DiscussionChatID == 0 && c.LinkedChannelID != 0 {
		out.LinkedChatID = c.LinkedChannelID
	}
	// Счётчики участников — зритель-зависимые (Б-115): что положено, решил
	// usecase; снимок без зрителя их не несёт, как notify_settings.
	if k := c.Counters; c.ViewerID != 0 && k != nil {
		setPFlag(&out.PFlags, "can_view_participants", k.CanViewParticipants)
		out.AdminsCount = k.Admins
		out.KickedCount = k.Kicked
		out.BannedCount = k.Banned
		if k.RequestsPending != nil && *k.RequestsPending > 0 {
			out.RequestsPending = k.RequestsPending
			out.RecentRequesters = nonNilIDs(k.RecentRequesters)
		}
	}
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
	// CreatedAt — когда ссылка создана (обязательный `date` конструктора
	// chatInviteExported). Колонка была в таблице с самого начала, а до витрины
	// не доходила.
	CreatedAt time.Time
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
	// CreatedAt — когда наложено (date строки channelParticipantBanned).
	CreatedAt time.Time
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
type SavedDialogRecord struct {
	// PeerID — знаковый ключ ИСТОЧНИКА пересылки. У «Моих заметок» (ничего не
	// переслано либо переслано у себя) это сам зритель: вида строкой
	// (`kind: 'self'|'user'|'chat'`) больше нет — его отвечает знак ключа и
	// сравнение с собой.
	PeerID PeerID
	// LastMsgID — КЛЮЧ СТРОКИ последнего сохранённого сообщения источника,
	// LastMsgSeq — тот же последний НОМЕРОМ (top_message конструктора).
	// Ни заголовка, ни аватарки, ни счётчика здесь нет: карточки едут
	// векторами контейнера, а счётчика у оригинала не бывает вовсе.
	LastMsgID  int64
	LastMsgSeq int64
}

// ChannelUpdate is one entry in a channel's per-channel updates log
// (the catch-up feed read by GET /channels/{id}/difference).
// ChannelCursor — канал зрителя и текущий pts его журнала: им соединение
// подписывается на топик, а клиент узнаёт, какие каналы сдвинулись, пока
// сокета не было (наш аналог updateChannelTooLong в ответе getDifference).
type ChannelCursor struct {
	ChatID int64
	Pts    int64
}

type ChannelUpdate struct {
	Pts      int64
	PtsCount int
	Type     string // тип апдейта (new_message/chat_update/boost_update) — для типизированного difference
	Payload  []byte
}
