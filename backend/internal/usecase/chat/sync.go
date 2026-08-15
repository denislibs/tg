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
	// исходный threadRoot) идёт и в prependForeignThreadRoot ниже: корневой
	// бабл треда — это САМО зеркало (см. её комментарий), а зеркало лежит в
	// ЭТОМ чате под id queryRoot, а не под id поста в канале.
	queryRoot := i.resolveThreadRootForQuery(ctx, chatID, threadRoot)
	msgs, err := i.msgs.GetHistory(ctx, chatID, userID, offsetSeq, addOffset, limit, queryRoot, cleared, tag)
	if err != nil {
		return HistoryResult{}, err
	}
	// Верх треда достигнут (короткая страница при чтении от新ейших/старее) —
	// подшиваем корневой бабл треда первым сообщением, если пагинация его не
	// зацепила (tweb: пост форварднут в discussion-группу и открывает тред).
	if threadRoot != nil && len(msgs) < limit && addOffset >= 0 {
		msgs = i.prependForeignThreadRoot(ctx, chatID, userID, *queryRoot, msgs)
	}
	if e := i.hydrateReplies(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	_ = i.hydrateReactions(ctx, userID, msgs)
	i.hydrateStarReactions(ctx, userID, msgs)
	i.hydrateSendAs(ctx, msgs)
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

// prependForeignThreadRoot подшивает корневой бабл треда первым сообщением
// окна синтетическим seq=0, если пагинация его не захватила. root —
// РЕЗОЛВЛЕННЫЙ id (см. вызывающих: queryRoot из resolveThreadRootForQuery) —
// для discussion-группы это id ЗЕРКАЛА поста (лежит в ТОМ ЖЕ чате chatID,
// не в канале), для форум-топика — id сообщения темы (тоже в chatID).
//
// История правок (обе — находки ревью):
//
//  1. Раньше сюда передавали исходный threadRoot (id ПОСТА, внешний
//     контракт) — сравнение `m.ID == threadRoot` никогда не совпадало с
//     зеркалом (у него другой, внутренний id), поэтому функция каждый раз
//     считала, что корня в окне нет, шла в канал за ОРИГИНАЛОМ поста
//     (GetByID(id поста)) и подшивала его — а зеркало с тем же текстом уже
//     приезжало в msgs через SQL-условие `thread_root_id=root OR id=root`
//     (MessagesRepo.GetHistory/GetAround). Один и тот же пост дважды.
//     Почина — сравнивать по РЕЗОЛВЛЕННОМУ root (см. сигнатуру).
//  2. Фикс (1) по пути снял проверку `rootMsg.ChatID == chatID` — идея
//     была «зеркало обязано быть видно всегда, эти фильтры на него не
//     действуют». Регрессия: для форум-топика (root физически в ЭТОМ ЖЕ
//     chatID) это заставляло синтетически показывать корень темы, даже
//     если персональная видимость (message_hides/clearedSeq/
//     history_for_new) намеренно его скрыла — то, что раньше уважалось.
//     Проверка возвращена: если root физически в ЭТОМ ЖЕ чате, но не попал
//     в окно — значит видимость исключила его намеренно, форсировать показ
//     нельзя (ни для форум-топика, ни для зеркала — единообразно, без
//     специального обхода для зеркала: обход не был частью исходного
//     требования блокера, только дедупликация).
//
// Если root физически в ДРУГОМ чате (после резолва queryRoot это уже НЕ
// штатный кейс discussion-группы — там root всегда в chatID; остаётся
// только вырожденный путь resolveThreadRootForQuery, когда i.groups==nil
// или сбоит IsDiscussionGroup, и thread_root долетает сюда НЕпереведённым,
// всё ещё указывая на пост в другом чате) — GetByID сам по себе доступ не
// проверяет (PK-резолв по любому чату), поэтому без явной проверки
// членства `?thread_root=<id чужого сообщения>` подшивал бы контент ИЗ
// ЛЮБОГО чужого чата, включая приватные, независимо от того, есть ли у
// запрашивающего туда доступ (дыра, найдена ревью). Подшиваем такой корень,
// только если userID реально состоит в его чате.
func (i *Interactor) prependForeignThreadRoot(ctx context.Context, chatID, userID, root int64, msgs []domain.Message) []domain.Message {
	for _, m := range msgs {
		if m.ID == root {
			return msgs // корень уже в окне
		}
	}
	rootMsg, err := i.msgs.GetByID(ctx, root)
	if err != nil || rootMsg.Deleted {
		return msgs
	}
	if rootMsg.ChatID == chatID {
		// В своём чате, но вне окна — видимость (message_hides/clearedSeq/
		// history_for_new) исключила его намеренно; не форсируем показ.
		return msgs
	}
	// Чужой чат — легитимно только в вырожденном случае, см. комментарий
	// функции; проверяем реальный доступ, а не доверяем самому факту «не
	// тот чат».
	if ok, e := i.chats.IsMember(ctx, rootMsg.ChatID, userID); e != nil || !ok {
		return msgs
	}
	rootMsg.Seq = 0
	return append([]domain.Message{rootMsg}, msgs...)
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

// hydrateSendAs fills SendAsTitle/SendAsPhotoID (the displayed author) on
// messages sent "as" a channel/group (send_as), batch-fetching chat briefs.
// Best-effort: cosmetic, a failure must not break history.
func (i *Interactor) hydrateSendAs(ctx context.Context, msgs []domain.Message) {
	if i.groups == nil {
		return
	}
	var ids []int64
	seen := map[int64]bool{}
	for _, m := range msgs {
		if m.SendAsChatID != nil && !seen[*m.SendAsChatID] {
			seen[*m.SendAsChatID] = true
			ids = append(ids, *m.SendAsChatID)
		}
	}
	if len(ids) == 0 {
		return
	}
	briefs, err := i.groups.ChatBriefs(ctx, ids)
	if err != nil {
		return
	}
	for k := range msgs {
		if msgs[k].SendAsChatID == nil {
			continue
		}
		if b, ok := briefs[*msgs[k].SendAsChatID]; ok {
			msgs[k].SendAsTitle, msgs[k].SendAsPhotoID = b.Title, b.PhotoID
		}
	}
}

// hydrateReactions fills Reactions (emoji aggregates + the viewer's mine flag) on
// a window of messages with one batch query. Best-effort: reactions are cosmetic,
// a failure must not break history.
func (i *Interactor) hydrateReactions(ctx context.Context, viewerID int64, msgs []domain.Message) error {
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

// hydrateReplies fills ReplyTo on each message that replies to another, batch-
// fetching the targets by id (one query). Deleted/missing targets are skipped.
func (i *Interactor) hydrateReplies(ctx context.Context, msgs []domain.Message) error {
	ids := make([]int64, 0)
	seen := map[int64]bool{}
	for _, m := range msgs {
		// Кросс-чат-ответ: оригинал в ДРУГОМ чате — его контент НЕ подтягиваем
		// (клиент рисует превью из снимка reply_snapshot_*). Иначе любой участник
		// вычитал бы содержимое чужого чата через историю.
		if m.ReplyToPeerID != nil {
			continue
		}
		if m.ReplyToID != nil && !seen[*m.ReplyToID] {
			seen[*m.ReplyToID] = true
			ids = append(ids, *m.ReplyToID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	targets, err := i.msgs.GetByIDs(ctx, ids)
	if err != nil {
		return err
	}
	byID := make(map[int64]domain.Message, len(targets))
	for _, t := range targets {
		byID[t.ID] = t
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
		t, ok := byID[*rid]
		// defense-in-depth: оригинал только из того же чата, что и ответ; иначе
		// пропускаем (не даём просочиться контенту чужого чата).
		if !ok || t.Deleted || t.ChatID != msgs[idx].ChatID {
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
		msgs[idx].ReplyTo = &domain.ReplyPreview{MsgID: t.ID, Seq: t.Seq, SenderID: t.SenderID, Text: text, Entities: entities, Type: t.Type, MediaID: t.MediaID, QuoteText: quote}
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
		if d, ok := dims[*msgs[idx].MediaID]; ok {
			msgs[idx].MediaWidth = d.Width
			msgs[idx].MediaHeight = d.Height
			msgs[idx].MediaMime = d.Mime
			msgs[idx].MediaBlur = d.Blur
			msgs[idx].MediaHasThumb = d.HasThumb
			msgs[idx].MediaDuration = d.Duration
			msgs[idx].MediaSize = d.Size
			msgs[idx].MediaName = d.FileName
			msgs[idx].MediaTitle = d.Title
			msgs[idx].MediaPerformer = d.Performer
		}
	}
	return nil
}

// AroundResult is a jump-to-message window: messages around a seq + end flags.
type AroundResult struct {
	Messages      []domain.Message
	ReachedTop    bool
	ReachedBottom bool
	Count         int
}

// GetHistoryAround returns a window centered on centerSeq (for jump-to-message),
// with reply previews hydrated.
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
	// см. GetHistory — тот же перевод id поста -> id зеркала для запроса,
	// queryRoot (не исходный threadRoot) идёт и в prependForeignThreadRoot.
	queryRoot := i.resolveThreadRootForQuery(ctx, chatID, threadRoot)
	msgs, top, bottom, err := i.msgs.GetAround(ctx, chatID, userID, centerSeq, limit, queryRoot, cleared)
	if err != nil {
		return AroundResult{}, err
	}
	if threadRoot != nil && top {
		msgs = i.prependForeignThreadRoot(ctx, chatID, userID, *queryRoot, msgs)
	}
	if e := i.hydrateReplies(ctx, msgs); e != nil {
		return AroundResult{}, e
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return AroundResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	_ = i.hydrateReactions(ctx, userID, msgs)
	i.hydrateStarReactions(ctx, userID, msgs)
	i.hydrateSendAs(ctx, msgs)
	var count int
	if threadRoot != nil {
		count, err = i.msgs.CountThread(ctx, chatID, *queryRoot)
	} else {
		count, err = i.msgs.CountMessages(ctx, chatID)
	}
	if err != nil {
		return AroundResult{}, err
	}
	return AroundResult{Messages: msgs, ReachedTop: top, ReachedBottom: bottom, Count: count}, nil
}

// SearchMessages returns messages in a chat matching q (newest first) + total count.
// MediaHistory lists a chat's shared media of one kind (profile tabs).
func (i *Interactor) MediaHistory(ctx context.Context, chatID, userID int64, filter string, offset, limit int) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	if limit <= 0 || limit > 60 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.MediaHistory(ctx, chatID, filter, offset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// SearchFilter сужает поиск внутри чата (tweb topbarSearch): по автору (в
// группах), по виду шаред-медиа и по наличию реакции на сообщении. Нулевые
// значения отключают соответствующий фильтр.
type SearchFilter struct {
	SenderID  int64  // фильтр по автору (0 — любой)
	MediaType string // photo/video/voice/roundvideo/file/link/music ("" — любой)
	Reaction  string // сообщения, у которых есть эта реакция ("" — любая)
}

// empty — фильтр не задан (ни автор, ни тип, ни реакция).
func (f SearchFilter) empty() bool {
	return f.SenderID == 0 && f.MediaType == "" && f.Reaction == ""
}

func (i *Interactor) SearchMessages(ctx context.Context, chatID, userID int64, q string, f SearchFilter, offset, limit int) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	// Пустой запрос без фильтров искать нечего (tweb: пустая строка + нет чипов).
	if q == "" && f.empty() {
		return HistoryResult{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.SearchMessages(ctx, chatID, q, f, offset, limit)
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

// CalendarMonth — медиа-превью по дням месяца для пикера даты (tweb
// getSearchResultsCalendar). Полуинтервал [from, to). Не участник — ErrNotFound.
func (i *Interactor) CalendarMonth(ctx context.Context, chatID, userID int64, from, to time.Time) ([]domain.CalendarDay, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.msgs.CalendarMonth(ctx, chatID, from, to)
}

// GlobalSearchMessages searches messages across every chat the user belongs to
// (tweb global search). filter ∈ {"", media, files, links, music, voice}; with
// an empty q AND empty filter there is nothing to search — returns empty.
func (i *Interactor) GlobalSearchMessages(ctx context.Context, userID int64, q, filter string, offset, limit int) (HistoryResult, error) {
	if q == "" && filter == "" {
		return HistoryResult{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.GlobalSearchMessages(ctx, userID, q, filter, offset, limit)
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
