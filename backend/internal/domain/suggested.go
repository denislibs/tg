package domain

import "time"

// SuggestedPost — предложенный в канал пост (Telegram suggested posts): участник
// без права постинга предлагает пост (текст+медиа, опц. желаемое время
// публикации), админ канала одобряет (публикует сразу или к назначенному
// времени) либо отклоняет. Хранится отдельной таблицей suggested_posts.
type SuggestedPost struct {
	ID        int64
	ChatID    int64
	AuthorID  int64
	Text      string
	Entities  []MessageEntity
	MediaID   *int64
	PublishAt *time.Time // желаемое/назначенное время публикации (nil — как можно скорее)
	Status    string     // "pending" | "approved" | "rejected"
	CreatedAt time.Time
	DecidedBy *int64
	DecidedAt *time.Time
}

// SuggestedPostInfo — представление предложенного поста для клиента (read-модель).
// PublishAt/CreatedAt/DecidedAt — unix-миллисекунды (0 — нет значения).
type SuggestedPostInfo struct {
	ID         int64           `json:"id"`
	ChatID     int64           `json:"chat_id"`
	AuthorID   int64           `json:"author_id"`
	AuthorName string          `json:"author_name,omitempty"`
	Text       string          `json:"text"`
	Entities   []MessageEntity `json:"entities,omitempty"`
	MediaID    *int64          `json:"media_id,omitempty"`
	PublishAt  int64           `json:"publish_at,omitempty"`
	Status     string          `json:"status"`
	CreatedAt  int64           `json:"created_at"`
	DecidedBy  int64           `json:"decided_by,omitempty"`
	DecidedAt  int64           `json:"decided_at,omitempty"`
}
