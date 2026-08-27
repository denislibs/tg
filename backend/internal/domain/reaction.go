package domain

// CanSeeReactionsList — виден ли зрителю СПИСОК реагировавших в чате этого вида.
// Единственный ответ на этот вопрос; на проводе он называется
// messageReactions.pFlags.can_see_list, и схема определяет его дословно как
// «whether messages.getMessageReactionsList can be used to see how each specific
// peer reacted to the message» (core.telegram.org/constructor/messageReactions).
//
// Правило — вид чата, а не сообщение и не роль: список реагировавших существует
// В ГРУППАХ («In groups, messages.getMessageReactionsList can be used to fetch
// the reaction list, along with the sender of each reaction» —
// core.telegram.org/api/reactions). В вещательном канале его нет: реакции там
// анонимны, и оригинал флага не ставит.
//
// ЛИЧКА сюда не входит НАМЕРЕННО, и это не пропуск: на неё отвечает клиент — по
// ключу пира, вторым термом того же условия (tweb
// src/components/chat/reactions.ts:306 `!!reactions.pFlags.can_see_list ||
// this.context.peerId.isUser()`, там же reactionContextMenu.ts:95). Продублируй
// мы её здесь — у вопроса стало бы два ответа, расходящихся при первой правке.
func CanSeeReactionsList(chatType string) bool { return chatType == ChatTypeGroup }

// CanViewReactionsList — ПРАВО ДОСТУПА к списку реагировавших: может ли зритель
// вообще получить messages.getMessageReactionsList в чате этого вида.
//
// Это НЕ второй ответ на тот же вопрос, а тот же ответ целиком. Флаг
// can_see_list выше — только ПОЛОВИНА права, та, которую объявляет сервер;
// вторую половину (личку) у оригинала договаривает клиент по ключу пира, и все
// три места tweb пишут её вторым термом одного условия: `!!reactions.pFlags
// .can_see_list || peerId.isUser()` (reactionContextMenu.ts:95,
// contextMenu.ts:404-407, reactions.ts:305-306). Гейт ручки — сервер, клиента
// над собой у него нет, поэтому договаривать личку приходится здесь; ровно
// поэтому правило выражено ЧЕРЕЗ CanSeeReactionsList, а не рядом с ним:
// разойтись с флагом оно не может по построению.
func CanViewReactionsList(chatType string) bool {
	return CanSeeReactionsList(chatType) || chatType == ChatTypePrivate
}

type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	// Mine — зритель тоже поставил эту реакцию (клиент подсвечивает чип).
	Mine bool `json:"mine,omitempty"`
	// Recent — до 3 последних реагировавших (свежие первыми) как ССЫЛКИ на
	// пиров. Клиент показывает их аватары вместо числа при count<4 (tweb
	// reaction.ts:1060-1084, reactions.ts:305-307 — аватары при
	// totalReactions<REACTIONS_DISPLAY_COUNTER_AT), а имя и фото берёт из
	// своего кэша пиров — как recent_reactions:Vector<MessagePeerReaction> в
	// схеме, где тоже едет peer_id, а не снимок карточки.
	//
	// Прежде здесь ехала мини-карточка {id, name, avatar}: третья форма
	// пользователя на проводе, вклеенная в jsonb прямо в SQL и потому
	// разъезжавшаяся с остальными сама по себе.
	Recent []Peer `json:"recent,omitempty"`
}

// ReactionUser — одна поставленная реакция (кто и каким эмодзи), для попапа
// «кто отреагировал». User несёт карточку для отображения (имя/аватар).
type ReactionUser struct {
	User  UserReal
	Emoji string
}

// SavedTag — тег-реакция «Избранного» (Telegram saved reaction tag): реакция
// (эмодзи или id кастом-эмодзи как строка), заданное пользователем имя (может
// быть пустым) и число помеченных этим тегом сообщений в самочате.
type SavedTag struct {
	Reaction string `json:"reaction"`
	Title    string `json:"title,omitempty"`
	Count    int    `json:"count"`
}

// StarReactionAgg — агрегат платной ⭐-реакции сообщения для зрителя: суммарное
// число звёзд (Total) и личный вклад зрителя (Mine). Наполняется read-моделью
// истории (не хранится на строке сообщения). Total==0 — платных реакций нет.
type StarReactionAgg struct {
	Total int64 `json:"total"`
	Mine  int64 `json:"mine,omitempty"`
}

// StarReactionSender — один отправитель платной ⭐-реакции (топ-отправители у
// бабла/в попапе). Anonymous скрывает личность: карточку зрителю не раскрываем.
type StarReactionSender struct {
	User      UserReal
	Stars     int64
	Anonymous bool
}
