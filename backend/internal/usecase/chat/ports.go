// Package chat is the chat/message/sync/reactions application logic.
package chat

import (
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// TxManager runs fn inside a transaction; the tx is carried in the returned ctx
// (repo adapters pick it up). Keeps pgx out of the usecase.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// ContactPhotoLookup reads the viewer's personal photos for contacts so the
// dialog list can show them in place of the peer's real avatar (Telegram
// personal_photo). Implemented by the contacts repo. Optional.
type ContactPhotoLookup interface {
	CustomPhotoMap(ctx context.Context, ownerID int64, contactIDs []int64) (map[int64]string, error)
}

// ProfilePhotoAdder appends a photo to a user's profile gallery and promotes it
// to the current avatar (implemented by the auth usecase). Used when a user
// accepts a suggested profile photo. Optional.
type ProfilePhotoAdder interface {
	AddProfilePhoto(ctx context.Context, userID int64, url, videoURL string) (domain.ProfilePhoto, error)
}

type ChatRepo interface {
	FindPrivate(ctx context.Context, a, b int64) (int64, error) // domain.ErrNotFound if none
	CreatePrivate(ctx context.Context, a, b int64) (int64, error)
	CreateSecret(ctx context.Context, a, b int64) (int64, error)
	FindSaved(ctx context.Context, userID int64) (int64, error) // domain.ErrNotFound if none
	CreateSaved(ctx context.Context, userID int64) (int64, error)
	MemberIDs(ctx context.Context, chatID int64) ([]int64, error)
	IsMember(ctx context.Context, chatID, userID int64) (bool, error)
	ChatType(ctx context.Context, chatID int64) (string, error) // 'private'|'group'|'channel'|'saved'
	ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error)
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
	IncUnread(ctx context.Context, chatID, userID int64) error
	CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error)
	SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error
	// LastReadAt — когда участник в последний раз продвинул read-горизонт
	// (для read-date исходящих). ok=false, если участник ещё ничего не прочитал.
	LastReadAt(ctx context.Context, chatID, userID int64) (at time.Time, ok bool, err error)
	// Непрочитанные упоминания (Telegram unread_mentions_count). AddMention
	// отмечает сообщение (chat/msg/seq), где упомянут userID, и бампит его
	// счётчик. ClearMentions снимает упоминания с seq<=uptoSeq (прочитано) и
	// возвращает оставшееся число. NextMention — seq/msgID ближайшего
	// непрочитанного упоминания с seq>afterSeq (domain.ErrNotFound, если нет).
	AddMention(ctx context.Context, chatID, msgID, seq, userID int64) error
	ClearMentions(ctx context.Context, chatID, userID, uptoSeq int64) (remaining int, err error)
	NextMention(ctx context.Context, chatID, userID, afterSeq int64) (seq, msgID int64, err error)
	// Непрочитанные реакции (Telegram unread_reactions_count). IncUnreadReactions
	// бампит счётчик автора сообщения, когда на него реагирует кто-то другой;
	// ClearUnreadReactions обнуляет счётчик (автор прочитал чат / реакции).
	IncUnreadReactions(ctx context.Context, chatID, userID int64) error
	ClearUnreadReactions(ctx context.Context, chatID, userID int64) error
	// «Очистить историю» у себя: MaxSeq — текущий максимум seq чата (горизонт);
	// ClearedSeq/SetClearedSeq — персональный горизонт участника (cleared_max_seq).
	MaxSeq(ctx context.Context, chatID int64) (int64, error)
	ClearedSeq(ctx context.Context, chatID, userID int64) (int64, error)
	SetClearedSeq(ctx context.Context, chatID, userID, seq int64) error
	// Автоудаление: период чата, глобальный период пользователя (для новых чатов).
	SetAutoDelete(ctx context.Context, chatID int64, seconds int) error
	SetChatTheme(ctx context.Context, chatID int64, themeID string, setBy int64) error
	UserAutoDelete(ctx context.Context, userID int64) (int, error)
	SetUserAutoDelete(ctx context.Context, userID int64, seconds int) error
	PinMessage(ctx context.Context, chatID, msgID, byUser int64) error
	UnpinMessage(ctx context.Context, chatID, msgID int64) error
	ListPins(ctx context.Context, chatID int64) ([]domain.Message, error)
	Viewers(ctx context.Context, chatID, seq, excludeUser int64) ([]int64, error)
}

type GroupRepo interface {
	CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error)
	AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	RemoveMember(ctx context.Context, chatID, userID int64) error
	GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) // domain.ErrNotFound if not a member
	SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	// SetMuted: muted — «навсегда»; until — временный mute (эффективный mute
	// вычисляется как muted OR muted_until > now()).
	SetMuted(ctx context.Context, chatID, userID int64, muted bool, until *time.Time) error
	// SetNotify обновляет per-chat уведомления (превью/звук); nil-поля не меняются.
	SetNotify(ctx context.Context, chatID, userID int64, preview *bool, sound *string) error
	// SetPinned/SetArchived — пер-юзерные флаги диалога (закрепление/архив);
	// CountPinned — пины основного списка (для лимита, архив не считается).
	SetPinned(ctx context.Context, chatID, userID int64, pinned bool) error
	CountPinned(ctx context.Context, userID int64) (int, error)
	SetArchived(ctx context.Context, chatID, userID int64, archived bool) error
	// SetForum включает темы у группы (chats.is_forum).
	SetForum(ctx context.Context, chatID int64, enabled bool) error
	Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) // domain.ErrNotFound if no chat
	EditInfo(ctx context.Context, chatID int64, title, about, username string) error
	SetPhoto(ctx context.Context, chatID, mediaID int64) error
	UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error)
	ListMembers(ctx context.Context, chatID int64, offset, limit int) ([]domain.Member, error)
	// AdminIDs — id владельца и админов чата (role in creator/admin), для адресной
	// рассылки (напр. новые предложенные посты уходят только тем, кто их решает).
	AdminIDs(ctx context.Context, chatID int64) ([]int64, error)
	SetDiscussion(ctx context.Context, channelID, groupID int64) error
	GetDiscussion(ctx context.Context, channelID int64) (int64, error) // 0 = none
	// IsDiscussionGroup — chatID является discussion-группой какого-то канала
	// (тред комментариев там читается и без членства, как ListComments).
	IsDiscussionGroup(ctx context.Context, chatID int64) (bool, error)
	// Group edit-screen settings + removed-users list.
	Settings(ctx context.Context, chatID int64) (domain.ChatSettings, error)
	SetType(ctx context.Context, chatID int64, isPublic bool, username string) error // domain.ErrConflict on taken username
	SetPermissions(ctx context.Context, chatID int64, perms domain.MemberPerms, slowmodeSeconds int) error
	SetReactions(ctx context.Context, chatID int64, mode string, allowed []string) error
	SetHistoryForNew(ctx context.Context, chatID int64, visible bool) error
	// SetChargeStars задаёт плату за сообщение в звёздах (Telegram paid messages); 0 — выкл.
	SetChargeStars(ctx context.Context, chatID int64, stars int) error
	// CreatorID — владелец группы (для начисления платы за сообщения); 0, если нет.
	CreatorID(ctx context.Context, chatID int64) (int64, error)
	Ban(ctx context.Context, chatID, userID, bannedBy int64) error
	Unban(ctx context.Context, chatID, userID int64) error
	IsBanned(ctx context.Context, chatID, userID int64) (bool, error)
	ListBans(ctx context.Context, chatID int64) ([]domain.BannedUser, error)
	// Per-user granular restrictions (Telegram editBanned / ChatBannedRights).
	// GetRestriction returns the raw row (bool=exists); expiry is decided by the
	// caller via domain.MemberRestriction.Active.
	SetRestriction(ctx context.Context, res domain.MemberRestriction) error
	GetRestriction(ctx context.Context, chatID, userID int64) (domain.MemberRestriction, bool, error)
	ListRestrictions(ctx context.Context, chatID int64) ([]domain.MemberRestriction, error)
	DeleteRestriction(ctx context.Context, chatID, userID int64) error
	DeleteChat(ctx context.Context, chatID int64) error // каскадом members/messages
}

type InviteRepo interface {
	Create(ctx context.Context, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool, expiresAt *time.Time) (domain.InviteLink, error)
	GetByToken(ctx context.Context, token string) (domain.InviteLink, error) // domain.ErrNotFound
	List(ctx context.Context, chatID int64) ([]domain.InviteLink, error)
	IncUses(ctx context.Context, id int64) error
	Revoke(ctx context.Context, chatID int64, token string) error
}

type JoinRequestRepo interface {
	Create(ctx context.Context, chatID, userID int64, inviteToken string) error // idempotent (ON CONFLICT DO NOTHING)
	List(ctx context.Context, chatID int64) ([]domain.JoinRequest, error)
	Delete(ctx context.Context, chatID, userID int64) error
}

type MessageRepo interface {
	NextSeq(ctx context.Context, chatID int64) (int64, error)
	Insert(ctx context.Context, m domain.Message) (domain.Message, error)
	FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error)
	GetByID(ctx context.Context, msgID int64) (domain.Message, error)
	GetByIDs(ctx context.Context, ids []int64) ([]domain.Message, error)
	// ByPollID — сообщения, ссылающиеся на опрос (обычно одно).
	ByPollID(ctx context.Context, pollID int64) ([]domain.Message, error)
	// ByChecklistID — сообщения, ссылающиеся на чек-лист (обычно одно).
	ByChecklistID(ctx context.Context, checklistID int64) ([]domain.Message, error)
	SearchMessages(ctx context.Context, chatID int64, q string, offset, limit int) ([]domain.Message, int, error)
	// GlobalSearchMessages searches across every chat userID is a member of;
	// filter narrows by shared-media kind ("" = any type).
	GlobalSearchMessages(ctx context.Context, userID int64, q, filter string, offset, limit int) ([]domain.Message, int, error)
	MediaHistory(ctx context.Context, chatID int64, filter string, offset, limit int) ([]domain.Message, int, error)
	// threadRootID != nil ограничивает окно тредом (топик/комментарии): сообщения
	// с этим thread_root_id + само корневое сообщение.
	// clearedSeq — персональный горизонт «очистки истории»: сообщения с
	// seq<=clearedSeq скрыты для этого читателя (0 — ничего не очищено).
	GetAround(ctx context.Context, chatID, userID, centerSeq int64, limit int, threadRootID *int64, clearedSeq int64) ([]domain.Message, bool, bool, error)
	GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, threadRootID *int64, clearedSeq int64) ([]domain.Message, error)
	// LastMessageAt is the newest non-deleted message time by senderID in the chat
	// (slowmode); domain.ErrNotFound when they haven't posted yet.
	LastMessageAt(ctx context.Context, chatID, senderID int64) (time.Time, error)
	// SavedDialogs groups the saved-messages chat by forward origin
	// («Избранное» → таб «Чаты»), newest group first.
	SavedDialogs(ctx context.Context, chatID, userID int64) ([]domain.SavedDialog, error)
	UpdateText(ctx context.Context, msgID int64, text string, entities []domain.MessageEntity) (domain.Message, error)
	UpdateReplyMarkup(ctx context.Context, msgID int64, markup *domain.ReplyMarkup) (domain.Message, error)
	// UpdateGeoLive обновляет координаты live-локации (+heading/stopped), бампит edited_at.
	UpdateGeoLive(ctx context.Context, msgID int64, lat, lng float64, heading *int, stopped bool) (domain.Message, error)
	SoftDelete(ctx context.Context, msgID int64) error
	// SetDestructOnRead ставит destruct_at=now()+ttl для секретных сообщений,
	// полученных читателем (sender_id<>readerID) до readSeq; no-op для чатов
	// без ttl. Идемпотентно.
	SetDestructOnRead(ctx context.Context, chatID, readerID, readSeq int64) error
	HideForUser(ctx context.Context, userID, msgID int64) error
	ListThread(ctx context.Context, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error)
	CountThread(ctx context.Context, chatID, threadRootID int64) (int, error)
	CountMessages(ctx context.Context, chatID int64) (int, error)
	CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error)
	MessageChatID(ctx context.Context, messageID int64) (int64, error)
	// RegisterChannelViews records userID's view of every channel post in chatID
	// up to upToSeq (deduped per viewer); a no-op for non-channel chats.
	RegisterChannelViews(ctx context.Context, chatID, userID, upToSeq int64) error
	// ViewCounts returns current view counts for the given message ids.
	ViewCounts(ctx context.Context, ids []int64) (map[int64]int64, error)
	// IncrementForwards bumps a post's forward counter (Telegram message.forwards)
	// by one; called on each forward of the source message.
	IncrementForwards(ctx context.Context, msgID int64) error
	// ClearMediaUnread drops a message's media_unread flag; reports whether the
	// row actually changed.
	ClearMediaUnread(ctx context.Context, msgID int64) (bool, error)
	// ExpiredMessages — просроченные автоудалением (id/chat/seq) для воркера.
	ExpiredMessages(ctx context.Context, limit int) ([]domain.Message, error)
	// SetWebPage пишет серверное превью ссылки (messages.web_page) отдельным
	// UPDATE после коммита отправки (Insert превью не несёт — оно догоняющее).
	SetWebPage(ctx context.Context, msgID int64, wp *domain.WebPagePreview) error
}

// LinkPreviewer строит превью ссылки (og-теги страницы) для карточки web page
// под текстовым сообщением. Опционален — без него превью отключены.
type LinkPreviewer interface {
	Preview(ctx context.Context, url string) (*domain.WebPagePreview, error)
}

type UpdateRepo interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
	GetUserState(ctx context.Context, userID int64) (domain.UserState, error)
	UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.Update, error)
}

type ChannelRepo interface {
	// AppendUpdate bumps the channel's pts by 1 and records the update; returns the new pts.
	AppendUpdate(ctx context.Context, channelID int64, payload json.RawMessage) (int64, error)
	UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error)
	CurrentPts(ctx context.Context, channelID int64) (int64, error)
}

type SearchRepo interface {
	SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) // public only
	SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error)
	PublicChatByUsername(ctx context.Context, username string) (int64, error) // domain.ErrNotFound
}

type ReactionRepo interface {
	Add(ctx context.Context, messageID, userID int64, emoji string) error
	Remove(ctx context.Context, messageID, userID int64, emoji string) error
	// ReactionsFor batch-loads aggregated reaction counts for messages (history
	// read model). Mine is set when viewerID reacted with that emoji. Messages
	// without reactions are simply absent from the map.
	ReactionsFor(ctx context.Context, messageIDs []int64, viewerID int64) (map[int64][]domain.ReactionCount, error)
	// ReactionUsers lists who reacted to a message (with which emoji), oldest first,
	// hydrated with the user card for display — for the who-reacted popup.
	ReactionUsers(ctx context.Context, messageID int64) ([]domain.ReactionUser, error)
}

// StarReactionRepo — платные ⭐-реакции сообщений (star_reactions). Вклад
// пользователя накопительный (upsert), агрегат сообщения = SUM(stars).
type StarReactionRepo interface {
	// Add накопительно добавляет delta звёзд от userID к messageID (upsert) и
	// обновляет флаг anonymous; возвращает новый суммарный вклад пользователя.
	Add(ctx context.Context, messageID, userID, delta int64, anonymous bool) (int64, error)
	// AggregatesFor батч-загружает агрегат звёзд по сообщениям (Total) + личный
	// вклад зрителя (Mine). Сообщения без платных реакций отсутствуют в мапе.
	AggregatesFor(ctx context.Context, messageIDs []int64, viewerID int64) (map[int64]domain.StarReactionAgg, error)
	// TopSenders — крупнейшие отправители звёзд сообщения (по убыванию), с
	// карточкой пользователя для отображения. Anonymous сохраняется во флаге.
	TopSenders(ctx context.Context, messageID int64, limit int) ([]domain.StarReactionSender, error)
}

type MediaAccessRepo interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error) // domain.ErrNotFound if absent
	CanAccess(ctx context.Context, userID, mediaID int64) (bool, error)
	// DimsByIDs batch-loads width/height/mime for media ids (history read model,
	// so the client can reserve the media box before the bytes load). Missing ids
	// are simply absent from the map.
	DimsByIDs(ctx context.Context, ids []int64) (map[int64]MediaDims, error)
}

// MediaDims is the media metadata the message read model attaches so the client
// can render a media bubble fully from the message — no per-media meta request.
type MediaDims struct {
	Width    int
	Height   int
	Mime     string
	Blur     []byte // blur preview bytes (JSON-encoded as base64, LQIP placeholder)
	HasThumb bool
	Duration int
	Size     int64
	FileName string
}

type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// StickerAccess отвечает, принадлежит ли media какому-либо стикеру: наборы
// публичны, поэтому такое media можно отправлять (type 'sticker') и читать не
// владельцу. Опционален — без него действует старое правило «только своё media».
type StickerAccess interface {
	IsStickerMedia(ctx context.Context, mediaID int64) (bool, error)
}

// SecretRepo хранит handshake секретных чатов (только публичные ключи + статус).
type SecretRepo interface {
	Create(ctx context.Context, sc domain.SecretChat) error
	Accept(ctx context.Context, chatID int64, responderPub []byte) error
	SetState(ctx context.Context, chatID int64, state string) error
	Get(ctx context.Context, chatID int64) (domain.SecretChat, error)
}

// DraftRepo хранит облачные черновики (по одному на пару чат+пользователь).
type DraftRepo interface {
	Upsert(ctx context.Context, userID int64, d domain.Draft) (domain.Draft, error)
	Delete(ctx context.Context, chatID, userID int64) (bool, error) // false — черновика не было
	ListByUser(ctx context.Context, userID int64) ([]domain.Draft, error)
	DeleteAllByUser(ctx context.Context, userID int64) ([]int64, error) // chat_id удалённых
}

// PrivacyChecker решает вопросы конфиденциальности (usecase/privacy): может ли
// viewer писать/звонить/приглашать owner'а, видит ли его фото. Опционален —
// без него ограничения не применяются.
type PrivacyChecker interface {
	Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error)
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)
}

type ChannelPublisher interface {
	PublishToChannel(ctx context.Context, channelID int64, frame []byte) error
}

type PushNotifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}

// --- DTOs ---

type SendInput struct {
	ChatID, SenderID int64
	Type, Text       string
	Entities         []domain.MessageEntity
	ReplyToID        *int64
	// Ответ с цитатой фрагмента (Telegram reply quote): выделенный кусок текста
	// оригинала + его offset (UTF-16). Применяется только при ReplyToID != nil.
	ReplyQuoteText   *string
	ReplyQuoteOffset *int
	ClientMsgID      string
	MediaID          *int64
	ThreadRootID     *int64
	GroupedID        string // альбом (Telegram grouped_id); "" — не в группе
	PollID           *int64 // опрос (messages.poll_id) — только из SendPoll
	ChecklistID      *int64 // чек-лист (messages.checklist_id) — только из SendChecklist
	GiveawayID       *int64 // розыгрыш (messages.giveaway_id) — только из CreateGiveaway
	// Гео-точка (type 'geo'): обе координаты обязательны, в валидном диапазоне.
	GeoLat *float64
	GeoLng *float64
	// Расширение гео: venue (title/address) и live location (live_period сек,
	// heading 0..359). Пусто → обычная геометка.
	GeoTitle      *string
	GeoAddress    *string
	GeoLivePeriod *int
	GeoHeading    *int
	// Контакт (type 'contact'): имя/телефон гидрируются сервером по аккаунту.
	ContactUserID *int64
	// Подарок (type 'gift'): ссылка на выданный подарок — только из SendGift.
	GiftID *int64
	// Клавиатура сообщения (inline/reply) — у ответов бота.
	ReplyMarkup *domain.ReplyMarkup
	// E2E-шифртекст (type 'encrypted'): iv||ciphertext. Text/Entities пустые.
	EncBody []byte
	// Self-destruct TTL (сек) для секретного сообщения; nil — без самоуничтожения.
	TTLSeconds *int
	// Тихая отправка (Telegram disable_notification): подавляет push/звук у получателя.
	// Не хранится на сообщении (MVP) — влияет только на нотификатор, не на realtime-доставку.
	Silent bool
	// Effect — вид полноэкранного эффекта сообщения (наш аналог Telegram message
	// effects); санитизируется по whitelist. "" — без эффекта.
	Effect string
	// PaidMediaPrice — цена доступа к медиа в звёздах (Telegram paid media). nil/<=0
	// — обычное медиа. Применяется только к фото/видео с прикреплённым MediaID:
	// получатели видят медиа заблокированным до разблокировки за звёзды.
	PaidMediaPrice *int64
}

// GroupCallStore хранит участников активных групповых звонков (эфемерно, Redis).
type GroupCallStore interface {
	Join(ctx context.Context, chatID, userID int64) error
	Leave(ctx context.Context, chatID, userID int64) error
	Participants(ctx context.Context, chatID int64) ([]int64, error)
}

// TopicRepo хранит темы форум-групп.
type TopicRepo interface {
	Create(ctx context.Context, t domain.ForumTopic) (domain.ForumTopic, error)
	ByID(ctx context.Context, id int64) (domain.ForumTopic, error)
	SetClosed(ctx context.Context, id int64, closed bool) error
	EditTopic(ctx context.Context, id int64, title, iconEmoji string, iconColor int) error
	SetHidden(ctx context.Context, id int64, hidden bool) error
	SetPinned(ctx context.Context, id int64, pinned bool) error
	EnsureGeneralTopic(ctx context.Context, chatID, createdBy int64) (domain.ForumTopic, error)
	// ListByChat — темы чата с per-topic состоянием для зрителя userID
	// (unread/mentions/mute/last_out считаются относительно него).
	ListByChat(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error)
	// SetTopicRead поднимает last_read_seq темы до max(old, upToSeq) (UPSERT).
	SetTopicRead(ctx context.Context, chatID, rootMsgID, userID, upToSeq int64) error
	// SetTopicMuted включает/выключает mute темы (UPSERT).
	SetTopicMuted(ctx context.Context, chatID, rootMsgID, userID int64, muted bool) error
}

// ScheduledRepo хранит очередь запланированных сообщений.
type ScheduledRepo interface {
	Create(ctx context.Context, m domain.ScheduledMessage) (domain.ScheduledMessage, error)
	ListByChat(ctx context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error)
	CountByUser(ctx context.Context, senderID int64) (int, error)
	ByID(ctx context.Context, id int64) (domain.ScheduledMessage, error)
	Delete(ctx context.Context, id int64) error
	Due(ctx context.Context, now time.Time, limit int) ([]domain.ScheduledMessage, error)
}

// PollRepo хранит опросы и голоса.
type PollRepo interface {
	Create(ctx context.Context, p domain.Poll) (domain.Poll, error)
	ByID(ctx context.Context, id int64) (domain.Poll, error)
	// SetVotes заменяет голос пользователя целиком (пустой список = отзыв).
	SetVotes(ctx context.Context, pollID, userID int64, optionIdxs []int) error
	HasVoted(ctx context.Context, pollID, userID int64) (bool, error)
	Close(ctx context.Context, pollID int64) error
	// Info — представление опроса для зрителя (агрегаты + его выбор).
	Info(ctx context.Context, pollID, viewerID int64) (domain.PollInfo, error)
}

// ChecklistRepo хранит чек-листы и отметки «выполнено».
type ChecklistRepo interface {
	Create(ctx context.Context, c domain.Checklist) (domain.Checklist, error)
	ByID(ctx context.Context, id int64) (domain.Checklist, error)
	// SetItems заменяет список пунктов целиком (при добавлении пунктов).
	SetItems(ctx context.Context, checklistID int64, items []domain.ChecklistItem) error
	// ToggleMark переключает отметку пользователя на пункте (true — отмечено).
	ToggleMark(ctx context.Context, checklistID int64, itemID int, userID int64) (bool, error)
	// Info — представление чек-листа (пункты + кто отметил каждый).
	Info(ctx context.Context, checklistID int64) (domain.ChecklistInfo, error)
}

// StarsRepo — баланс звёзд и каталог/выдача подарков.
type StarsRepo interface {
	// Balance — текущий баланс звёзд (0, если строки ещё нет).
	Balance(ctx context.Context, userID int64) (int64, error)
	// AddBalance атомарно меняет баланс на delta (может быть отрицательной);
	// возвращает новый баланс. При недостатке средств — domain.ErrForbidden.
	AddBalance(ctx context.Context, userID, delta int64) (int64, error)
	// Catalog — доступные для покупки подарки (без распроданных сверху).
	Catalog(ctx context.Context) ([]domain.StarGift, error)
	// GiftByID — позиция каталога по id.
	GiftByID(ctx context.Context, giftID int64) (domain.StarGift, error)
	// DecRemains уменьшает остаток ограниченного подарка (no-op у безлимитных).
	DecRemains(ctx context.Context, giftID int64) error
	// SaveGift выдаёт подарок получателю, возвращает id записи saved_star_gifts.
	SaveGift(ctx context.Context, ownerID int64, fromID *int64, giftID int64, message string, anonymous bool) (int64, error)
	// GiftInfo — выданный подарок для зрителя (с раскрытием отправителя).
	GiftInfo(ctx context.Context, savedID, viewerID int64) (domain.GiftInfo, error)
	// ProfileGifts — подарки в профиле пользователя (не скрытые, не обменянные;
	// владелец видит скрытые тоже).
	ProfileGifts(ctx context.Context, ownerID, viewerID int64) ([]domain.GiftInfo, error)
	// SetHidden показывает/скрывает подарок в профиле (только владелец).
	SetHidden(ctx context.Context, savedID, ownerID int64, hidden bool) error
	// Convert обменивает подарок на звёзды владельцу: помечает converted и
	// возвращает число возвращённых звёзд. Повтор/чужой → domain.ErrForbidden.
	Convert(ctx context.Context, savedID, ownerID int64) (int64, error)
}

// BoostRepo хранит бусты каналов (channel_boosts). Активны бусты с
// expires_at > now().
type BoostRepo interface {
	// ActiveBoosts — сумма slots всех активных бустов канала.
	ActiveBoosts(ctx context.Context, chatID int64) (int, error)
	// UserActiveSlots — сколько слотов пользователь потратил (все каналы).
	UserActiveSlots(ctx context.Context, userID int64) (int, error)
	// Boost добавляет/обновляет буст пользователя на канал.
	Boost(ctx context.Context, chatID, userID int64, slots int, expiresAt time.Time) error
	// BoostedByMe — есть ли активный буст пользователя на этот канал.
	BoostedByMe(ctx context.Context, chatID, userID int64) (bool, error)
}

// GiveawayRepo хранит розыгрыши и участников (giveaways / giveaway_participants).
type GiveawayRepo interface {
	Create(ctx context.Context, g domain.Giveaway) (domain.Giveaway, error)
	ByID(ctx context.Context, id int64) (domain.Giveaway, error)
	// Participate добавляет участника (идемпотентно).
	Participate(ctx context.Context, giveawayID, userID int64) error
	IsParticipant(ctx context.Context, giveawayID, userID int64) (bool, error)
	ParticipantCount(ctx context.Context, id int64) (int, error)
	ParticipantIDs(ctx context.Context, id int64) ([]int64, error)
	// Finish помечает розыгрыш завершённым и сохраняет победителей.
	Finish(ctx context.Context, id int64, winnerIDs []int64) error
}

// SuggestedPostRepo хранит предложенные в канал посты (таблица suggested_posts).
type SuggestedPostRepo interface {
	Create(ctx context.Context, sp domain.SuggestedPost) (domain.SuggestedPost, error)
	ByID(ctx context.Context, id int64) (domain.SuggestedPost, error)
	// ListPending — все ожидающие решения посты канала (для админа), новые сверху.
	ListPending(ctx context.Context, chatID int64) ([]domain.SuggestedPost, error)
	// ListByAuthor — предложки автора в канале (любой статус), новые сверху.
	ListByAuthor(ctx context.Context, chatID, authorID int64) ([]domain.SuggestedPost, error)
	// Decide переводит pending→status (approved|rejected), фиксируя решившего/время
	// и назначенное время публикации (publishAt для отложенной публикации). Возвращает
	// обновлённую запись; domain.ErrNotFound, если поста нет или он уже решён.
	Decide(ctx context.Context, id int64, status string, decidedBy int64, publishAt *time.Time) (domain.SuggestedPost, error)
	// MarkPublished сбрасывает publish_at у опубликованного одобренного поста, чтобы
	// воркер отложенной публикации не опубликовал его повторно.
	MarkPublished(ctx context.Context, id int64) error
	// DuePublish — одобренные посты с наступившим временем публикации (для воркера).
	DuePublish(ctx context.Context, now time.Time, limit int) ([]domain.SuggestedPost, error)
}

// PremiumRepo читает/выдаёт premium-статус (для бустов и premium-приза).
type PremiumRepo interface {
	IsPremium(ctx context.Context, userID int64) (bool, error)
	GrantPremium(ctx context.Context, userID int64) error
}

// PaidMediaRepo — цена платного медиа сообщения и разблокировки за Stars.
type PaidMediaRepo interface {
	// SetPrice помечает медиа сообщения платным с ценой price (звёзды).
	SetPrice(ctx context.Context, messageID, price int64) error
	// PricesByIDs — цены платного медиа для сообщений (без цены — отсутствуют).
	PricesByIDs(ctx context.Context, ids []int64) (map[int64]int64, error)
	// UnlockedByIDs — какие из сообщений пользователь уже разблокировал.
	UnlockedByIDs(ctx context.Context, userID int64, ids []int64) (map[int64]bool, error)
	// Unlock записывает разблокировку (message,user); true — если запись новая.
	Unlock(ctx context.Context, messageID, userID int64) (bool, error)
	// LockedMedia — закрыто ли медиа платным баром для пользователя (гейт байтов).
	LockedMedia(ctx context.Context, userID, mediaID int64) (bool, error)
}

// BotRepo — данные ботов: флаг is_bot и список команд.
type BotRepo interface {
	IsBot(ctx context.Context, userID int64) (bool, error)
	Commands(ctx context.Context, botID int64) ([]domain.BotCommand, error)
}

// BotAPIRepo — хранилище Bot API: учётки/токены ботов, очередь апдейтов,
// mini-app'ы и состояние мастера BotFather.
type BotAPIRepo interface {
	// CreateBot заводит пользователя-бота (is_bot) и его учётку с токеном.
	CreateBot(ctx context.Context, ownerID int64, name, username string) (domain.BotAccount, error)
	BotByToken(ctx context.Context, token string) (domain.BotAccount, error)
	BotByID(ctx context.Context, botID int64) (domain.BotAccount, error)
	BotsByOwner(ctx context.Context, ownerID int64) ([]domain.BotAccount, error)
	UsernameTaken(ctx context.Context, username string) (bool, error)
	SetWebhook(ctx context.Context, botID int64, url string) error
	SetMenuButton(ctx context.Context, botID int64, text, url string) error
	RegenToken(ctx context.Context, botID int64) (string, error)
	SetCommands(ctx context.Context, botID int64, scope, lang string, cmds []domain.BotCommand) error
	CommandsScoped(ctx context.Context, botID int64, scope, lang string) ([]domain.BotCommand, error)
	// профиль и inline-настройки
	SetProfile(ctx context.Context, botID int64, description, about *string) error
	SetInline(ctx context.Context, botID int64, enabled bool, placeholder string) error
	SetAvatar(ctx context.Context, botID, mediaID int64) error
	// CloudStorage mini-app (ключ-значение на пару бот+пользователь)
	CloudGet(ctx context.Context, botID, userID int64, keys []string) (map[string]string, error)
	CloudSet(ctx context.Context, botID, userID int64, key, value string) error
	CloudRemove(ctx context.Context, botID, userID int64, keys []string) error
	CloudKeys(ctx context.Context, botID, userID int64) ([]string, error)
	// EnqueueUpdate кладёт апдейт в очередь бота, возвращает его update_id.
	EnqueueUpdate(ctx context.Context, botID int64, payload []byte) (int64, error)
	// PullUpdates подтверждает предыдущую пачку (offset) и возвращает новые.
	PullUpdates(ctx context.Context, botID, offset int64, limit int) ([]domain.BotUpdate, error)
	// mini-app'ы
	CreateApp(ctx context.Context, app domain.BotApp) error
	AppByShortName(ctx context.Context, botID int64, shortName string) (domain.BotApp, error)
	AppsByBot(ctx context.Context, botID int64) ([]domain.BotApp, error)
	// мастер BotFather
	WizardGet(ctx context.Context, userID int64) (domain.BotWizard, error)
	WizardSet(ctx context.Context, w domain.BotWizard) error
	WizardClear(ctx context.Context, userID int64) error
	// UserBrief — username/имя пользователя для поля from в апдейтах.
	UserBrief(ctx context.Context, id int64) (username, firstName string, err error)
}

// Translator переводит текст на целевой язык (source определяется провайдером
// автоматически). Реализуется адаптером к LibreTranslate-совместимому сервису.
// Опционален — без него перевод сообщений отключён.
type Translator interface {
	Translate(ctx context.Context, text, toLang string) (translated, detectedSource string, err error)
}

// BotMediaStore сохраняет медиа, загруженное ботом (sendPhoto/Document/Video):
// пишет объект в хранилище от имени бота-владельца и возвращает media_id.
// Опционален — без него медиа-методы Bot API отключены.
type BotMediaStore interface {
	Store(ctx context.Context, ownerID int64, mime, fileName string, data []byte) (int64, error)
}

type HistoryResult struct {
	Messages []domain.Message
	Count    int
}

type Difference struct {
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	State        domain.UserState  `json:"state"`
	Slice        bool              `json:"slice"`
	TooLong      bool              `json:"too_long"`
}

const (
	syncLimit        = 500
	tooLongThreshold = 2000
	maxEmojiLen      = 32
	presenceTTL      = 35 * time.Second // (kept here only if needed; presence stays in its package)
)
