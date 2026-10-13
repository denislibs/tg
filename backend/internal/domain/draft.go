package domain

import "time"

// Draft — облачный черновик сообщения (Telegram DraftMessage): по одному на
// тройку (чат, тред, пользователь), пустой текст без reply означает
// отсутствие черновика (удаление). Ключ «пир + тред» — порт tweb
// appDraftsManager.ts:88-90 (`peerId_threadId`).
type Draft struct {
	ChatID int64
	// ThreadRootID — ключ строки корня треда (drafts.thread_root_id): 0 — без
	// треда; в форуме 0 — General (строки корня у неё нет).
	ThreadRootID int64
	// TopMsgID — тот же тред НОМЕРОМ снаружи (updateDraftMessage.top_msg_id):
	// номер темы, у General в форуме — 1, у треда комментариев — номер
	// зеркала; 0 — черновик чата. Выводит хранилище при чтении.
	TopMsgID  int64
	Text      string
	Entities  MessageEntities
	ReplyToID *int64
	// WebPage — решение о превью ссылки (no_webpage, invert_media,
	// media:inputMediaWebPage), как его прислал saveDraft.
	WebPage   WebPageInput
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
	return NewDraftMessage(d.Text, d.Entities, d.ReplyToID, d.TopMsgID, d.UpdatedAt).WithWebPage(d.WebPage)
}
