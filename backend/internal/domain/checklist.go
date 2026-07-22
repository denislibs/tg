package domain

// ChecklistItem — пункт чек-листа (Telegram todoItem): стабильный id + текст.
// id последовательные в рамках чек-листа (нужны для отметок и добавления).
type ChecklistItem struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
}

// Checklist — чек-лист (Telegram todo list / messageMediaToDo): заголовок +
// список пунктов + флаги прав. Хранится отдельно от сообщения; сообщение типа
// 'checklist' ссылается на него через messages.checklist_id.
type Checklist struct {
	ID            int64
	ChatID        int64
	Title         string
	Items         []ChecklistItem
	OthersCanAdd  bool // другие участники могут добавлять пункты
	OthersCanMark bool // другие участники могут отмечать выполненными
}

// ChecklistItemInfo — пункт в read-модели: текст + кто отметил выполненным.
type ChecklistItemInfo struct {
	ID       int     `json:"id"`
	Text     string  `json:"text"`
	MarkedBy []int64 `json:"marked_by"` // user id, отметившие пункт (пусто — не выполнен)
}

// ChecklistInfo — представление чек-листа для зрителя (read-модель): сам
// чек-лист + отметки по каждому пункту. Отметки одинаковы для всех (видно, кто
// отметил), поэтому per-viewer различий нет.
type ChecklistInfo struct {
	ID            int64               `json:"id"`
	Title         string              `json:"title"`
	Items         []ChecklistItemInfo `json:"items"`
	OthersCanAdd  bool                `json:"others_can_add"`
	OthersCanMark bool                `json:"others_can_mark"`
}
