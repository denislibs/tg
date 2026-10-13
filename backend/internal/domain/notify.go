package domain

import "time"

// NotifyTypeSettings — настройки уведомлений для одного типа чатов (tweb:
// PeerNotifySettings у notifyUsers/notifyChats/notifyBroadcasts).
// Muted — уведомления выключены; Preview — показывать текст сообщения
// («Message Preview»), иначе пуш приходит без содержимого.
type NotifyTypeSettings struct {
	Muted   bool
	Preview bool
}

// NotifySettings — глобальные настройки уведомлений пользователя по типам
// чатов. Per-chat mute (chat_members) имеет приоритет, тип — fallback.
type NotifySettings struct {
	Private  NotifyTypeSettings
	Groups   NotifyTypeSettings
	Channels NotifyTypeSettings
}

// DefaultNotifySettings — все уведомления включены, превью показывается
// (как в Telegram у нового аккаунта).
func DefaultNotifySettings() NotifySettings {
	on := NotifyTypeSettings{Muted: false, Preview: true}
	return NotifySettings{Private: on, Groups: on, Channels: on}
}

// ForChatType возвращает настройки для типа чата ('private'/'saved' →
// личные, 'group' → группы, 'channel' → каналы).
func (s NotifySettings) ForChatType(chatType string) NotifyTypeSettings {
	switch chatType {
	case "group":
		return s.Groups
	case "channel":
		return s.Channels
	default:
		return s.Private
	}
}

// NotifyType — адрес глобальных настроек: тип чатов в терминах схемы TL
// (NotifyPeer: notifyUsers / notifyChats / notifyBroadcasts). Значение — сам
// дискриминатор `_`, он же ключ `?peer=` ручки /me/notify_settings.
type NotifyType string

const (
	NotifyTypeUsers      NotifyType = NotifyUsersTag
	NotifyTypeChats      NotifyType = NotifyChatsTag
	NotifyTypeBroadcasts NotifyType = NotifyBroadcastsTag
)

// ParseNotifyType разбирает дискриминатор; неизвестный — false (ручка отвечает 400).
func ParseNotifyType(s string) (NotifyType, bool) {
	switch t := NotifyType(s); t {
	case NotifyTypeUsers, NotifyTypeChats, NotifyTypeBroadcasts:
		return t, true
	}
	return "", false
}

// ForType — настройки типа чатов: личные / группы / каналы.
func (s NotifySettings) ForType(t NotifyType) NotifyTypeSettings {
	switch t {
	case NotifyTypeChats:
		return s.Groups
	case NotifyTypeBroadcasts:
		return s.Channels
	default:
		return s.Private
	}
}

// PeerNotifySettings — настройки типа в форме конструктора схемы. Хранилище
// держит мьют типа булевым, поэтому «замьючен» выражается сроком
// MuteUntilForever, а «включен» — явным нулём MuteUntilNever (не отсутствием
// ключа: у типа нет настройки выше, на которую можно сослаться). Превью — всегда
// явное значение.
func (t NotifyTypeSettings) PeerNotifySettings() PeerNotifySettings {
	until := int64(MuteUntilNever)
	if t.Muted {
		until = MuteUntilForever
	}
	preview := t.Preview
	return NewPeerNotifySettings(time.Unix(until, 0), &preview, nil)
}

// InputPeerNotifySettingsTag — дискриминатор `_` тела account.updateNotifySettings.
const InputPeerNotifySettingsTag = "inputPeerNotifySettings"

// InputPeerNotifySettings — тело account.updateNotifySettings:
//
//	inputPeerNotifySettings#cacb6ae2 flags:# show_previews:flags.0?Bool
//	silent:flags.1?Bool mute_until:flags.2?int sound:flags.3?NotificationSound …
//
// Принимаем два поля, которые есть у настроек типа в хранилище: show_previews и
// mute_until. nil — «поле не передано, не менять». Мьют типа булев, поэтому
// любое будущее mute_until сохраняется как «навсегда» (MuteUntilForever).
type InputPeerNotifySettings struct {
	Underscore   string `json:"_,omitempty"`
	ShowPreviews *bool  `json:"show_previews,omitempty"`
	MuteUntil    *int64 `json:"mute_until,omitempty"`
}

// ChatMuted — заглушён ли чат В ЭТОТ МОМЕНТ с учётом типа. Три состояния
// мьюта чата, как у темы (TopicMuted): until == nil — мьют не задан, чат
// наследует тип (typeMuted); иначе решает сам срок — 0 («уведомлять») или
// истёкший срок перекрывают заглушённый тип. tweb appNotificationsManager.ts:
// 342-384: настройки типа подставляются только в неопределённые поля пира;
// togglePeerMute (appMessagesManager.ts:11985-11991) снимает мьют явным
// mute_until: 0, и на истечении срока checkMuteUntil пишет тот же 0 (:187-190).
func ChatMuted(until *time.Time, typeMuted bool, now time.Time) bool {
	return TopicMuted(until, typeMuted, now)
}
