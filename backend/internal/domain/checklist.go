package domain

import "time"

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

// ChecklistMark — одна отметка о выполнении: КТО и КОГДА. Время здесь не
// украшение: в схеме отметка это todoCompletion{id, completed_by, date}, где
// date ОБЯЗАТЕЛЕН. Колонка checklist_marks.marked_at существует с самого начала
// (по ней идёт сортировка), но наружу не выходила — плоскому `marked_by []int64`
// её некуда было положить.
type ChecklistMark struct {
	UserID int64
	At     time.Time
}

// ChecklistItemInfo — пункт в read-модели: текст + отметки о выполнении.
type ChecklistItemInfo struct {
	ID    int
	Text  string
	Marks []ChecklistMark // пусто — пункт не выполнен
}

// ChecklistInfo — представление чек-листа для зрителя (read-модель): сам
// чек-лист + отметки по каждому пункту. Отметки одинаковы для всех (видно, кто
// отметил), поэтому per-viewer различий нет.
//
// json-тегов здесь нет по той же причине, что у PollInfo: на провод уходят
// конструкторы схемы (ChecklistInfo.ToMedia, mttodo.go).
type ChecklistInfo struct {
	ID            int64
	Title         string
	Items         []ChecklistItemInfo
	OthersCanAdd  bool
	OthersCanMark bool
}
