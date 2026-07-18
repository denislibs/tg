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
type PollInfo struct {
	ID            int64  `json:"id"`
	Question      string `json:"question"`
	Options       []string `json:"options"`
	Anonymous     bool   `json:"anonymous"`
	Multiple      bool   `json:"multiple"`
	Quiz          bool   `json:"quiz"`
	Closed        bool   `json:"closed"`
	CorrectOption *int   `json:"correct_option,omitempty"`
	Counts        []int  `json:"counts"`       // голосов на вариант
	TotalVoters   int    `json:"total_voters"` // уникальных проголосовавших
	MyVotes       []int  `json:"my_votes"`     // индексы, выбранные зрителем
}
