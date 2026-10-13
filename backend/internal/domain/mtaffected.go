package domain

// MessagesAffectedHistoryTag — конструктор ответа deleteHistory.
const MessagesAffectedHistoryTag = "messages.affectedHistory"

// MessagesAffectedHistory — ответ на очистку истории и удаление диалога
// (TL `messages.affectedHistory#b45c69d1 pts:int pts_count:int offset:int`).
//
// Клиент превращает его в местный updatePts (tweb appMessagesManager.ts
// doFlushHistory :6453), поэтому pts — последний pts журнала АКТОРА после
// операции, pts_count — число строк, записанных актору. offset > 0 в оригинале
// означает «повторите запрос»; у нас операция атомарна, offset всегда 0.
type MessagesAffectedHistory struct {
	Underscore string `json:"_"`
	Pts        int64  `json:"pts"`
	PtsCount   int    `json:"pts_count"`
	Offset     int    `json:"offset"`
}

// NewMessagesAffectedHistory — ответ с курсором актора.
func NewMessagesAffectedHistory(pts int64, ptsCount int) MessagesAffectedHistory {
	return MessagesAffectedHistory{Underscore: MessagesAffectedHistoryTag, Pts: pts, PtsCount: ptsCount}
}
