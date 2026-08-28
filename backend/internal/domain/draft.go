package domain

import "time"

// Draft — облачный черновик сообщения (Telegram DraftMessage): по одному на
// пару (чат, пользователь), пустой текст без reply означает отсутствие
// черновика (удаление).
type Draft struct {
	ChatID    int64
	Text      string
	Entities  MessageEntities
	ReplyToID *int64
	UpdatedAt time.Time
}

// Wire — черновик в форме схемы (draftMessage). ЕДИНСТВЕННАЯ сборка: её берут
// и кадр draft_update, и витрина /drafts, поэтому второй формы у черновика на
// проводе нет.
//
// «Черновика нет» здесь не выражается — это ДРУГОЙ конструктор
// (draftMessageEmpty), и выбирает между ними тот, у кого есть ответ на вопрос
// «есть ли черновик»: строка есть — draftMessage, строки нет — пустой.
func (d Draft) Wire() DraftMessageReal {
	return NewDraftMessage(d.Text, d.Entities, d.ReplyToID, d.UpdatedAt)
}
