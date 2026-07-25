package domain

// CallLogEntry — запись журнала звонков (вкладка «Звонки»). Агрегирует
// сообщения type='call' из личных чатов пользователя, обогащённые собеседником.
// Out — исходящий (инициатор — сам пользователь). Text — JSON лога звонка
// {video, reason, duration} (парсится клиентом, как в чат-бабле). Date — RFC3339.
type CallLogEntry struct {
	ID         int64  `json:"id"`
	ChatID     int64  `json:"chat_id"`
	PeerID     int64  `json:"peer_id"`
	PeerName   string `json:"peer_name"`
	PeerAvatar string `json:"peer_avatar,omitempty"`
	Out        bool   `json:"out"`
	Text       string `json:"text"`
	Date       string `json:"date"`
}
