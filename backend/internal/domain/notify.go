package domain

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
