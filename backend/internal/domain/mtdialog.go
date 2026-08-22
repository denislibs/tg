package domain

import (
	"encoding/json"
	"time"
)

// Диалоги в форме оригинала — конструкторы схемы TL (MTProto), а не плоская
// строка витрины `domain.DialogRecord` на тридцать полей.
//
// Продолжение mtpeer.go и mtchat.go: правила фазы 0 (дискриминатор `_`, pFlags
// вместо flags, «выключено» это отсутствие ключа, у каждого конструктора своя
// структура) — в шапке mtpeer.go. Разбор подсистемы и принятые решения —
// docs/readiness/tl-dialogs-analysis.md.
//
// ── Главное расхождение: диалог не держит в себе ни чат, ни сообщение ───────
// Наш DialogRecord слил ТРИ объекта схемы в одну строку: собственно диалог
// (горизонты чтения, счётчики, закрепление), чат/пользователя (title, username,
// photo, is_forum) и выжимку последнего сообщения (last_text, last_sender_name,
// last_type…). В схеме это КОНТЕЙНЕР — messages.dialogs{dialogs, messages,
// chats, users}: сам `dialog` адресует последнее сообщение ЧИСЛОМ
// (top_message), а объекты едут своими векторами и разрешаются по ссылке
// (tweb appMessagesManager.ts:3588 — getMessageByPeer(peerId, top_message)).
//
// Из этого следовали почти все дефекты разбора: превью в списке чатов не имело
// ни сущностей, ни реплая, ни альбома, а имя автора последнего сообщения
// склеивал СЕРВЕР (last_sender_name) — последний живой экземпляр той самой
// болезни, которую у пиров снял уход display_name (решение №7 разбора пиров).
//
// ── Мьют — срок, а не булево (решение Р4) ───────────────────────────────────
// На проводе у нас было `muted: bool`, и это тот же дефект, что у присутствия:
// признак без срока годности. В схеме мьют выражает peerNotifySettings.
// mute_until, «навсегда» — MuteUntilForever, «снять» — 0. Цепочка у нас уже
// была построена целиком (UI предлагает «на час», клиент шлёт срок, бэкенд
// хранит muted_until), провод её и терял: «заглушить на 1 час» работало как
// «навсегда». Предикат «замьючен ли сейчас» здесь ОДИН — PeerNotifySettings.
// Muted; пять копий SQL-условия сводятся к нему на шаге B.
//
// ── Чего в этом порту нет и почему (решение Р10) ────────────────────────────
// Пропуски названы, а не забыты — молчаливый пропуск и есть тот способ, каким
// поля уходили из модели:
//
//   - draft (flags.1?DraftMessage) — предмет ЕСТЬ, но живёт своей ручкой
//     /drafts и своим стором, уже участвующим в сортировке списка. Внести поле,
//     не объединив хранилища, значит завести второй источник истины — ровно то,
//     ради устранения чего программа и существует. Объединение — отдельный шаг;
//   - pts (flags.0?int) — предмет есть (domain.UpdateRecord.Pts), но живёт в журнале
//     апдейтов, а не в диалоге;
//   - pFlags.unread_mark — «отметить непрочитанным» не реализовано ни на одной
//     стороне: ни колонки, ни ручки, ни пункта меню;
//   - pFlags.view_forum_as_messages — предмета нет;
//   - unread_poll_votes_count — предмета нет (непрочитанных голосов не считаем),
//     и параметр ОБЯЗАТЕЛЬНЫЙ: на фазе 2 он станет заглушкой-нулём на проводе
//     (см. «нет предмета перестаёт быть бесплатным» в tl-program.md), а не
//     полем модели;
//   - messages.dialogsNotModified — ответ «список не изменился» по хэшу
//     запроса; хэш-кэширования запросов у нас нет вовсе.

// ── Dialog: dialog | dialogFolder ───────────────────────────────────────────

// Dialog — объединение схемы: dialog | dialogFolder.
type Dialog interface {
	isDialog()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// PeerID — знаковый ключ пира диалога (решение №1 разбора пиров).
	PeerID() PeerID
}

// Значения дискриминатора `_` объединения Dialog.
const (
	DialogTag       = "dialog"
	DialogFolderTag = "dialogFolder"
)

// dialog#fc89f7f3 flags:# pinned:flags.2?true unread_mark:flags.3?true
// view_forum_as_messages:flags.6?true peer:Peer top_message:int
// read_inbox_max_id:int read_outbox_max_id:int unread_count:int
// unread_mentions_count:int unread_reactions_count:int
// unread_poll_votes_count:int notify_settings:PeerNotifySettings
// pts:flags.0?int draft:flags.1?DraftMessage folder_id:flags.4?int
// ttl_period:flags.5?int = Dialog;
//
// СТРОКА списка чатов в форме оригинала: состояние чтения и место в списке, и
// ничего больше. Ни имени, ни аватарки, ни текста последнего сообщения здесь
// нет по схеме — они едут векторами chats/users/messages контейнера.
//
// Имя структуры с суффиксом Real: `Dialog` — имя ОБЪЕДИНЕНИЯ (тот же приём, что
// у UserReal/ChatReal/PhotoSizeReal/KeyboardButtonReal). Прежняя плоская
// выборка переименована в DialogRecord — она сознательно НЕ объект провода
// (решение Р2, прецедент UserRecord/ChatRecord).
type DialogReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Peer       Peer            `json:"peer"`
	// TopMessage — ПОСЛЕДНЕЕ сообщение чата, адресованное числом. Это seq в
	// нашей нумерации (int64, как ReadInboxMaxID у channelFull): выжимки
	// last_text/last_type/last_sender_name на проводе больше нет, объект едет
	// вектором messages контейнера и разрешается по ссылке.
	TopMessage int64 `json:"top_message"`
	// ReadInboxMaxID — горизонт чтения ЗРИТЕЛЯ (наш last_read_seq),
	// ReadOutboxMaxID — горизонт другой стороны (для галочек «прочитано»).
	ReadInboxMaxID  int64 `json:"read_inbox_max_id"`
	ReadOutboxMaxID int64 `json:"read_outbox_max_id"`
	// Счётчики бейджей. Обязательны по схеме и едут даже нулевыми.
	UnreadCount          int `json:"unread_count"`
	UnreadMentionsCount  int `json:"unread_mentions_count"`
	UnreadReactionsCount int `json:"unread_reactions_count"`
	// NotifySettings — обязателен по схеме: «настроек нет» выражается пустым
	// конструктором (ни одного flags-параметра), а не отсутствием поля.
	NotifySettings PeerNotifySettings `json:"notify_settings"`
	// FolderID — flags.4?int: 0 — «все чаты», 1 — архив (решение Р5). Прежний
	// `archived: bool` исчез. Ноль ключа не даёт: незаархивированный диалог у
	// оригинала едет без folder_id вовсе, и «папка не указана» это ОТСУТСТВИЕ
	// значения, а не третий член перечисления (tweb GLOBAL_FOLDER_ID =
	// undefined, storages/dialogs.ts:68). Значения совпадают с domain.FolderID
	// ровно потому, что выдуманного третьего члена там больше нет.
	FolderID int `json:"folder_id,omitempty"`
	// TTLPeriod — flags.5?int: наш auto_delete_period в секундах (решение Р6);
	// 0 — автоудаление выключено.
	TTLPeriod int `json:"ttl_period,omitempty"`
	// Secret — НАШ СОБСТВЕННЫЙ параметр вне схемы (решение Р9): секретный чат.
	// Места в схеме у него нет и придумывать его не надо — секретные чаты это
	// объединение EncryptedChat, отдельная подсистема ВНЕ периметра порта
	// (решение от 2026-08-19). Признак остаётся потому, что живых гейтов по нему
	// больше десятка (расшифровка превью, вычистка текста перед записью на диск,
	// исключение из пересылки), и молча уронить их значит сломать работающую
	// функцию. Объявлен штатным механизмом клиентских параметров —
	// schema/schema_additional_params.json, предикат `dialog`, — а не подмешан в
	// схемное поле: сверщик обязан видеть, что это НАШ ключ.
	Secret bool `json:"secret,omitempty"`
}

func (DialogReal) isDialog()        {}
func (d DialogReal) Tag() string    { return d.Underscore }
func (d DialogReal) PeerID() PeerID { return GetPeerID(d.Peer) }
func (d DialogReal) Pinned() bool   { return d.PFlags["pinned"] }

// dialogFlagNames — что keepPFlags пропускает в модель на разборе. Здесь ровно
// один флаг: unread_mark и view_forum_as_messages предмета не имеют (см. шапку),
// а флаг, которого в этом списке нет, из чужого кадра в модель не попадёт.
var dialogFlagNames = []string{"pinned"}

// NewDialog собирает строку списка чатов. Обязательные по схеме параметры —
// в аргументах, остальное присваивается полями (приём NewChannelFull):
// у диалога необязательных параметров больше, чем обязательных.
func NewDialog(peer Peer, topMessage int64, notify PeerNotifySettings, pinned bool) DialogReal {
	d := DialogReal{
		Underscore:     DialogTag,
		Peer:           peer,
		TopMessage:     topMessage,
		NotifySettings: notify,
	}
	setPFlag(&d.PFlags, "pinned", pinned)
	return d
}

func (d *DialogReal) UnmarshalJSON(b []byte) error {
	type plain DialogReal
	var v struct {
		plain
		Peer json.RawMessage `json:"peer"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*d = DialogReal(v.plain)
	d.PFlags = keepPFlags(v.plain.PFlags, dialogFlagNames...)

	peer, err := UnmarshalPeer(v.Peer)
	if err != nil {
		return err
	}
	d.Peer = peer
	return nil
}

// dialogFolder#71bd134c flags:# pinned:flags.2?true folder:Folder peer:Peer
// top_message:int unread_muted_peers_count:int unread_unmuted_peers_count:int
// unread_muted_messages_count:int unread_unmuted_messages_count:int = Dialog;
//
// СТРОКА-ПАПКА в списке чатов: у оригинала архив показывается в общем списке
// собственной строкой со сводными счётчиками. ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ —
// по той же причине и тем же приёмом, что chat/chatForbidden/peerChat: архив у
// нас это выборка запроса (FolderID), а не строка списка, и сводных счётчиков
// «сколько замьюченных пиров в папке» мы не считаем. Структура нужна кодеку
// фазы 2: чужой кадр с dialogFolder в векторе dialogs обязан пережить круг
// разбор → сборка. Конструирующей функции поэтому нет: собрать dialogFolder
// можно только литералом, и это видно в коде.
type DialogFolder struct {
	Underscore                 string          `json:"_"`
	PFlags                     map[string]bool `json:"pFlags,omitempty"`
	Folder                     Folder          `json:"folder"`
	Peer                       Peer            `json:"peer"`
	TopMessage                 int64           `json:"top_message"`
	UnreadMutedPeersCount      int             `json:"unread_muted_peers_count"`
	UnreadUnmutedPeersCount    int             `json:"unread_unmuted_peers_count"`
	UnreadMutedMessagesCount   int             `json:"unread_muted_messages_count"`
	UnreadUnmutedMessagesCount int             `json:"unread_unmuted_messages_count"`
}

func (DialogFolder) isDialog()        {}
func (d DialogFolder) Tag() string    { return d.Underscore }
func (d DialogFolder) PeerID() PeerID { return GetPeerID(d.Peer) }
func (d DialogFolder) Pinned() bool   { return d.PFlags["pinned"] }

func (d *DialogFolder) UnmarshalJSON(b []byte) error {
	type plain DialogFolder
	var v struct {
		plain
		Peer json.RawMessage `json:"peer"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*d = DialogFolder(v.plain)
	d.PFlags = keepPFlags(v.plain.PFlags, "pinned")

	peer, err := UnmarshalPeer(v.Peer)
	if err != nil {
		return err
	}
	d.Peer = peer
	return nil
}

// FolderTag — дискриминатор `_` конструктора folder.
const FolderTag = "folder"

// folder#ff544e65 flags:# autofill_new_broadcasts:flags.0?true
// autofill_public_groups:flags.1?true autofill_new_correspondents:flags.2?true
// id:int title:string photo:flags.3?ChatPhoto = Folder;
//
// САМА папка-раскладка (у оригинала их ровно две: 0 — все чаты, 1 — архив).
// ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ — существует только затем, чтобы был полон
// объявленный выше dialogFolder: параметр `folder` у него ОБЯЗАТЕЛЬНЫЙ, а
// значит без этой структуры круг «разбор → сборка» чужого кадра не замкнётся.
// Ровно поэтому необязательные чужие конструкторы (notificationSoundLocal,
// notificationSoundRingtone) мы, наоборот, не объявляем: у необязательного
// параметра «нет предмета» бесплатно, у обязательного — нет.
type Folder struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int             `json:"id"`
	Title      string          `json:"title"`
	Photo      ChatPhoto       `json:"photo,omitempty"`
}

// folderFlagNames — что keepPFlags пропускает в модель на разборе.
var folderFlagNames = []string{"autofill_new_broadcasts", "autofill_public_groups", "autofill_new_correspondents"}

func (f *Folder) UnmarshalJSON(b []byte) error {
	type plain Folder
	var v struct {
		plain
		Photo json.RawMessage `json:"photo"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = Folder(v.plain)
	f.PFlags = keepPFlags(v.plain.PFlags, folderFlagNames...)

	photo, err := UnmarshalChatPhoto(v.Photo)
	if err != nil {
		return err
	}
	f.Photo = photo
	return nil
}

// UnmarshalDialog разбирает объединение Dialog по дискриминатору `_`.
// Неизвестный (или отсутствующий) конструктор — nil, nil: строка из чужого
// будущего слоя не должна ронять разбор всего контейнера.
func UnmarshalDialog(raw []byte) (Dialog, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case DialogTag:
		v, err := unmarshalCtor[DialogReal](raw)
		return v, err
	case DialogFolderTag:
		v, err := unmarshalCtor[DialogFolder](raw)
		return v, err
	}
	return nil, nil
}

// ── PeerNotifySettings ──────────────────────────────────────────────────────

// PeerNotifySettingsTag — дискриминатор `_` конструктора peerNotifySettings.
const PeerNotifySettingsTag = "peerNotifySettings"

// MuteUntilForever — «замьючено навсегда». Порт tweb appManagers/constants.ts:15
// (MUTE_UNTIL): у оригинала «навсегда» это не отдельный флаг, а срок в далёком
// будущем — максимум знакового int32, потому что на проводе mute_until это
// `int`. Число обязано совпадать с оригиналом побайтово: клиент по нему
// ОТЛИЧАЕТ «навсегда» от «до такого-то часа» и решает, показывать ли срок
// (tweb appMessagesManager.ts:8826).
const MuteUntilForever = 0x7FFFFFFF

// MuteUntilNever — «не замьючено»: явный нуль, а не отсутствие ключа.
// Отсутствие означает другое — «переопределения для этого пира нет, действует
// настройка типа чата».
const MuteUntilNever = 0

// peerNotifySettings#99622c0c flags:# show_previews:flags.0?Bool
// silent:flags.1?Bool mute_until:flags.2?int ios_sound:flags.3?NotificationSound
// android_sound:flags.4?NotificationSound other_sound:flags.5?NotificationSound
// stories_muted:flags.6?Bool stories_hide_sender:flags.7?Bool
// stories_ios_sound:flags.8?NotificationSound
// stories_android_sound:flags.9?NotificationSound
// stories_other_sound:flags.10?NotificationSound = PeerNotifySettings;
//
// Настройки уведомлений ПИРА (пер-чатное переопределение поверх настроек типа
// чата — domain.NotifySettings). Все параметры необязательные, и отсутствие
// значит «переопределения нет», поэтому поля — указатели: `false` и «не задано»
// это разные ответы, а один bool их склеивает.
//
// Обратить внимание: show_previews/silent объявлены как flags.N?Bool, а НЕ как
// flags.N?true. Это не булевы флаги схемы — их место на верхнем уровне, а не в
// pFlags, и они умеют нести явное false.
//
// Чего нет и почему:
//   - ios_sound/android_sound — звук уведомления для мобильных клиентов; у нас
//     клиент один, веб, и его звук это other_sound;
//   - stories_* (muted, hide_sender, ios/android/other_sound) — подсистемы
//     историй в этом порту нет.
type PeerNotifySettings struct {
	Underscore string `json:"_"`
	// ShowPreviews — показывать ли текст сообщения в уведомлении (наш
	// chat_members.notify_preview). nil — переопределения нет.
	ShowPreviews *bool `json:"show_previews,omitempty"`
	// Silent — уведомлять без звука. Производителя у нас пока нет: беззвучность
	// пер-чата выражается other_sound = notificationSoundNone. Поле объявлено,
	// потому что на нём ветвится предикат Muted (порт оригинала) и потому что
	// чужой кадр его несёт.
	Silent *bool `json:"silent,omitempty"`
	// MuteUntil — unix-секунды, ДО которых молчим: MuteUntilNever — не
	// замьючен, MuteUntilForever — навсегда. nil — переопределения нет.
	// Здесь и чинится дефект разбора: булево «замьючен» срока не имело, и
	// «заглушить на час» работало как «заглушить навсегда».
	MuteUntil *int `json:"mute_until,omitempty"`
	// OtherSound — звук уведомления как ОБЪЕДИНЕНИЕ, а не строка 'default'/'none'
	// (решение Р4): наш chat_members.notify_sound.
	OtherSound NotificationSound `json:"other_sound,omitempty"`
}

// Muted — замьючен ли пир В ЭТОТ МОМЕНТ. Порт tweb appNotificationsManager.ts:255
// (`silent || mute_until * 1000 > tsNow()`): мьют это СРОК, поэтому предикат
// принимает время, а не читает часы сам — иначе его нельзя проверить тестом и
// нельзя посчитать «на момент кадра».
//
// Единственное место, где этот вопрос решается: пять копий SQL-условия
// (`m.muted OR (m.muted_until IS NOT NULL AND m.muted_until > now())` в
// chatsrepo/pushrepo/grouprepo) сводятся сюда на шаге B.
func (s PeerNotifySettings) Muted(now time.Time) bool {
	if s.Silent != nil && *s.Silent {
		return true
	}
	return s.MuteUntil != nil && int64(*s.MuteUntil) > now.Unix()
}

// NewPeerNotifySettings собирает настройки пира. Каждый аргумент умеет означать
// «переопределения нет», и это не то же самое, что «выключено»: нулевое
// muteUntil, nil showPreviews и nil sound снимают соответствующий ключ, и
// действовать будет настройка типа чата (domain.NotifySettings).
//
// «Замьючен навсегда» передаётся как time.Unix(MuteUntilForever, 0) — держать
// второй способ сказать то же самое (булево `forever` рядом со сроком) и есть
// та болезнь, которую снимает решение Р4.
func NewPeerNotifySettings(muteUntil time.Time, showPreviews *bool, sound NotificationSound) PeerNotifySettings {
	s := PeerNotifySettings{Underscore: PeerNotifySettingsTag, ShowPreviews: showPreviews, OtherSound: sound}
	if !muteUntil.IsZero() {
		v := unixSeconds(muteUntil)
		s.MuteUntil = &v
	}
	return s
}

func (s *PeerNotifySettings) UnmarshalJSON(b []byte) error {
	type plain PeerNotifySettings
	var v struct {
		plain
		OtherSound json.RawMessage `json:"other_sound"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = PeerNotifySettings(v.plain)

	sound, err := UnmarshalNotificationSound(v.OtherSound)
	if err != nil {
		return err
	}
	s.OtherSound = sound
	return nil
}

// ── NotificationSound ───────────────────────────────────────────────────────

// NotificationSound — объединение схемы: notificationSoundDefault |
// notificationSoundNone | notificationSoundLocal | notificationSoundRingtone.
//
// Производим первые два — ровно те, у которых есть предмет: наш
// chat_members.notify_sound принимает 'default' и 'none'. Остальные два не
// объявляются вовсе (а не заводятся пустыми): notificationSoundLocal это звук
// из набора системного клиента (title + data), notificationSoundRingtone —
// загруженный пользователем рингтон, адресуемый id документа; ни хранилища
// рингтонов, ни экрана их выбора у нас нет. Параметр other_sound
// НЕОБЯЗАТЕЛЬНЫЙ, поэтому пропуск бесплатен и на фазе 2, а чужой конструктор
// разбор не роняет — UnmarshalNotificationSound отдаёт на него nil, как и
// прочие разборщики объединений.
type NotificationSound interface {
	isNotificationSound()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения NotificationSound.
const (
	NotificationSoundDefaultTag = "notificationSoundDefault"
	NotificationSoundNoneTag    = "notificationSoundNone"
)

// notificationSoundDefault#97e8bebe = NotificationSound;
//
// Звук по умолчанию — наш notify_sound = 'default'.
type NotificationSoundDefault struct {
	Underscore string `json:"_"`
}

func (NotificationSoundDefault) isNotificationSound() {}
func (s NotificationSoundDefault) Tag() string        { return s.Underscore }

func NewNotificationSoundDefault() NotificationSoundDefault {
	return NotificationSoundDefault{Underscore: NotificationSoundDefaultTag}
}

// notificationSoundNone#6f0c34df = NotificationSound;
//
// Без звука — наш notify_sound = 'none'. Это НЕ мьют: уведомление приходит,
// просто молча.
type NotificationSoundNone struct {
	Underscore string `json:"_"`
}

func (NotificationSoundNone) isNotificationSound() {}
func (s NotificationSoundNone) Tag() string        { return s.Underscore }

func NewNotificationSoundNone() NotificationSoundNone {
	return NotificationSoundNone{Underscore: NotificationSoundNoneTag}
}

// UnmarshalNotificationSound разбирает объединение NotificationSound.
func UnmarshalNotificationSound(raw []byte) (NotificationSound, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case NotificationSoundDefaultTag:
		v, err := unmarshalCtor[NotificationSoundDefault](raw)
		return v, err
	case NotificationSoundNoneTag:
		v, err := unmarshalCtor[NotificationSoundNone](raw)
		return v, err
	}
	return nil, nil
}

// ── messages.Dialogs: контейнер списка чатов ────────────────────────────────

// Дискриминаторы `_` контейнеров списка чатов.
const (
	MessagesDialogsTag      = "messages.dialogs"
	MessagesDialogsSliceTag = "messages.dialogsSlice"
)

// messages.dialogs#15ba6c40 dialogs:Vector<Dialog> messages:Vector<Message>
// chats:Vector<Chat> users:Vector<User> = messages.Dialogs;
//
// Список отдан ЦЕЛИКОМ. Поля `count` у этого конструктора НЕТ — и это не
// упущение схемы, а способ сказать «это всё»: клиент оригинала читает
// `count` как необязательное и выводит конец списка из его отсутствия
// (tweb appMessagesManager.ts:3614,3629 — `isEnd = !count || …`). Наш булев
// `DialogPageResult.IsEnd` поэтому уходит: выбор конструктора его выражает
// (решение Р1).
//
// Векторы chats/users на клиенте втекают в уже существующий
// peers.saveApiPeers({chats, users}) — приёмник ровно этой формы появился на
// шаге D пиров.
type MessagesDialogs struct {
	Underscore string   `json:"_"`
	Dialogs    []Dialog `json:"dialogs"`
	// Messages — ВРЕМЕННОЕ МЕСТО СТЫКА, и тип назван так, чтобы это было видно.
	// По схеме здесь Vector<Message>, но проводного конструктора `message` у нас
	// ещё нет: сообщение — своя подсистема программы, domain.Message пока
	// плоская внутренняя запись без единого json-тега, и положить её сюда
	// значило бы отдать наружу ключи `ID`/`ChatID`/`SenderID`. Поэтому вектор
	// наполняет СУЩЕСТВУЮЩИЙ проводной рендерер сообщения (delivery/http,
	// messagesJSON) — уже готовые map'ы, — а тип поля остаётся безымянным ровно
	// до порта сообщения. Начинать его здесь нельзя: контейнер диалогов не место
	// для второй, наспех выдуманной формы сообщения.
	Messages []any      `json:"messages"`
	Chats    []Chat     `json:"chats"`
	Users    []UserReal `json:"users"`
}

// messages.dialogsSlice#71e094f3 count:int dialogs:Vector<Dialog>
// messages:Vector<Message> chats:Vector<Chat> users:Vector<User> =
// messages.Dialogs;
//
// Отдан КУСОК: count — размер полного набора, по нему виртуальный список считает
// высоту и число плейсхолдеров.
type MessagesDialogsSlice struct {
	Underscore string   `json:"_"`
	Count      int      `json:"count"`
	Dialogs    []Dialog `json:"dialogs"`
	// Messages — то же временное место стыка, что у MessagesDialogs.
	Messages []any      `json:"messages"`
	Chats    []Chat     `json:"chats"`
	Users    []UserReal `json:"users"`
}

// NewMessagesDialogs — весь список. Обязательные векторы едут пустыми ([], а не
// null): «ничего не нашлось» это пустой вектор, а не отсутствие параметра.
func NewMessagesDialogs(dialogs []Dialog, messages []any, chats []Chat, users []UserReal) MessagesDialogs {
	return MessagesDialogs{
		Underscore: MessagesDialogsTag,
		Dialogs:    orEmpty(dialogs),
		Messages:   orEmpty(messages),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}

// NewMessagesDialogsSlice — страница списка; count считается по ПОЛНОМУ набору,
// а не по странице.
func NewMessagesDialogsSlice(count int, dialogs []Dialog, messages []any, chats []Chat, users []UserReal) MessagesDialogsSlice {
	return MessagesDialogsSlice{
		Underscore: MessagesDialogsSliceTag,
		Count:      count,
		Dialogs:    orEmpty(dialogs),
		Messages:   orEmpty(messages),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}

// orEmpty — обязательный Vector<T> схемы никогда не едет как null.
func orEmpty[T any](in []T) []T {
	if in == nil {
		return []T{}
	}
	return in
}
