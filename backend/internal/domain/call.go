package domain

// CallLogEntry — запись журнала звонков (вкладка «Звонки»). Агрегирует
// сообщения type='call' из личных чатов пользователя, обогащённые собеседником.
// Out — исходящий (инициатор — сам пользователь). Text — JSON лога звонка
// {video, reason, duration} (парсится клиентом, как в чат-бабле). Date — RFC3339.
type CallLogEntry struct {
	// ID — адрес служебного сообщения о звонке: НОМЕР в чате разговора
	// (пара «пир + номер», как у любого сообщения). Ключ строки messages
	// наружу не выходит.
	ID int64 `json:"id"`
	// ChatID — внутренний чат разговора; наружу не выходит: адрес приватного
	// диалога это PeerID, id собеседника (см. usecase/chat/peeraddr.go).
	ChatID int64 `json:"-"`
	PeerID int64 `json:"peer_id"`
	// Peer — собеседник в форме конструктора `user`. Прежде здесь лежали
	// peer_name и peer_avatar — плоский снимок пользователя рядом с настоящим.
	Peer UserReal `json:"peer"`
	Out  bool     `json:"out"`
	Text string   `json:"text"`
	Date string   `json:"date"`
}
