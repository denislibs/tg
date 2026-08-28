package http

import (
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Конвертер ГРАНИЦЫ Bot API: наша модель → форма чужой документации.
//
// Bot API описывает пользователя записью {id, is_bot, first_name, username}, а
// чат — {id, type, title}. Это не наша модель и даже не MTProto: настоящий
// Telegram устроен так же — Bot API это фасад над MTProto, и на границе стоит
// переводчик. Тот же приём уже применён к сущностям (botAPIEntities) и
// разметке (botAPIReplyMarkup).
//
// Живёт в delivery, а не в usecase, и это не вкусовщина: зависимости идут
// внутрь, а чужой контракт — самый внешний слой из возможных. До шага C
// конвертер сидел в usecase/chat/botapi.go и заодно объявлял КАЖДЫЙ чат
// приватным независимо от настоящего вида (дефект 4 разбора): бот в группе
// получал апдейт, где его же группа названа private.
type botAPIView struct{}

var _ usecasechat.BotAPIView = botAPIView{}

// NewBotAPIView — конвертер границы для DI-сборки.
func NewBotAPIView() usecasechat.BotAPIView { return botAPIView{} }

// User — поле from апдейта. Имя берётся из краткой карточки: Bot API знает
// ровно first_name/last_name, никакого display_name у него нет и не было.
func (botAPIView) User(u domain.UserReal) map[string]any {
	out := map[string]any{"id": u.ID, "is_bot": u.Bot(), "first_name": u.FirstName}
	if u.LastName != "" {
		out["last_name"] = u.LastName
	}
	if u.Username != "" {
		out["username"] = u.Username
	}
	return out
}

// Chat — поле chat апдейта. Виды чата Bot API ('private' | 'group' |
// 'supergroup' | 'channel') почти совпадают с нашими chats.type; наша группа
// это супергруппа по решению №2 (username, форумы и slowmode в схеме есть
// только у channel), поэтому 'group' переводится в 'supergroup'.
//
// Чат «Избранное» для бота недостижим, а секретный чат бот не видит по
// построению — оба сюда не приходят; неизвестный вид деградирует в 'private',
// то есть в самое узкое разрешение, а не в самое широкое.
func (botAPIView) Chat(chatID int64, chatType, title string) map[string]any {
	out := map[string]any{"id": chatID, "type": botAPIChatType(chatType)}
	if title != "" {
		out["title"] = title
	}
	return out
}

func botAPIChatType(chatType string) string {
	switch chatType {
	case domain.ChatTypeGroup:
		return "supergroup"
	case domain.ChatTypeChannel:
		return "channel"
	default:
		return "private"
	}
}
