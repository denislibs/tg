package domain

// Чек-лист в форме оригинала — конструкторы схемы TL. Правила фазы 0 — в шапке
// mtmedia.go.
//
// До этого шага чек-лист ехал собственным ключом `checklist` строки витрины,
// записью ChecklistInfo{title, items:[{id, text, marked_by:[]}], others_can_*}.
// В схеме это messageMediaToDo и три вложенных конструктора, и главное различие
// не в именах:
//
// ОТМЕТКИ ЛЕЖАТ НЕ В ПУНКТЕ. У нас `marked_by` — массив id внутри пункта, то
// есть сам пункт (неизменяемый текст) и его состояние (кто отметил) склеены в
// один объект. В схеме пункт — todoItem{id, title}, а отметка — todoCompletion
// {id, completed_by, date} в ОТДЕЛЬНОМ векторе messageMediaToDo.completions.
// Из-за склейки терялось время отметки: колонка checklist_marks.marked_at
// существует с самого начала (по ней идёт ORDER BY), а на провод не выходила
// вовсе — todoCompletion.date обязателен, и это ровно тот параметр, который
// прежней форме некуда было положить.

// Значения дискриминатора `_` подсистемы чек-листа.
const (
	MessageMediaToDoTag = "messageMediaToDo"
	TodoListTag         = "todoList"
	TodoItemTag         = "todoItem"
	TodoCompletionTag   = "todoCompletion"
)

// messageMediaToDo#8a53b014 flags:# todo:TodoList
// completions:flags.0?Vector<TodoCompletion> = MessageMedia;
//
// Чек-лист сообщения: сам список плюс отметки о выполнении. Отметок нет вовсе —
// параметра нет вовсе, а не пустой вектор: это flags-поле.
type MessageMediaToDo struct {
	Underscore  string           `json:"_"`
	Todo        TodoList         `json:"todo"`
	Completions []TodoCompletion `json:"completions,omitempty"`
}

func (MessageMediaToDo) isMessageMedia() {}
func (m MessageMediaToDo) Tag() string   { return m.Underscore }

// todoList#49b92a26 flags:# others_can_append:flags.0?true
// others_can_complete:flags.1?true title:TextWithEntities list:Vector<TodoItem>
// = TodoList;
//
// САМ СПИСОК: заголовок и пункты, без единого слова о том, что уже выполнено.
//
// ── id: НАШ параметр вне схемы, и это ДОЛГ АДРЕСАЦИИ ────────────────────────
// У конструктора нет идентификатора, и это не пропуск оригинала: там чек-лист
// адресуется парой «пир + номер сообщения» (messages.toggleTodoCompleted(peer,
// msg_id, …)), потому что список живёт ровно в одном сообщении. У нас он
// хранится отдельной строкой checklists, и ручки отметки/дописывания принимают
// её суррогатный ключ.
//
// Это тот же долг, что назван у message.id (mtmessage.go: «Перевод адресации —
// следующий шаг»), и закрывается он там же — переводом ручек на пару
// «пир + номер». До тех пор ключ едет объявленным параметром
// (schema_additional_params.json, предикат todoList), а не молча.
type TodoList struct {
	Underscore string          `json:"_"`
	ID         int64           `json:"id"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Title — обязательный: заголовок ВМЕСТЕ со своей разметкой.
	Title *TextWithEntities `json:"title"`
	// List — обязательный вектор пунктов.
	List []TodoItem `json:"list"`
}

// todoItem#cba9a52f id:int title:TextWithEntities = TodoItem;
//
// Пункт: стабильный номер внутри списка и текст. Ничего про выполнение.
type TodoItem struct {
	Underscore string            `json:"_"`
	ID         int               `json:"id"`
	Title      *TextWithEntities `json:"title"`
}

// NewTodoItem — пункт чек-листа.
func NewTodoItem(id int, text string) TodoItem {
	return TodoItem{Underscore: TodoItemTag, ID: id, Title: NewTextWithEntities(text, nil)}
}

// todoCompletion#221bb5e4 id:int completed_by:Peer date:int = TodoCompletion;
//
// ОТМЕТКА: какой пункт, КТО и КОГДА. Все три параметра обязательные — и именно
// третьего у прежней формы не было, хотя checklist_marks.marked_at хранится с
// самого начала.
//
// «Кто» — ссылка на пир, а не голый user_id: то же правило, что у
// messagePeerReaction.
type TodoCompletion struct {
	Underscore  string `json:"_"`
	ID          int    `json:"id"`
	CompletedBy Peer   `json:"completed_by"`
	Date        int    `json:"date"`
}

// ToMedia — ЕДИНСТВЕННЫЙ перевод представления чек-листа в конструкторы схемы:
// им пользуются и витрина сообщения, и кадр checklist_update, и ответы ручек
// отметки/дописывания.
func (c ChecklistInfo) ToMedia() *MessageMediaToDo {
	list := TodoList{
		Underscore: TodoListTag,
		ID:         c.ID,
		Title:      NewTextWithEntities(c.Title, nil),
		List:       make([]TodoItem, 0, len(c.Items)),
	}
	setPFlag(&list.PFlags, "others_can_append", c.OthersCanAdd)
	setPFlag(&list.PFlags, "others_can_complete", c.OthersCanMark)

	out := &MessageMediaToDo{Underscore: MessageMediaToDoTag, Todo: list}
	for _, it := range c.Items {
		out.Todo.List = append(out.Todo.List, NewTodoItem(it.ID, it.Text))
		for _, mark := range it.Marks {
			out.Completions = append(out.Completions, TodoCompletion{
				Underscore:  TodoCompletionTag,
				ID:          it.ID,
				CompletedBy: NewPeerUser(mark.UserID),
				Date:        unixSeconds(mark.At),
			})
		}
	}
	return out
}
