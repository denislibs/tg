package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// TopicsPage — список тем, РАЗЛОЖЕННЫЙ по векторам контейнера
// messages.forumTopics (см. domain/mtforumtopic.go).
//
// Строка темы перестала держать в себе последнее сообщение: сама `forumTopic`
// несёт состояние чтения и ссылку `top_message`, а сообщение едет в
// `messages`, его автор — в `users`. Прежде витрина везла выжимки
// (`last_text`, `last_type`, `last_at`) и склеенное сервером ПОДЗАПРОСОМ имя
// автора — последний живой экземпляр той же болезни, что снималась у диалогов.
//
// Сообщения здесь остаются domain.Message: наружу их переводит рендерер
// delivery/http, как и у диалогов.
type TopicsPage struct {
	Topics   []domain.TopicRow
	Messages []domain.Message
	Users    []domain.UserReal
}

// TopicsPage собирает список тем в раскладке контейнера.
//
// Обращений к базе фиксированное число и они пакетные: список тем → ОДИН
// запрос за последними сообщениями → ОДИН за недостающими авторами. N+1 здесь
// недопустим по той же причине, по которой сервер когда-то склеивал
// `last_sender_name` подзапросом внутри LATERAL.
func (i *Interactor) TopicsPage(ctx context.Context, chatID, viewerID int64) (TopicsPage, error) {
	rows, err := i.ListTopics(ctx, chatID, viewerID)
	if err != nil {
		return TopicsPage{}, err
	}

	// ── messages: последние сообщения тем ───────────────────────────────────
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		if r.LastMsgID != 0 {
			ids = append(ids, r.LastMsgID)
		}
	}
	var messages []domain.Message
	if len(ids) > 0 && i.msgs != nil {
		messages, err = i.msgs.GetByIDs(ctx, ids)
		if err != nil {
			return TopicsPage{}, err
		}
	}

	// ── users: авторы тем И авторы последних сообщений ──────────────────────
	// Автор темы нужен `from_id` строки, автор сообщения — подписи превью;
	// оба берутся ОДНИМ запросом.
	seen := make(map[int64]bool, len(rows)+len(messages))
	need := make([]int64, 0, len(rows)+len(messages))
	add := func(id int64) {
		if id != 0 && !seen[id] {
			seen[id] = true
			need = append(need, id)
		}
	}
	for _, r := range rows {
		add(r.Topic.CreatedBy)
	}
	for _, m := range messages {
		add(m.SenderID)
	}

	var users []domain.UserReal
	if len(need) > 0 && i.groups != nil {
		users, err = i.groups.UsersByIDs(ctx, need)
		if err != nil {
			return TopicsPage{}, err
		}
	}

	return TopicsPage{Topics: rows, Messages: messages, Users: users}, nil
}
