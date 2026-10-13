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

// WithType возвращает копию, где настройки типа t заменены на v.
func (s NotifySettings) WithType(t NotifyType, v NotifyTypeSettings) NotifySettings {
	switch t {
	case NotifyTypeChats:
		s.Groups = v
	case NotifyTypeBroadcasts:
		s.Channels = v
	default:
		s.Private = v
	}
	return s
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

// Apply накладывает переданные поля на настройки типа; now — для сравнения срока.
func (in InputPeerNotifySettings) Apply(cur NotifyTypeSettings, now time.Time) NotifyTypeSettings {
	if in.ShowPreviews != nil {
		cur.Preview = *in.ShowPreviews
	}
	if in.MuteUntil != nil {
		cur.Muted = *in.MuteUntil > now.Unix()
	}
	return cur
}
