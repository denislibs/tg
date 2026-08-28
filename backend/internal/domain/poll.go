package domain

// Poll — опрос (Telegram Poll): вопрос + варианты, флаги анонимности/
// мультивыбора/викторины. Хранится отдельно от сообщения; сообщение типа
// 'poll' ссылается на него через messages.poll_id.
type Poll struct {
	ID            int64
	ChatID        int64
	Question      string
	Options       []string
	Anonymous     bool
	Multiple      bool
	Quiz          bool
	CorrectOption *int
	Closed        bool
}

// PollInfo — представление опроса для конкретного зрителя (read-модель):
// сам опрос + агрегаты голосов + выбор зрителя. CorrectOption раскрывается
// только когда викторина закрыта или зритель уже ответил.
//
// json-тегов здесь БОЛЬШЕ НЕТ: на провод эта запись не выходит ни одним путём —
// и витрина сообщения, и кадр poll_update, и ответ ручки голосования отдают
// конструкторы схемы (PollInfo.ToMedia, mtpoll.go). Оставленные теги были бы
// приглашением завести вторую форму опроса.
type PollInfo struct {
	ID            int64
	Question      string
	Options       []string
	Anonymous     bool
	Multiple      bool
	Quiz          bool
	Closed        bool
	CorrectOption *int
	Counts        []int // голосов на вариант
	TotalVoters   int   // уникальных проголосовавших
	MyVotes       []int // индексы, выбранные зрителем
}
