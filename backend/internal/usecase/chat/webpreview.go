package chat

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// previewTimeout ограничивает весь цикл превью (fetch + parse + UPDATE + fan-out):
// работа идёт в фоне на context.Background(), «висящий» сайт не должен держать
// горутину бесконечно.
const previewTimeout = 15 * time.Second

var urlRe = regexp.MustCompile(`https?://\S+`)

// firstURL — первая http/https-ссылка сообщения: сначала entities text_link
// (несут явный URL), затем голая ссылка в тексте. Пусто — ссылок нет.
func firstURL(text string, entities []domain.MessageEntity) string {
	for _, e := range entities {
		if e.Type == "text_link" && (strings.HasPrefix(e.URL, "http://") || strings.HasPrefix(e.URL, "https://")) {
			return e.URL
		}
	}
	// Хвостовую пунктуацию («смотри https://a.b/c.») ссылкой не считаем.
	return strings.TrimRight(urlRe.FindString(text), `.,;:!?)»"'`)
}

// attachWebPreview строит превью первой ссылки уже отправленного сообщения
// (вызывается go-рутиной ПОСЛЕ коммита Send): Preview() → UPDATE web_page →
// кадр web_page_update всем участникам. Догоняющее и best-effort: любая ошибка
// просто оставляет сообщение без карточки (история при /sync отдаст web_page,
// если UPDATE успел). Секретные чаты исключены — сервер их контент не трогает.
func (i *Interactor) attachWebPreview(msg domain.Message, url string, recipients []int64) {
	ctx, cancel := context.WithTimeout(context.Background(), previewTimeout)
	defer cancel()
	if typ, err := i.chats.ChatType(ctx, msg.ChatID); err != nil || typ == "secret" {
		return
	}
	wp, err := i.preview.Preview(ctx, url)
	if err != nil || wp == nil {
		return
	}
	if err := i.msgs.SetWebPage(ctx, msg.ID, wp); err != nil {
		return
	}
	if i.publisher == nil {
		return
	}
	f := frame("web_page_update", map[string]any{
		"chat_id": msg.ChatID, "msg_id": msg.ID, "seq": msg.Seq, "web_page": wp,
	})
	for _, uid := range recipients {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
