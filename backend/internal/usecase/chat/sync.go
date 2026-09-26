package chat

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// GetHistory returns a window of messages plus the chat's total count.
// threadRoot != nil ограничивает окно тредом (форум-топик / комментарии поста);
// тред discussion-группы читается и не-членом (как ListComments — комментарии
// канала доступны подписчикам без вступления в группу).
// tag (optional) — фильтр «Избранного» по тегу-реакции: возвращаются только
// сообщения, помеченные зрителем реакцией tag (Telegram search by saved tag).
func (i *Interactor) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, threadRoot *int64, tag string) (HistoryResult, error) {
	if err := i.checkHistoryAccess(ctx, chatID, userID, threadRoot); err != nil {
		return HistoryResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	cleared, err := i.chats.ClearedSeq(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	// Комментарии: клиент адресует тред id ПОСТА (внешний контракт), а
	// физически он висит на id ЗЕРКАЛА в группе обсуждения — резолвим перед
	// запросом к хранилищу (см. resolveThreadRootForQuery). queryRoot (не
	// исходный threadRoot) отдаёт хранилищу условие `thread_root_id=root OR
	// id=root`, поэтому корневой бабл треда приезжает окном сам: зеркало лежит
	// в ЭТОМ чате под id queryRoot, а не под id поста в канале.
	//
	// Синтетической подшивки корня ИЗ ДРУГОГО чата здесь больше нет. Она
	// существовала только ради вырожденного пути (thread_root долетел
	// непереведённым) и подставляла корню seq=0 при сохранённом чужом
	// содержимом: наружу сообщение адресуется парой «пир + seq», номера чужого
	// чата в этом пространстве не существует вовсе, а 0 значит «самое новое».
	queryRoot := i.resolveThreadRootForQuery(ctx, chatID, threadRoot)
	msgs, err := i.msgs.GetHistory(ctx, chatID, userID, offsetSeq, addOffset, limit, queryRoot, cleared, tag)
	if err != nil {
		return HistoryResult{}, err
	}
	if e := i.hydrateMessages(ctx, userID, msgs); e != nil {
		return HistoryResult{}, e
	}
	var count int
	switch {
	case tag != "":
		// Фильтр по тегу отдаёт своё узкое окно — общий счётчик чата тут не к месту.
		count = len(msgs)
	case threadRoot != nil:
		count, err = i.msgs.CountThread(ctx, chatID, *queryRoot)
	default:
		count, err = i.msgs.CountMessages(ctx, chatID)
	}
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// hydrateMessages — ПОЛНАЯ гидрация окна сообщений для зрителя userID: всё,
// что строка сообщения несёт лишь ключом (ответ, вложение, опрос, чек-лист,
// подарок, розыгрыш, платное медиа, реакции), собирается здесь одним ходом.
//
// Помощник один на все выдачи, где сообщение уходит клиенту той же формой,
// что в ленте (история, «перейти к сообщению», последнее сообщение диалога,
// темы форума и строки «Избранного»):
// пока цепочка копировалась по местам, список чатов остался без неё вовсе, и
// фото с опросом приезжали туда без `media` — то есть без превью.
//
// Ответ и вложение — с ошибкой: без них сообщение приехало бы другой формой.
// Остальное — best-effort, как и было у истории: сбой косметики не должен
// ронять выдачу.
func (i *Interactor) hydrateMessages(ctx context.Context, userID int64, msgs []domain.Message) error {
	return i.hydrateMessagesFor(ctx, userID, userID, msgs)
}

// hydrateBroadcastMessage — та же цепочка для ОДНОГО сообщения, чьё тело кадра
// одно на всех получателей (правка — edit_message). Зритель здесь «никто» (0):
// опрос, подарок, розыгрыш и реакции едут снимком без «моих» флагов, как у
// живого new_message (Send считает их с тем же нулём), а клиент сводит снимок
// со своим (mergeReactions). Платное медиа — глазами автора: открыто и с
// ценой; заблокированную копию не-авторам делает вызывающий (lockedPaidCopy),
// как и доставка нового сообщения.
func (i *Interactor) hydrateBroadcastMessage(ctx context.Context, m domain.Message) (domain.Message, error) {
	one := []domain.Message{m}
	if err := i.hydrateMessagesFor(ctx, 0, m.SenderID, one); err != nil {
		return m, err
	}
	return one[0], nil
}

// hydrateMessagesFor — сама цепочка: viewerID — чьими глазами собираются
// пер-зрительские части, paidViewerID — для кого решается блокировка платного
// медиа (у ленты это один и тот же зритель).
func (i *Interactor) hydrateMessagesFor(ctx context.Context, viewerID, paidViewerID int64, msgs []domain.Message) error {
	if err := i.hydrateReplies(ctx, msgs); err != nil {
		return err
	}
	if err := i.hydrateMedia(ctx, msgs); err != nil {
		return err
	}
	_ = i.hydratePolls(ctx, viewerID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, viewerID, msgs)
	i.hydrateGiveaways(ctx, viewerID, msgs)
	i.hydratePaidMedia(ctx, paidViewerID, msgs)
	_ = i.hydrateReactions(ctx, viewerID, msgs)
	i.hydrateStarReactions(ctx, viewerID, msgs)
	return nil
}

// checkHistoryAccess: член чата — всегда; не-член — только тред в discussion-
// группе канала (комментарии читаются без вступления, tweb).
func (i *Interactor) checkHistoryAccess(ctx context.Context, chatID, userID int64, threadRoot *int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	if threadRoot != nil && i.groups != nil {
		if disc, e := i.groups.IsDiscussionGroup(ctx, chatID); e == nil && disc {
			return nil
		}
	}
	return domain.ErrNotFound
}

// hydrateReactions fills Reactions (emoji aggregates + the viewer's mine flag) on
// a window of messages with one batch query. Best-effort: reactions are cosmetic,
// a failure must not break history.
func (i *Interactor) hydrateReactions(ctx context.Context, viewerID int64, msgs []domain.Message) error {
	if i.reactions == nil {
		return nil // хранилище реакций не подключено — косметика отключается, как у звёздных
	}
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if !m.Deleted {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	byMsg, err := i.reactions.ReactionsFor(ctx, ids, viewerID)
	if err != nil {
		return err
	}
	for idx := range msgs {
		msgs[idx].Reactions = byMsg[msgs[idx].ID]
	}
	return nil
}

// hydrateReplies fills ReplyTo on each message that replies to another,
// batch-fetching the targets by their NUMBER in the chat (one query per chat).
// Deleted/missing targets are skipped.
//
// Адрес отвечаемого — пара «пир + seq» (messages.reply_to_id хранит номер, а
// не ключ строки), поэтому выборка идёт по (chat_id, seq): список может быть
// из разных чатов (глобальный поиск), и группировка по чату здесь не
// оптимизация, а условие корректности — один и тот же номер в двух чатах
// означает два разных сообщения.
func (i *Interactor) hydrateReplies(ctx context.Context, msgs []domain.Message) error {
	seqsByChat := map[int64][]int64{}
	seen := map[[2]int64]bool{}
	for _, m := range msgs {
		// Кросс-чат-ответ: оригинал в ДРУГОМ чате — его контент НЕ подтягиваем
		// (клиент рисует превью из снимка reply_snapshot_*). Иначе любой участник
		// вычитал бы содержимое чужого чата через историю.
		if m.ReplyToPeerID != nil || m.ReplyToID == nil {
			continue
		}
		k := [2]int64{m.ChatID, *m.ReplyToID}
		if seen[k] {
			continue
		}
		seen[k] = true
		seqsByChat[m.ChatID] = append(seqsByChat[m.ChatID], *m.ReplyToID)
	}
	if len(seqsByChat) == 0 {
		return nil
	}
	byAddr := make(map[[2]int64]domain.Message, len(seen))
	for chatID, seqs := range seqsByChat {
		targets, err := i.msgs.GetBySeqs(ctx, chatID, seqs)
		if err != nil {
			return err
		}
		for _, t := range targets {
			byAddr[[2]int64{t.ChatID, t.Seq}] = t
		}
	}
	for idx := range msgs {
		// Кросс-чат-ответ рисуется из снимка — реальный оригинал не отдаём.
		if msgs[idx].ReplyToPeerID != nil {
			continue
		}
		rid := msgs[idx].ReplyToID
		if rid == nil {
			continue
		}
		t, ok := byAddr[[2]int64{msgs[idx].ChatID, *rid}]
		if !ok || t.Deleted {
			continue
		}
		text := t.Text
		// Carry formatting only for untruncated snippets — entity offsets are over
		// the full text, so clipping the string would misalign them.
		entities := t.Entities
		if len([]rune(text)) > 120 {
			text = string([]rune(text)[:120])
			entities = nil
		}
		// Reply quote: цитата хранится на ОТВЕЧАЮЩЕМ сообщении (msgs[idx]) —
		// показываем выделенный фрагмент вместо превью всего оригинала.
		quote := ""
		if msgs[idx].ReplyQuoteText != nil {
			quote = *msgs[idx].ReplyQuoteText
		}
		msgs[idx].ReplyTo = &domain.ReplyPreview{Seq: t.Seq, SenderID: t.SenderID, Text: text, Entities: entities, Type: t.Type, MediaID: t.MediaID, QuoteText: quote}
	}
	return nil
}

// hydrateMedia fills width/height/mime on messages that carry media, batch-fetching
// dims by media id (one query). Lets the client reserve the exact media box before
// the bytes load (no layout shift). Missing/unprocessed media are left at zero.
//
// Картинка превью ссылки (web_page.photo_id) идёт тем же батчем и по той же
// причине: размеры и stripped-подложка живут в строке media, а обработка после
// скачивания асинхронная — на момент записи снимка превью их ещё нет, поэтому
// это read-model, а не часть jsonb.
func (i *Interactor) hydrateMedia(ctx context.Context, msgs []domain.Message) error {
	ids := make([]int64, 0)
	seen := map[int64]bool{}
	add := func(id int64) {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, m := range msgs {
		if m.MediaID != nil {
			add(*m.MediaID)
		}
		if m.WebPage != nil {
			add(m.WebPage.PhotoID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	dims, err := i.mediaAccess.DimsByIDs(ctx, ids)
	if err != nil {
		return err
	}
	for idx := range msgs {
		if wp := msgs[idx].WebPage; wp != nil && wp.PhotoID > 0 {
			if d, ok := dims[wp.PhotoID]; ok {
				wp.PhotoW, wp.PhotoH = d.Width, d.Height
				wp.PhotoBlur, wp.PhotoHasThumb = d.Blur, d.HasThumb
			}
		}
		if msgs[idx].MediaID == nil {
			continue
		}
		// Вложение собирается ВСЕГДА, когда у сообщения есть media_id — даже если
		// строки media ещё нет (медиа не обработано): у сообщения с медиа не
		// бывает состояния «вложения нет вовсе», иначе клиенту пришлось бы
		// держать вторую ветку рендера на этот случай. Незаполненное вложение —
		// это документ без атрибутов и без превью, а не отсутствующий объект.
		msgs[idx].Media = buildMedia(msgs[idx], dims[*msgs[idx].MediaID])
	}
	return nil
}

// AroundResult — окно «перейти к сообщению»: сообщения вокруг seq плюс размер
// полного набора. Концы окна выводит клиент (см. MessagesRepo.GetAround).
type AroundResult struct {
	Messages []domain.Message
	Count    int
}

// GetHistoryAround returns a window centered on centerSeq (for jump-to-message),
// hydrated the same way as GetHistory.
func (i *Interactor) GetHistoryAround(ctx context.Context, chatID, userID, centerSeq int64, limit int, threadRoot *int64) (AroundResult, error) {
	if err := i.checkHistoryAccess(ctx, chatID, userID, threadRoot); err != nil {
		return AroundResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	cleared, err := i.chats.ClearedSeq(ctx, chatID, userID)
	if err != nil {
		return AroundResult{}, err
	}
	// см. GetHistory — тот же перевод id поста -> id зеркала для запроса.
	queryRoot := i.resolveThreadRootForQuery(ctx, chatID, threadRoot)
	msgs, err := i.msgs.GetAround(ctx, chatID, userID, centerSeq, limit, queryRoot, cleared)
	if err != nil {
		return AroundResult{}, err
	}
	if e := i.hydrateMessages(ctx, userID, msgs); e != nil {
		return AroundResult{}, e
	}
	var count int
	if threadRoot != nil {
		count, err = i.msgs.CountThread(ctx, chatID, *queryRoot)
	} else {
		count, err = i.msgs.CountMessages(ctx, chatID)
	}
	if err != nil {
		return AroundResult{}, err
	}
	return AroundResult{Messages: msgs, Count: count}, nil
}

// MediaPage — окно выборки шаред-медиа профиля (вкладки Медиа/Файлы/Ссылки/
// Музыка/Голосовые) и поиска в одном чате (SearchMessages) — у обоих один
// курсор по номеру сообщения в чате.
//
// Листается КУРСОРОМ, а не смещением: оригинал просит следующую страницу по id
// последнего уже показанного сообщения (tweb
// src/components/appSearchSuper.ts:2278-2279 — `offsetId = lastItem?.mid`).
// Разница не косметическая. Тот же список одновременно пополняется СВЕРХУ от
// живых апдейтов (tweb src/components/sidebarRight/tabs/sharedMedia.tsx:239 —
// `history.unshift`), а числовое смещение считается от начала списка: каждое
// новое сообщение сдвигает окно на единицу, и вторая страница приезжает с
// дублем последнего элемента первой (или, при удалении, с дырой). Курсор к
// пополнению сверху нечувствителен по построению.
type MediaPage struct {
	// OffsetID — seq последнего уже показанного сообщения; страница отдаётся
	// строго ниже него. 0 — с начала (самые новые).
	OffsetID int64
	Limit    int
}

// SearchCounter — число сообщений чата одного вида (аналог MTProto
// messages.searchCounter).
type SearchCounter struct {
	Filter string
	Count  int
}

// MediaHistory lists a chat's shared media of one kind (profile tabs).
func (i *Interactor) MediaHistory(ctx context.Context, chatID, userID int64, filter string, page MediaPage) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	if page.Limit <= 0 || page.Limit > 60 {
		page.Limit = 30
	}
	if page.OffsetID < 0 {
		page.OffsetID = 0
	}
	msgs, count, err := i.msgs.MediaHistory(ctx, chatID, userID, filter, page)
	if err != nil {
		return HistoryResult{}, err
	}
	// Вложение собирается здесь же, как у истории и поиска: ручка отдаёт
	// ТОЛЬКО медиа, и без `Media` клиенту нечего рисовать в плитке
	// (пин — TestMediaHistory_HydratesAttachment).
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// SearchCounters — число сообщений по КАЖДОМУ из filters одним ответом (аналог
// MTProto messages.getSearchCounters). Оригинал спрашивает счётчики всех вкладок
// сразу, одним вызовом (tweb src/components/appSearchSuper.ts:2375-2377,
// результат используется в loadFirstTime:2388-2389), чтобы решить, какие вкладки
// показать и какую открыть первой; у нас это стоило пяти запросов на открытие
// профиля.
//
// Ответ идёт В ПОРЯДКЕ ЗАПРОСА и содержит запись на каждый фильтр: неизвестный
// вид — ноль, а не ошибка и не пропущенный ключ. Так же устроен и оригинал:
// вкладка ищет СВОЮ запись по имени фильтра и разыменовывает её без проверки
// (`counters.find(...).count`, tweb src/components/appSearchSuper.ts:2429-2434),
// то есть пропущенный фильтр там — не пустая вкладка, а исключение.
func (i *Interactor) SearchCounters(ctx context.Context, chatID, userID int64, filters []string) ([]SearchCounter, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	counts, err := i.msgs.SearchCounters(ctx, chatID, userID, filters)
	if err != nil {
		return nil, err
	}
	out := make([]SearchCounter, 0, len(filters))
	for _, f := range filters {
		out = append(out, SearchCounter{Filter: f, Count: counts[f]})
	}
	return out, nil
}

// SearchFilter сужает поиск внутри чата. Две лексики вида, и обе живые:
// MediaType — мелкая лексика топбар-поиска чата (tweb topbarSearch), Filter —
// вкладки класса AppSearchSuper с чипом пира (inputMessagesFilter* →
// messages.search, tweb appMessagesManager.ts:9966-9982); заданные вместе,
// складываются по И. Нулевые значения отключают соответствующий фильтр.
type SearchFilter struct {
	SenderID  int64  // фильтр по автору (0 — любой)
	MediaType string // photo/video/voice/roundvideo/file/link/music ("" — любой)
	Reaction  string // сообщения, у которых есть эта реакция ("" — любая)
	Filter    string // media/files/links/music/voice — лексика mediaFilterCond ("" — любой)
	// MinDate/MaxDate — чипы дат, unix-секунды, обе границы включительно
	// (см. GlobalSearchQuery); 0 — без границы.
	MinDate, MaxDate int64
}

// SearchMessages — поиск по одному чату (аналог messages.search). Окно —
// курсор page.OffsetID (номер последнего отданного, см. MediaPage), а не
// смещение: выдачу листают и поиск в чате, и класс с чипом пира, а она
// пополняется сверху живыми апдейтами.
//
// Пустой q без фильтров — это не «искать нечего», а вся история чата: так
// отвечает messages.search с пустым q и inputMessagesFilterEmpty, и именно его
// шлёт класс для чипа пира без текста (tweb appSearchSuper.ts:2233-2236 —
// запрос уходит, если есть query ИЛИ peerId ИЛИ minDate). Топбар-поиск
// пустую строку на сервер не шлёт сам (useChatSearch: idle).
func (i *Interactor) SearchMessages(ctx context.Context, chatID, userID int64, q string, f SearchFilter, page MediaPage) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	page.Limit = clampSearchLimit(page.Limit)
	if page.OffsetID < 0 {
		page.OffsetID = 0
	}
	msgs, count, err := i.msgs.SearchMessages(ctx, chatID, userID, q, f, page)
	if err != nil {
		return HistoryResult{}, err
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// MessageSeqByDate возвращает seq сообщения для jump-to-date: самое раннее
// сообщение на/после указанной даты (или самое новое, если дата позже всей
// истории). domain.ErrNotFound — не участник чата либо чат пуст.
func (i *Interactor) MessageSeqByDate(ctx context.Context, chatID, userID int64, from time.Time) (int64, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, domain.ErrNotFound
	}
	return i.msgs.MessageSeqByDate(ctx, chatID, from)
}

// GlobalSearchQuery — запрос глобального поиска по сообщениям всех чатов
// пользователя (аналог MTProto messages.searchGlobal).
type GlobalSearchQuery struct {
	Q      string
	Filter string // "", media, files, links, music, voice — лексика mediaFilterCond
	// OffsetRate — курсор: next_rate предыдущей страницы, страница отдаётся
	// строго ниже него; 0 — с начала (самые новые).
	//
	// Курсор, а не смещение, по той же причине, что у MediaPage: кэш вкладки
	// пополняется сверху живыми апдейтами, и числовой OFFSET на каждое новое
	// попадание сдвигает окно (дубль или дыра на второй странице). В MTProto
	// next_rate опаков; у нас messages.id глобально монотонен и выдача им же
	// упорядочена, поэтому rate — это id последнего отданного сообщения.
	// offset_id/offset_peer, которые клиент шлёт дословно (tweb
	// appMessagesManager.ts:9987-10003), серверу не нужны.
	OffsetRate int64
	Limit      int
	// ChatType — вид чатов (ChatTypeMenu, tweb chatTypeMenu/index.tsx):
	// "" — все, users/groups/channels — флаги users_only/groups_only/
	// broadcasts_only messages.searchGlobal (tweb appMessagesManager.ts:9997-9999).
	ChatType string
	// MinDate/MaxDate — чипы дат, unix-секунды, обе границы включительно
	// (чип дня шлёт max = начало следующего дня − 1 с, tweb helpers/date.ts:264);
	// 0 — без границы.
	MinDate, MaxDate int64
}

// Виды чатов глобального поиска (GlobalSearchQuery.ChatType).
const (
	SearchChatTypeUsers    = "users"
	SearchChatTypeGroups   = "groups"
	SearchChatTypeChannels = "channels"
)

// searchLimitMax — потолок страницы поиска (MTProto режет limit поиска ста).
const searchLimitMax = 100

// clampSearchLimit — лимит страницы поиска: нет/неположительный — 20,
// больше потолка — потолок.
func clampSearchLimit(limit int) int {
	switch {
	case limit <= 0:
		return 20
	case limit > searchLimitMax:
		return searchLimitMax
	}
	return limit
}

// GlobalSearchResult — страница глобальной выдачи. NextRate — курсор следующей
// страницы; 0 — дальше ничего нет (клиент по !nextRate помечает вкладку
// загруженной, tweb appSearchSuper.ts:2312).
type GlobalSearchResult struct {
	Messages []domain.Message
	Count    int
	NextRate int64
}

// GlobalSearchMessages searches messages across every chat the user belongs to
// (tweb global search). filter ∈ {"", media, files, links, music, voice}; with
// an empty q, empty filter AND no dates there is nothing to search — returns empty.
func (i *Interactor) GlobalSearchMessages(ctx context.Context, userID int64, q GlobalSearchQuery) (GlobalSearchResult, error) {
	switch q.ChatType {
	case "", SearchChatTypeUsers, SearchChatTypeGroups, SearchChatTypeChannels:
	default:
		// Неизвестный вид — ошибка, а не «все чаты»: молча расширенная выдача
		// выглядела бы как работающий фильтр.
		return GlobalSearchResult{}, domain.ErrInvalid
	}
	// Искать нечего, только если нет ни текста, ни вкладки, ни даты: чип даты
	// без текста — запрос (tweb appSearchSuper.ts:2233-2236 — уходит при
	// query ИЛИ peerId ИЛИ minDate).
	if q.Q == "" && q.Filter == "" && q.MinDate == 0 && q.MaxDate == 0 {
		return GlobalSearchResult{}, nil
	}
	// Лишний лимит зажимается до потолка, а не сбрасывается в умолчание:
	// клиент считает выдачу исчерпанной по короткой странице
	// (`value.history.length < loadCount`, tweb appSearchSuper.ts:2311), а
	// loadCount у него до 50 и больше (:2561 — от высоты окна). Сброс в 20
	// на запрос 60 оборвал бы листание после первой же страницы.
	q.Limit = clampSearchLimit(q.Limit)
	if q.OffsetRate < 0 {
		q.OffsetRate = 0
	}
	res, err := i.msgs.GlobalSearchMessages(ctx, userID, q)
	if err != nil {
		return GlobalSearchResult{}, err
	}
	msgs := res.Messages
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return GlobalSearchResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	return res, nil
}

// CallLog — журнал звонков пользователя (вкладка «Звонки»): агрегирует
// сообщения type='call' из его личных чатов, новые сверху.
func (i *Interactor) CallLog(ctx context.Context, userID int64, offset, limit int) ([]domain.CallLogEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	if offset < 0 {
		offset = 0
	}
	return i.msgs.CallLog(ctx, userID, offset, limit)
}

// UserState returns the caller's per-user update cursor (pts) and date — sent as
// the WS "hello" frame so a client whose cursor already matches can skip catch-up.
func (i *Interactor) UserState(ctx context.Context, userID int64) (domain.UserState, error) {
	return i.updates.GetUserState(ctx, userID)
}

// GetDifference returns updates with pts>sincePts, split by kind. If the client is
// too far behind, TooLong is set so it can do a full resync (snapshot via ListDialogs).
func (i *Interactor) GetDifference(ctx context.Context, userID, sincePts int64) (Difference, error) {
	if sincePts < 0 {
		sincePts = 0
	}
	state, err := i.updates.GetUserState(ctx, userID)
	if err != nil {
		return Difference{}, err
	}
	if state.Pts-sincePts > tooLongThreshold {
		return Difference{TooLong: true, State: state}, nil
	}
	ups, err := i.updates.UpdatesSince(ctx, userID, sincePts, syncLimit)
	if err != nil {
		return Difference{}, err
	}
	d := Difference{State: state, NewMessages: []SyncUpdate{}, OtherUpdates: []SyncUpdate{}}
	for _, u := range ups {
		su := SyncUpdate{Type: u.Type, Pts: u.Pts, Payload: u.Payload}
		if u.Type == "new_message" {
			d.NewMessages = append(d.NewMessages, su)
		} else {
			d.OtherUpdates = append(d.OtherUpdates, su)
		}
	}
	if len(ups) == syncLimit {
		d.Slice = true
		d.State = domain.UserState{Pts: ups[len(ups)-1].Pts, Date: state.Date}
	}
	return d, nil
}

// PruneUpdateLog trims the per-user update log so it can't grow without bound (one
// row is written per recipient per event). Keeps tooLongThreshold pts of history
// per user — exactly the window within which /sync serves a diff; anyone further
// behind already gets a full resync (too_long), so older rows are dead weight.
// Bounded per call (maxRows) so a large initial backlog drains across ticks
// instead of one giant locking DELETE. Returns rows deleted.
func (i *Interactor) PruneUpdateLog(ctx context.Context) (int64, error) {
	const maxRowsPerRun = 20000
	return i.updates.PruneUpdates(ctx, tooLongThreshold, maxRowsPerRun)
}
