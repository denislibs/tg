package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

type ChatHandler struct{ svc *usecasechat.Interactor }

func NewChatHandler(svc *usecasechat.Interactor) *ChatHandler { return &ChatHandler{svc: svc} }

func (h *ChatHandler) meID(r *http.Request) int64 {
	u, _ := UserFromContext(r.Context())
	return u.ID
}

type createChatBody struct {
	UserID int64 `json:"user_id"`
}

func (h *ChatHandler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	var body createChatBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	if _, err := h.svc.CreatePrivateChat(r.Context(), h.meID(r), body.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create chat")
		return
	}
	// Наружу — ключ пира, а не id строки в chats: для приватного диалога это id
	// СОБЕСЕДНИКА (см. usecase/chat/peeraddr.go).
	// Ответ — КОНСТРУКТОР ключа (`peerUser`/`peerChannel`), а не число под
	// именем поля: адрес у оригинала это `Peer`, и обёртки вокруг него нет.
	writeJSON(w, http.StatusOK, domain.NewPeer(domain.PeerID(body.UserID)))
}

type secretCreateBody struct {
	PeerID int64  `json:"peer_id"`
	Pub    string `json:"pub"` // base64 публичного ECDH-ключа инициатора
}

func (h *ChatHandler) CreateSecretChat(w http.ResponseWriter, r *http.Request) {
	var body secretCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PeerID == 0 || body.Pub == "" {
		writeError(w, http.StatusBadRequest, "peer_id and pub are required")
		return
	}
	pub, err := base64.StdEncoding.DecodeString(body.Pub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid pub")
		return
	}
	sc, err := h.svc.CreateSecretChat(r.Context(), h.meID(r), body.PeerID, pub)
	if h.writeSecretErr(w, err) {
		return
	}
	// Стадия handshake — КОНСТРУКТОР объединения `EncryptedChat`, а не строка
	// рядом с ключом: вместе со стадией меняется и набор полей.
	writeJSON(w, http.StatusOK, domain.NewEncryptedChat(sc))
}

type secretAcceptBody struct {
	Pub string `json:"pub"` // base64 публичного ECDH-ключа получателя
}

func (h *ChatHandler) AcceptSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var body secretAcceptBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Pub == "" {
		writeError(w, http.StatusBadRequest, "pub is required")
		return
	}
	pub, err := base64.StdEncoding.DecodeString(body.Pub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid pub")
		return
	}
	sc, err := h.svc.AcceptSecretChat(r.Context(), chatID, h.meID(r), pub)
	if h.writeSecretErr(w, err) {
		return
	}
	// Стадия handshake — КОНСТРУКТОР объединения `EncryptedChat`, а не строка
	// рядом с ключом: вместе со стадией меняется и набор полей.
	writeJSON(w, http.StatusOK, domain.NewEncryptedChat(sc))
}

func (h *ChatHandler) RejectSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.RejectSecretChat(r.Context(), chatID, h.meID(r)); h.writeSecretErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// writeSecretErr maps handshake errors to HTTP; returns true if it wrote a response.
// GetSecretChat отдаёт состояние handshake участнику (state + публичные ключи),
// чтобы UI восстановил рукопожатие после перезагрузки (accept/complete).
func (h *ChatHandler) GetSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	sc, err := h.svc.GetSecretChat(r.Context(), chatID, h.meID(r))
	if h.writeSecretErr(w, err) {
		return
	}
	// Тот же конструктор, что у создания и принятия: стадию называет он сам, а
	// ключ стороны едет там, где его объявляет схема (`g_a` у запроса,
	// `g_a_or_b` у установленного).
	writeJSON(w, http.StatusOK, domain.NewEncryptedChat(sc))
}

func (h *ChatHandler) writeSecretErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "secret chats not available")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid request")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "secret chat not found")
	default:
		writeError(w, http.StatusInternalServerError, "handshake failed")
	}
	return true
}

type translateBody struct {
	Text   string `json:"text"`
	ToLang string `json:"to_lang"`
}

// Translate переводит произвольный текст (сообщение/фрагмент) на to_lang через
// сконфигурированный провайдер (LibreTranslate). 503, если перевод отключён.
func (h *ChatHandler) Translate(w http.ResponseWriter, r *http.Request) {
	var body translateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.TranslateText(r.Context(), body.Text, body.ToLang)
	switch {
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "translation not available")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusBadRequest, "text and to_lang are required")
		return
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "text too long")
		return
	case err != nil:
		writeError(w, http.StatusBadGateway, "translation failed")
		return
	}
	// Язык-источник у конструктора не предусмотрен вовсе: перевод просят НА
	// язык, а не С языка, и оригинал источник не возвращает.
	writeJSON(w, http.StatusOK, domain.NewMessagesTranslateResult(res.Text))
}

type geoLiveBody struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Heading *int    `json:"heading"`
	Stopped bool    `json:"stopped"`
}

// UpdateGeoLive — POST /chats/{chatID}/messages/{msgID}/geo_live: автор обновляет
// координаты своей live-локации (watchPosition) или останавливает трансляцию.
func (h *ChatHandler) UpdateGeoLive(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	var body geoLiveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.UpdateLiveLocation(r.Context(), chatID, msgID, h.meID(r), body.Lat, body.Lng, body.Heading, body.Stopped)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not a live location")
		return
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeMessage(w, r, h.svc, msg)
}

// Saved returns (creating on first access) the caller's "Saved Messages" chat.
func (h *ChatHandler) Saved(w http.ResponseWriter, r *http.Request) {
	if _, err := h.svc.GetOrCreateSaved(r.Context(), h.meID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not open saved messages")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewPeer(domain.PeerID(h.meID(r))))
}

// SavedDialogs returns the grouped «Чаты»-tab rows of the caller's Saved Messages.
func (h *ChatHandler) SavedDialogs(w http.ResponseWriter, r *http.Request) {
	me := h.meID(r)
	page, err := h.svc.SavedDialogsPage(r.Context(), me)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list saved dialogs")
		return
	}
	dialogs := make([]domain.SavedDialog, 0, len(page.Dialogs))
	for _, d := range page.Dialogs {
		// «Мои заметки» — строка, чей источник это сам зритель: вида строкой
		// (`kind`) больше нет, его отвечает сам ключ.
		peer := d.PeerID
		if peer == 0 {
			peer = domain.PeerID(me)
		}
		dialogs = append(dialogs, domain.NewSavedDialog(domain.NewPeer(peer), d.LastMsgSeq))
	}
	msgs, err := h.svc.MessagesWire(r.Context(), me, page.Messages)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render saved dialogs")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesSavedDialogs(dialogs, msgs, page.Chats, page.Users))
}

// queryFolder — реальная папка из query. Значения на проводе — как у tweb
// (FOLDER_ID_ALL=0, FOLDER_ID_ARCHIVE=1); отсутствие параметра и любое другое
// значение означают «папка не указана», то есть весь набор: у оригинала это
// GLOBAL_FOLDER_ID = undefined (storages/dialogs.ts:68), и деградация к нему
// безопаснее 400 — клиент с неизвестным номером папки увидит больше диалогов, а
// не пустой список.
//
// Имя не dialogFolder: так называется КОНСТРУКТОР схемы (строка-папка в списке
// чатов), и функция разбора query им называться не может.
func queryFolder(r *http.Request) *domain.FolderID {
	switch queryInt(r, "folder_id", -1) {
	case 0:
		f := domain.FolderAll
		return &f
	case 1:
		f := domain.FolderArchive
		return &f
	default:
		return nil
	}
}

// ListDialogs — GET /chats?limit=&offset_peer_id=&folder_id=: без параметров
// отдаёт весь список, с ними — страницу по курсору peer_id внутри реальной
// папки.
//
// Ответ — КОНТЕЙНЕР схемы (решение Р1): messages.dialogs, когда список отдан
// целиком, и messages.dialogsSlice{count, …}, когда отдан кусок. Булева is_end
// больше нет: «это всё» выражает ОТСУТСТВИЕ count, как читает оригинал
// (tweb appMessagesManager.ts:3614,3629 — `isEnd = !count || …`).
//
// Ключ `chats` при этом наконец начинает означать ЧАТЫ, а не строки диалогов:
// строки едут в `dialogs`, тела групп и каналов — в `chats`, собеседники и
// авторы последних сообщений — в `users`, сами последние сообщения — в
// `messages`.
func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 0)
	if limit < 0 {
		// Отрицательный limit — не 400: клиента с таким запросом нет,
		// тихая деградация к «весь список» безопаснее.
		limit = 0
	}
	// Курсор приезжает ключом пира; внутрь домена он идёт chatID — неизвестный
	// (диалог уехал в архив/удалён между страницами) означает «с начала», ровно
	// как трактует неизвестный id сам домен.
	var offsetChatID int64
	if cur := queryPeer(r, "offset_peer_id", domain.NullPeerID); cur != domain.NullPeerID {
		offsetChatID, _ = h.svc.PeerToChatID(r.Context(), h.meID(r), cur)
	}
	page := domain.DialogPage{
		Limit:        int(limit),
		OffsetChatID: offsetChatID,
		Folder:       queryFolder(r),
	}
	res, err := h.svc.DialogsPage(r.Context(), h.meID(r), page)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	// Вектор messages контейнера — те же конструкторы схемы, что отдаёт история:
	// временный стык «проводной рендерер из delivery/http» закрыт, и вектор
	// наконец покрыт сверкой со схемой вместе с остальными тремя.
	wire, err := messagesJSON(r.Context(), h.svc, res.Messages)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	messages := make([]any, 0, len(wire))
	for _, m := range wire {
		messages = append(messages, m)
	}
	if res.Whole {
		writeJSON(w, http.StatusOK,
			domain.NewMessagesDialogs(res.Dialogs, messages, res.Chats, res.Users))
		return
	}
	writeJSON(w, http.StatusOK,
		domain.NewMessagesDialogsSlice(res.Count, res.Dialogs, messages, res.Chats, res.Users))
}

type sendBody struct {
	Type     string                 `json:"type"`
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
	// reply_to_id — НОМЕР отвечаемого сообщения (schema reply_to_msg_id);
	// reply_to_peer_id — ключ пира, когда отвечают в ДРУГОЙ чат (его отсутствие
	// значит «тот же пир»). Порознь они сообщение не адресуют.
	ReplyToID     *int64         `json:"reply_to_id"`
	ReplyToPeerID *domain.PeerID `json:"reply_to_peer_id"`
	// ответ с цитатой фрагмента (Telegram reply quote): текст + offset (UTF-16)
	ReplyQuoteText   *string `json:"reply_quote_text"`
	ReplyQuoteOffset *int    `json:"reply_quote_offset"`
	ClientMsgID      string  `json:"client_msg_id"`
	MediaID          *int64  `json:"media_id"`
	GroupedID        int64   `json:"grouped_id"`
	// сообщение в тред (форум-топик/комментарии): НОМЕР корневого сообщения
	ThreadRootID *int64 `json:"thread_root_id"`
	// гео-точка (type 'geo') / контакт (type 'contact')
	GeoLat        *float64 `json:"geo_lat"`
	GeoLng        *float64 `json:"geo_lng"`
	GeoTitle      *string  `json:"geo_title"`
	GeoAddress    *string  `json:"geo_address"`
	GeoLivePeriod *int     `json:"geo_live_period"`
	GeoHeading    *int     `json:"geo_heading"`
	ContactUserID *int64   `json:"contact_user_id"`
	// Платное медиа (Telegram paid media): цена доступа в звёздах. nil/<=0 — обычное
	// медиа; применяется только к фото/видео с прикреплённым media_id.
	PaidMediaPrice *int64 `json:"paid_media_price"`
	// Скрыть медиа спойлером (Telegram messageMedia.pFlags.spoiler); работает
	// только вместе с media_id.
	MediaSpoiler bool `json:"media_spoiler"`
	// Отправка от имени канала/группы (Telegram send_as); nil — от себя.
	SendAsPeerID *domain.PeerID `json:"send_as_peer_id"`
	// Call — исход звонка: сервер кладёт в чат СЛУЖЕБНОЕ сообщение
	// messageActionPhoneCall. Прежде клиент присылал type == "call" и JSON
	// {video, reason, duration} внутри ТЕКСТА — та же подделка дискриминатора,
	// что у служебных действий, только в другом поле.
	Call *callBody `json:"call"`
}

// callBody — исход завершившегося 1:1 звонка глазами клиента, который его вёл.
type callBody struct {
	Video    bool   `json:"video"`
	Reason   string `json:"reason"` // missed|busy|cancelled|ok
	Duration int    `json:"duration"`
}

// callAction — конструктор лога звонка из тела запроса (nil — звонка нет).
// Единственный способ, которым клиент может создать СЛУЖЕБНОЕ сообщение:
// произвольное действие он назначить не может, поле action на входе не
// существует вовсе.
func callAction(b *callBody) domain.MessageAction {
	if b == nil {
		return nil
	}
	return usecasechat.PhoneCallAction(b.Video, b.Reason, b.Duration)
}

func (h *ChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var body sendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// «Служебное ли» и «лог звонка ли» — ВЫБОР КОНСТРУКТОРА, а не значение
	// поля type: клиент называет исход звонка полем call, всё остальное
	// служебное производит сервер.
	if body.Type == "service" || body.Type == "call" {
		writeError(w, http.StatusBadRequest, "invalid type")
		return
	}
	replyPeer, ok := replyPeerChatID(w, r, h.svc, body.ReplyToPeerID)
	if !ok {
		return
	}
	// thread_root_id с клиента — НОМЕР ПОСТА (внешний контракт); в discussion-группе
	// физически нужен id зеркала (см. ResolveThreadRootForSend). Резолвим здесь,
	// на входе, а не внутри Send — PostComment туда уже шлёт id зеркала.
	// Ошибка (нет зеркала и дозавести нечего) — понятный 404, а не запись
	// sentinel-нуля в thread_root_id (см. комментарий ResolveThreadRootForSend).
	threadRoot, terr := h.svc.ResolveThreadRootForSend(r.Context(), chatID, body.ThreadRootID)
	if errors.Is(terr, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment thread not found")
		return
	}
	if terr != nil {
		writeError(w, http.StatusInternalServerError, "send failed")
		return
	}
	msg, err := h.svc.Send(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: body.Type, Text: body.Text, Entities: body.Entities,
		ReplyToID: body.ReplyToID, ReplyToPeerID: replyPeer,
		ReplyQuoteText: body.ReplyQuoteText, ReplyQuoteOffset: body.ReplyQuoteOffset,
		ClientMsgID: body.ClientMsgID, MediaID: body.MediaID, GroupedID: body.GroupedID,
		ThreadRootID: threadRoot,
		GeoLat:       body.GeoLat, GeoLng: body.GeoLng, ContactUserID: body.ContactUserID,
		GeoTitle: body.GeoTitle, GeoAddress: body.GeoAddress,
		GeoLivePeriod: body.GeoLivePeriod, GeoHeading: body.GeoHeading,
		PaidMediaPrice: body.PaidMediaPrice,
		MediaSpoiler:   body.MediaSpoiler,
		SendAsChatID:   sendAsChatID(body.SendAsPeerID),
		Action:         callAction(body.Call),
	})
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "message too long")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if errors.Is(err, domain.ErrSlowmode) {
		writeError(w, http.StatusTooManyRequests, "slowmode")
		return
	}
	if errors.Is(err, domain.ErrPrivacy) {
		writeError(w, http.StatusForbidden, "privacy")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "send failed")
		return
	}
	writeMessage(w, r, h.svc, msg)
}

func (h *ChatHandler) History(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	limit := int(queryInt(r, "limit", 40))
	// Тред (форум-топик / комментарии): ?thread_root=<номер корня> ограничивает окно.
	var threadRoot *int64
	if tr := queryInt(r, "thread_root", 0); tr > 0 {
		threadRoot = &tr
	}
	// Jump-to-message: ?around=<seq> returns a window centered on that message.
	if around := queryInt(r, "around", 0); around > 0 {
		a, err := h.svc.GetHistoryAround(r.Context(), chatID, h.meID(r), around, limit, threadRoot)
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusForbidden, "not a member of this chat")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "history failed")
			return
		}
		writeMessagesSlice(w, r, h.svc, a.Count, a.Messages)
		return
	}
	offsetSeq := queryInt(r, "offset_id", 0)
	addOffset := int(queryInt(r, "add_offset", 0))
	// ?tag=<реакция> — фильтр «Избранного» по тегу-реакции (tweb search by saved tag).
	tag := r.URL.Query().Get("tag")
	res, err := h.svc.GetHistory(r.Context(), chatID, h.meID(r), offsetSeq, addOffset, limit, threadRoot, tag)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		log.Printf("history failed chat=%d: %v", chatID, err)
		writeError(w, http.StatusInternalServerError, "history failed")
		return
	}
	writeMessagesSlice(w, r, h.svc, res.Count, res.Messages)
}

// MessagesByIDs — GET /chats/{peerID}/messages?ids=1,2,3: сообщения по их
// НОМЕРАМ, и ПРОИЗВОДИТЕЛЬ конструктора messageEmpty.
//
// Пока ссылки на другие сообщения ехали снимками, разрешать их было незачем.
// Теперь reply_to, reply_to_top_id и цель закрепления — ссылки, и на ссылку в
// удалённое сообщение сервер обязан отвечать ДЫРОЙ, а не молчанием: без неё
// клиент не отличает «ещё не загружено» от «больше не существует» и ждёт
// вечно. Ровно так устроен messages.getMessages у оригинала.
//
// Порядок ответа повторяет порядок запроса: клиент сопоставляет ссылку с
// объектом по позиции и по id, а не догадывается по длине вектора.
func (h *ChatHandler) MessagesByIDs(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	parts := strings.Split(r.URL.Query().Get("ids"), ",")
	ids := make([]int64, 0, len(parts))
	for _, s := range parts {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid ids")
			return
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		writeJSON(w, http.StatusOK, domain.NewMessagesMessages(nil, nil, nil))
		return
	}
	found, err := h.svc.MessagesBySeqs(r.Context(), chatID, h.meID(r), ids)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "history failed")
		return
	}
	wire, users, err := h.svc.MessagesContainer(r.Context(), h.meID(r), found)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render messages")
		return
	}
	bySeq := make(map[int64]domain.MTMessage, len(wire))
	for idx, m := range wire {
		bySeq[found[idx].Seq] = m
	}
	peer := peerOf(r, h.svc, chatID)
	out := make([]domain.MTMessage, 0, len(ids))
	for _, id := range ids {
		if m, ok := bySeq[id]; ok {
			out = append(out, m)
			continue
		}
		out = append(out, usecasechat.EmptyMessages(peer, []int64{id})[0])
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesMessages(out, nil, users))
}

type readBody struct {
	UpToSeq int64 `json:"up_to_seq"`
}

func (h *ChatHandler) Read(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var body readBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.svc.MarkRead(r.Context(), chatID, h.meID(r), body.UpToSeq)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ReadDate — GET /chats/{chatID}/messages/{msgID}/read_date: когда получатель
// прочитал исходящее сообщение в приватном чате (tweb getOutboxReadDate).
// 403 YOUR_PRIVACY_RESTRICTED — read-time скрыт (взаимность); 404 — read-date
// недоступна (не приватный/не исходящее/ещё не прочитано) → клиент прячет строку.
func (h *ChatHandler) ReadDate(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	at, err := h.svc.OutboxReadDate(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "YOUR_PRIVACY_RESTRICTED")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no read date")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read date failed")
		return
	}
	// Дата в СЕКУНДАХ эпохи — как у всех дат схемы; строка RFC 3339 ушла.
	writeJSON(w, http.StatusOK, domain.NewOutboxReadDate(at))
}

// ReadReactions clears the caller's unread-reactions badge for a chat
// (POST /chats/{chatID}/reactions/read; Telegram readReactions) without moving
// the read horizon.
func (h *ChatHandler) ReadReactions(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	err := h.svc.ReadReactions(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read reactions failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ClearHistory clears the caller's copy of the chat history (POST
// /chats/{chatID}/clear; Telegram «Очистить историю» — у себя): messages stay
// for everyone else, only this user's window is emptied.
func (h *ChatHandler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	err := h.svc.ClearHistory(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "clear failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

type editBody struct {
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
}

func (h *ChatHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	var body editBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.EditMessage(r.Context(), chatID, msgID, h.meID(r), body.Text, body.Entities)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "only the author can edit")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "message too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "edit failed")
		return
	}
	writeMessage(w, r, h.svc, msg)
}

type factCheckBody struct {
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
	Country  string                 `json:"country"`
}

// SetFactCheck — POST /chats/{chatID}/messages/{msgID}/factcheck: прикрепить/
// изменить «проверку фактов» (право — автор/админ канала).
func (h *ChatHandler) SetFactCheck(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	var body factCheckBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.SetFactCheck(r.Context(), chatID, msgID, h.meID(r), body.Text, body.Entities, body.Country)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed to edit fact check")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "fact check text is required")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "fact check too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "set fact check failed")
		return
	}
	writeMessage(w, r, h.svc, msg)
}

// RemoveFactCheck — DELETE /chats/{chatID}/messages/{msgID}/factcheck.
func (h *ChatHandler) RemoveFactCheck(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	err := h.svc.RemoveFactCheck(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed to edit fact check")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "remove fact check failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// TranscribeMessage — POST /chats/{chatID}/messages/{msgID}/transcribe: расшифровка
// голосового/видео-кружка (Telegram messages.transcribeAudio). Реального движка STT
// нет — сервер отдаёт детерминированный демо-стаб и кэширует его. pending всегда
// false (расшифровка синхронна).
func (h *ChatHandler) TranscribeMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	text, err := h.svc.TranscribeMessage(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not a member")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "message is not transcribable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "transcribe failed")
		return
	}
	// «Ещё расшифровывается» — ФЛАГ конструктора: его отсутствие и есть «готово».
	writeJSON(w, http.StatusOK, domain.NewMessagesTranscribedAudio(text, false))
}

func (h *ChatHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	revoke := r.URL.Query().Get("revoke") == "true"
	err := h.svc.DeleteMessage(r.Context(), chatID, msgID, h.meID(r), revoke)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "only the author can delete for everyone")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

type forwardBody struct {
	FromPeerID domain.PeerID `json:"from_peer_id"`
	// ids — НОМЕРА пересылаемых сообщений у пира-источника (schema
	// messages.forwardMessages: id:Vector<int> вместе с from_peer).
	Seqs        []int64 `json:"ids"`
	DropAuthor  bool    `json:"drop_author"`
	DropCaption bool    `json:"drop_caption"`
}

func (h *ChatHandler) Forward(w http.ResponseWriter, r *http.Request) {
	toChatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var body forwardBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FromPeerID == domain.NullPeerID || len(body.Seqs) == 0 {
		writeError(w, http.StatusBadRequest, "from_peer_id and ids are required")
		return
	}
	fromChatID, ok := resolveBodyPeer(w, r, h.svc, body.FromPeerID, false)
	if !ok {
		return
	}
	// Номера у пира-источника — во внутренние ключи строк. Номера, которых
	// в том чате нет, отваливаются здесь, а не превращаются в чужие ключи.
	msgIDs, _, err := msgSeqIDs(r.Context(), h.svc, fromChatID, body.Seqs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "forward failed")
		return
	}
	if len(msgIDs) == 0 {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	msgs, err := h.svc.ForwardMessages(r.Context(), usecasechat.ForwardInput{
		FromChatID: fromChatID, ToChatID: toChatID, MsgIDs: msgIDs, SenderID: h.meID(r),
		DropAuthor: body.DropAuthor, DropCaption: body.DropCaption,
	})
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member or message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "forward failed")
		return
	}
	writeMessagesAll(w, r, h.svc, msgs)
}

func (h *ChatHandler) Pin(w http.ResponseWriter, r *http.Request)   { h.setPin(w, r, true) }
func (h *ChatHandler) Unpin(w http.ResponseWriter, r *http.Request) { h.setPin(w, r, false) }

func (h *ChatHandler) setPin(w http.ResponseWriter, r *http.Request, pin bool) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	err := h.svc.SetPin(r.Context(), chatID, msgID, h.meID(r), pin)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pin failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *ChatHandler) ListPins(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgs, err := h.svc.ListPins(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list pins")
		return
	}
	writeMessagesAll(w, r, h.svc, msgs)
}

func (h *ChatHandler) Viewers(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	ids, err := h.svc.MessageViewers(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load viewers")
		return
	}
	// Ответ — ВЕКТОР объявленных строк (`readParticipantDate`), а не список
	// голых чисел под именем поля. Дату прочтения мы не храним, и это
	// названный пропуск (OmittedWithoutSubject).
	out := make([]domain.ReadParticipantDate, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.NewReadParticipantDate(id))
	}
	writeJSON(w, http.StatusOK, out)
}

// NextMention serves «jump to next @»: GET /chats/{peerID}/mentions/next?after_seq=
// returns the id (номер в чате) of the caller's earliest unread mention past after_seq
// (404 when there's none). Powers the floating mention button in the open chat.
func (h *ChatHandler) NextMention(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	afterSeq := queryInt(r, "after_seq", 0)
	seq, err := h.svc.NextMention(r.Context(), chatID, h.meID(r), afterSeq)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no unread mention")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load mention")
		return
	}
	// Ответ — САМ номер: обёртка `{"id": …}` конструктора не имеет, а `int`
	// это объявленный тип схемы.
	writeJSON(w, http.StatusOK, seq)
}

// MediaHistory serves the profile's shared-media tabs:
// GET /chats/{chatID}/media?filter=media|files|links|music|voice
func (h *ChatHandler) MediaHistory(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	filter := r.URL.Query().Get("filter")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 30))
	res, err := h.svc.MediaHistory(r.Context(), chatID, h.meID(r), filter, offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "media history failed")
		return
	}
	writeMessagesSlice(w, r, h.svc, res.Count, res.Messages)
}

func (h *ChatHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	q := r.URL.Query().Get("q")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 20))
	// tweb topbarSearch: необязательные фильтры автор/тип медиа/реакция.
	f := usecasechat.SearchFilter{
		SenderID:  queryInt(r, "sender_id", 0),
		MediaType: r.URL.Query().Get("media_type"),
		Reaction:  r.URL.Query().Get("reaction"),
	}
	res, err := h.svc.SearchMessages(r.Context(), chatID, h.meID(r), q, f, offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	writeMessagesSlice(w, r, h.svc, res.Count, res.Messages)
}

// MessageByDate — GET /chats/{chatID}/message_by_date?date=<unix>: seq
// ближайшего сообщения на/после даты (jump-to-date, tweb datePicker/onDatePick).
func (h *ChatHandler) MessageByDate(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	date := queryInt(r, "date", 0)
	seq, err := h.svc.MessageSeqByDate(r.Context(), chatID, h.meID(r), time.Unix(date, 0))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no message for this date")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	// Ответ — АДРЕС сообщения этой даты, то есть его номер в чате, и едет он
	// САМ: обёртки вокруг числа у оригинала нет.
	writeJSON(w, http.StatusOK, seq)
}

// Calendar — GET /chats/{chatID}/calendar?month=<unix>: по одному медиа-сообщению
// на каждый день месяца, которому принадлежит month (пикер даты рисует их
// миниатюрами в ячейках дней — tweb getSearchResultsCalendar).
func (h *ChatHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	month := time.Unix(queryInt(r, "month", 0), 0).UTC()
	from := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	page, err := h.svc.CalendarMonth(r.Context(), chatID, h.meID(r), from, to)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "calendar failed")
		return
	}
	// Контейнер схемы вместо вектора безымянных словарей: отрезки дней и САМИ
	// сообщения-превью, из медиа которых клиент рисует кружок ячейки — так же,
	// как это делает оригинал.
	writeJSON(w, http.StatusOK, domain.NewMessagesSearchResultsCalendar(page.Periods, page.Messages, page.Users))
}

// GlobalSearchMessages — GET /search/messages?q=&filter=&offset=&limit=: поиск
// по сообщениям всех чатов юзера (сайдбар-поиск, tweb SearchTypes).
func (h *ChatHandler) GlobalSearchMessages(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	filter := r.URL.Query().Get("filter")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 20))
	res, err := h.svc.GlobalSearchMessages(r.Context(), h.meID(r), q, filter, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	writeMessagesSlice(w, r, h.svc, res.Count, res.Messages)
}

// CallLog — GET /calls?offset=&limit=: журнал звонков (вкладка «Звонки»).
func (h *ChatHandler) CallLog(w http.ResponseWriter, r *http.Request) {
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 40))
	calls, err := h.svc.CallLog(r.Context(), h.meID(r), offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load calls")
		return
	}
	// Журнал звонков — вектор СООБЩЕНИЙ плюс вектор пиров, а не собственная
	// форма с вклеенной в каждую запись карточкой собеседника: у оригинала
	// вкладка «Звонки» собирается из тех же messageActionPhoneCall.
	msgs := make([]domain.Message, 0, len(calls))
	users := make([]domain.UserReal, 0, len(calls))
	seen := make(map[int64]bool, len(calls))
	for _, c := range calls {
		msgs = append(msgs, c.Message)
		if !seen[c.Peer.ID] {
			seen[c.Peer.ID] = true
			users = append(users, c.Peer)
		}
	}
	wire, err := messagesJSON(r.Context(), h.svc, msgs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load calls")
		return
	}
	// Собеседники собраны выше по самим звонкам, поэтому общий сборщик авторов
	// здесь не нужен: `users` уже полон.
	writeJSON(w, http.StatusOK, domain.NewMessagesMessages(wire, nil, users))
}

// SendPoll — POST /chats/{chatID}/polls: отправить опрос (сообщение типа 'poll').
func (h *ChatHandler) SendPoll(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Question      string   `json:"question"`
		Options       []string `json:"options"`
		Anonymous     bool     `json:"anonymous"`
		Multiple      bool     `json:"multiple"`
		Quiz          bool     `json:"quiz"`
		CorrectOption *int     `json:"correct_option"`
		ClientMsgID   string   `json:"client_msg_id"`
		// Общий пакет параметров отправки — те же имена полей, что у sendBody.
		ReplyToID        *int64         `json:"reply_to_id"`
		ReplyToPeerID    *domain.PeerID `json:"reply_to_peer_id"`
		ReplyQuoteText   *string        `json:"reply_quote_text"`
		ReplyQuoteOffset *int           `json:"reply_quote_offset"`
		ThreadRootID     *int64         `json:"thread_root_id"`
		Silent           bool           `json:"silent"`
		SendAsPeerID     *domain.PeerID `json:"send_as_peer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	replyPeer, ok := replyPeerChatID(w, r, h.svc, b.ReplyToPeerID)
	if !ok {
		return
	}
	// thread_root_id с клиента — НОМЕР ПОСТА (внешний контракт), см. Send.
	threadRoot, terr := h.svc.ResolveThreadRootForSend(r.Context(), chatID, b.ThreadRootID)
	if errors.Is(terr, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment thread not found")
		return
	}
	if terr != nil {
		writeError(w, http.StatusInternalServerError, "could not send poll")
		return
	}
	m, err := h.svc.SendPoll(r.Context(), usecasechat.SendPollInput{
		ChatID: chatID, SenderID: h.meID(r),
		Question: b.Question, Options: b.Options,
		Anonymous: b.Anonymous, Multiple: b.Multiple, Quiz: b.Quiz, CorrectOption: b.CorrectOption,
		ClientMsgID: b.ClientMsgID,
		ReplyToID:   b.ReplyToID, ReplyToPeerID: replyPeer,
		ReplyQuoteText: b.ReplyQuoteText, ReplyQuoteOffset: b.ReplyQuoteOffset,
		ThreadRootID: threadRoot, Silent: b.Silent, SendAsChatID: sendAsChatID(b.SendAsPeerID),
	})
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid poll")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send poll")
		return
	}
	writeMessage(w, r, h.svc, m)
}

// VotePoll — POST /polls/{pollID}/vote {options:[0,2]}: голос (пустой список — отзыв).
func (h *ChatHandler) VotePoll(w http.ResponseWriter, r *http.Request) {
	pollID, ok := pathInt(w, r, "pollID")
	if !ok {
		return
	}
	var b struct {
		Options []int `json:"options"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	info, err := h.svc.VotePoll(r.Context(), pollID, h.meID(r), b.Options)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "poll not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusBadRequest, "invalid vote")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not vote")
		return
	}
	// Опрос уезжает ТЕМ ЖЕ конструктором, что и внутри сообщения, и БЕЗ
	// обёртки: второй формы опроса на проводе быть не должно, а безымянная
	// пара `{"media": …}` конструктора не имеет.
	writeJSON(w, http.StatusOK, info.ToMedia())
}

// ClosePoll — POST /polls/{pollID}/close: остановить опрос (автор/админ).
func (h *ChatHandler) ClosePoll(w http.ResponseWriter, r *http.Request) {
	pollID, ok := pathInt(w, r, "pollID")
	if !ok {
		return
	}
	err := h.svc.ClosePoll(r.Context(), pollID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "poll not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not close poll")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SendChecklist — POST /chats/{chatID}/checklists: отправить чек-лист
// (сообщение типа 'checklist').
func (h *ChatHandler) SendChecklist(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Title         string   `json:"title"`
		Items         []string `json:"items"`
		OthersCanAdd  bool     `json:"others_can_add"`
		OthersCanMark bool     `json:"others_can_mark"`
		ClientMsgID   string   `json:"client_msg_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.SendChecklist(r.Context(), usecasechat.SendChecklistInput{
		ChatID: chatID, SenderID: h.meID(r),
		Title: b.Title, Items: b.Items,
		OthersCanAdd: b.OthersCanAdd, OthersCanMark: b.OthersCanMark,
		ClientMsgID: b.ClientMsgID,
	})
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid checklist")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send checklist")
		return
	}
	writeMessage(w, r, h.svc, m)
}

// ToggleChecklistItem — POST /checklists/{id}/items/{itemID}/toggle: отметить/
// снять отметку «выполнено» на пункте (учитывает право others_can_mark).
func (h *ChatHandler) ToggleChecklistItem(w http.ResponseWriter, r *http.Request) {
	checklistID, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	itemID, ok := pathInt(w, r, "itemID")
	if !ok {
		return
	}
	info, err := h.svc.ToggleChecklistItem(r.Context(), checklistID, int(itemID), h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "checklist not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not toggle item")
		return
	}
	writeJSON(w, http.StatusOK, info.ToMedia())
}

// AddChecklistItems — POST /checklists/{id}/items {items:[...]}: добавить пункты
// (учитывает право others_can_add).
func (h *ChatHandler) AddChecklistItems(w http.ResponseWriter, r *http.Request) {
	checklistID, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	var b struct {
		Items []string `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	info, err := h.svc.AddChecklistItems(r.Context(), checklistID, h.meID(r), b.Items)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid items")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "checklist not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not add items")
		return
	}
	writeJSON(w, http.StatusOK, info.ToMedia())
}

// scheduledJSON — отложенное сообщение ТЕМ ЖЕ конструктором `message`
// (domain.ScheduledMessage.ToWire): собственной проводной формы у него больше
// нет. Идентичность при этом своя — номера в чате у неотправленного не
// существует, см. докблок ToWire.
func scheduledJSON(m domain.ScheduledMessage, peer domain.PeerID) domain.MessageReal {
	return m.ToWire(domain.NewPeer(peer))
}

// ScheduleMessage — POST /chats/{chatID}/scheduled: запланировать отправку.
func (h *ChatHandler) ScheduleMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Type       string                 `json:"type"`
		Text       string                 `json:"text"`
		Entities   domain.MessageEntities `json:"entities"`
		ReplyTo    *int64                 `json:"reply_to_id"`
		MediaID    *int64                 `json:"media_id"`
		SendAt     int64                  `json:"send_at"`     // unix-секунды (игнор при when_online)
		WhenOnline bool                   `json:"when_online"` // отправить когда собеседник онлайн
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.ScheduleMessage(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: b.Type, Text: b.Text,
		Entities: b.Entities, ReplyToID: b.ReplyTo, MediaID: b.MediaID,
	}, time.Unix(b.SendAt, 0), b.WhenOnline)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid scheduled message")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "when_online requires a private chat")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not schedule")
		return
	}
	writeJSON(w, http.StatusOK, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
}

// UpdateScheduled — PATCH /chats/{chatID}/scheduled/{schedID} {send_at}:
// перенести своё запланированное сообщение на новое время (reschedule).
func (h *ChatHandler) UpdateScheduled(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	var b struct {
		SendAt int64 `json:"send_at"` // unix-секунды
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.UpdateScheduled(r.Context(), id, h.meID(r), time.Unix(b.SendAt, 0))
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "send_at must be in the future")
		return
	}
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
}

// ListScheduled — GET /chats/{chatID}/scheduled: свои запланированные.
func (h *ChatHandler) ListScheduled(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	list, err := h.svc.ListScheduled(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list scheduled")
		return
	}
	out := make([]domain.MTMessage, 0, len(list))
	for _, m := range list {
		out = append(out, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
	}
	// Тот же контейнер, что у истории: набор отдан ЦЕЛИКОМ, поэтому
	// `messages.messages`. Автор у отложенных всегда один — тот, кто спросил;
	// его карточка едет вектором `users`, как требует конструктор.
	me, _ := UserFromContext(r.Context())
	writeJSON(w, http.StatusOK, domain.NewMessagesMessages(out, nil, []domain.UserReal{selfUser(me)}))
}

// DeleteScheduled — DELETE /chats/{chatID}/scheduled/{schedID}.
func (h *ChatHandler) DeleteScheduled(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	if err := h.svc.DeleteScheduled(r.Context(), id, h.meID(r)); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SendScheduledNow — POST /chats/{chatID}/scheduled/{schedID}/send_now.
func (h *ChatHandler) SendScheduledNow(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	m, err := h.svc.SendScheduledNow(r.Context(), id, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeMessage(w, r, h.svc, m)
}

func (h *ChatHandler) mapScheduledErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	default:
		writeError(w, http.StatusInternalServerError, "scheduled operation failed")
	}
}

// ── Форум-топики ──

// SetForum — POST /chats/{chatID}/forum {enabled}: включить темы (CHANGE_INFO).
func (h *ChatHandler) SetForum(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetForum(r.Context(), chatID, h.meID(r), b.Enabled); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// topicJSON — СТРОКА списка тем конструктором `forumTopic`.
//
// Выжимок последнего сообщения (`last_text`, `last_type`, `last_at`,
// `last_sender_name`) здесь больше нет: само сообщение едет вектором
// `messages` контейнера, а строка адресует его числом `top_message` — тот же
// ход, что сделан у диалогов. Ушли и `msg_count` с `pos`: у оригинала счётчика
// сообщений темы не бывает вовсе, а порядок задаёт сам вектор.
func topicJSON(row domain.TopicRow, viewerID int64) domain.ForumTopicReal {
	// Темы бывают только у супергрупп — ключ пира тут один на всех: -chatID.
	peer := domain.NewPeer(domain.ToPeerID(row.Topic.ChatID, true))
	// Заглушённость это СРОК, а не булево поле рядом: тот же предикат, что у
	// диалога. Своего срока у темы мы не храним — «замьючено навсегда» либо
	// «не замьючено вовсе».
	notify := domain.PeerNotifySettings{Underscore: domain.PeerNotifySettingsTag}
	if row.Muted {
		forever := domain.MuteUntilForever
		notify.MuteUntil = &forever
	}
	return domain.NewForumTopic(row.Topic, peer, domain.NewPeer(domain.PeerID(row.Topic.CreatedBy)),
		row.LastMsgSeq, row.LastReadSeq, row.UnreadCount, row.UnreadMentions, notify,
		domain.ForumTopicFlags{
			My:        row.Topic.CreatedBy == viewerID,
			Closed:    row.Topic.Closed,
			Pinned:    row.Topic.Pinned,
			Hidden:    row.Topic.Hidden,
			IsGeneral: row.Topic.IsGeneral,
		})
}

// CreateTopic — POST /chats/{chatID}/topics {title, icon_color}.
func (h *ChatHandler) CreateTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Title     string `json:"title"`
		IconColor int    `json:"icon_color"`
		IconEmoji string `json:"icon_emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	t, err := h.svc.CreateTopic(r.Context(), chatID, h.meID(r), b.Title, b.IconEmoji, b.IconColor)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid title")
		return
	}
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	// Созданная тема — та же СТРОКА, что едет в списке: своей формы у этого
	// ответа нет.
	writeJSON(w, http.StatusOK, topicJSON(domain.TopicRow{Topic: t}, h.meID(r)))
}

// ListTopics — GET /chats/{chatID}/topics.
func (h *ChatHandler) ListTopics(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	me := h.meID(r)
	page, err := h.svc.TopicsPage(r.Context(), chatID, me)
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	topics := make([]domain.ForumTopic, 0, len(page.Topics))
	for _, t := range page.Topics {
		topics = append(topics, topicJSON(t, me))
	}
	msgs, err := h.svc.MessagesWire(r.Context(), me, page.Messages)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render topics")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesForumTopics(topics, msgs, nil, page.Users))
}

// CloseTopic — POST /chats/{chatID}/topics/{topicID}/close {closed}.
func (h *ChatHandler) CloseTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Closed bool `json:"closed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.CloseTopic(r.Context(), topicID, h.meID(r), b.Closed); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// EditTopic — PATCH /chats/{chatID}/topics/{topicID} {title, icon_emoji, icon_color}.
func (h *ChatHandler) EditTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Title     string `json:"title"`
		IconEmoji string `json:"icon_emoji"`
		IconColor int    `json:"icon_color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.EditTopic(r.Context(), topicID, h.meID(r), b.Title, b.IconEmoji, b.IconColor); err != nil {
		if errors.Is(err, domain.ErrTooLong) {
			writeError(w, http.StatusBadRequest, "invalid title")
			return
		}
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// HideTopic — POST /chats/{chatID}/topics/{topicID}/hide {hidden}.
func (h *ChatHandler) HideTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Hidden bool `json:"hidden"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicHidden(r.Context(), topicID, h.meID(r), b.Hidden); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// PinTopic — POST /chats/{chatID}/topics/{topicID}/pin {pinned}.
func (h *ChatHandler) PinTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicPinned(r.Context(), topicID, h.meID(r), b.Pinned); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ReadTopic — POST /chats/{chatID}/topics/{topicID}/read {up_to_seq}.
// Помечает тему прочитанной до up_to_seq (Telegram readDiscussion c threadId).
// В слоте {topicID} передаётся НОМЕР корневого сообщения темы (ключ состояния —
// пара chat+root; наружу тот же номер едет как root_msg_id витрины тем).
func (h *ChatHandler) ReadTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootMsgID, ok := msgSeqIDParam(w, r, h.svc, chatID, "topicID")
	if !ok {
		return
	}
	var b struct {
		UpToSeq int64 `json:"up_to_seq"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.MarkTopicRead(r.Context(), chatID, rootMsgID, h.meID(r), b.UpToSeq); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// MuteTopic — POST /chats/{chatID}/topics/{topicID}/mute {muted}.
// Включает/выключает уведомления темы для пользователя.
// В слоте {topicID} передаётся НОМЕР корневого сообщения темы (ключ состояния —
// пара chat+root; наружу тот же номер едет как root_msg_id витрины тем).
func (h *ChatHandler) MuteTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootMsgID, ok := msgSeqIDParam(w, r, h.svc, chatID, "topicID")
	if !ok {
		return
	}
	var b struct {
		Muted bool `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicMuted(r.Context(), chatID, rootMsgID, h.meID(r), b.Muted); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ThreadMessages — GET /chats/{peerID}/threads/{rootSeq}: сообщения треда.
// В сегменте едет НОМЕР корня в этом чате (для комментариев — номер зеркала).
func (h *ChatHandler) ThreadMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootID, ok := msgSeqIDParam(w, r, h.svc, chatID, "rootSeq")
	if !ok {
		return
	}
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 50))
	msgs, count, err := h.svc.ListThreadMessages(r.Context(), chatID, rootID, h.meID(r), offset, limit)
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeMessagesSlice(w, r, h.svc, count, msgs)
}

// GroupCallParticipants — GET /chats/{chatID}/group_call: кто сейчас в видеочате.
func (h *ChatHandler) GroupCallParticipants(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	ids, err := h.svc.GroupCallParticipants(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	// Ответ — вектор ССЫЛОК на участников (`Vector<Peer>`), а не голых ключей.
	//
	// Контейнера `phone.groupCall` здесь НЕ будет, и это решение, а не
	// упущение: у оригинала звонок — серверная конференция с собственным
	// объектом (`groupCall{id, access_hash, participants_count, version}`) и
	// участником, у которого обязателен `source` — SSRC потока в микшере. У
	// нас звонок это P2P-mesh: сервер только реле сигналинга, объекта звонка
	// не существует, SSRC никто не назначает. Заполнить обязательные
	// параметры было бы нечем — пришлось бы выдумать id и версию.
	//
	// Что перенимается — адресация: участник это `Peer`, а не число. Заодно
	// вектор становится разбираемым на проводе TL: у `peerUser` есть свой id,
	// у голого long — нет.
	peers := make([]domain.Peer, 0, len(ids))
	for _, id := range ids {
		peers = append(peers, domain.NewPeerUser(id))
	}
	writeJSON(w, http.StatusOK, peers)
}

// ── RTMP-трансляции (Telegram livestream) ──

// livestreamJSON сериализует состояние трансляции. Креды (rtmp_url/stream_key)
// присутствуют, только если usecase их отдал (админ) — зрителю секрет не уходит.
func livestreamJSON(st usecasechat.LivestreamState) map[string]any {
	m := map[string]any{
		"active": st.Active, "viewers": st.Viewers, "is_admin": st.IsAdmin,
	}
	if st.StartedAt != nil {
		m["started_at"] = *st.StartedAt
	}
	if st.RTMPURL != "" {
		m["rtmp_url"] = st.RTMPURL
	}
	if st.StreamKey != "" {
		m["stream_key"] = st.StreamKey
	}
	return m
}

// StartLivestream — POST /chats/{chatID}/livestream/start: админ запускает эфир,
// в ответе — креды для OBS (rtmp_url + stream_key).
func (h *ChatHandler) StartLivestream(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.StartLivestream(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

// StopLivestream — POST /chats/{chatID}/livestream/stop: админ завершает эфир.
func (h *ChatHandler) StopLivestream(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.StopLivestream(r.Context(), chatID, h.meID(r)); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// LivestreamStatus — GET /chats/{chatID}/livestream: статус эфира для участника
// (активна ли, число зрителей; креды — только админу).
func (h *ChatHandler) LivestreamStatus(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.LivestreamStatus(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

// RevokeStreamKey — POST /chats/{chatID}/livestream/revoke_key: админ
// перевыпускает stream key (в ответе — новые креды).
func (h *ChatHandler) RevokeStreamKey(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.RevokeStreamKey(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

func (h *ChatHandler) Sync(w http.ResponseWriter, r *http.Request) {
	sincePts := queryInt(r, "pts", 0)
	d, err := h.svc.GetDifference(r.Context(), h.meID(r), sincePts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sync failed")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

type reactionBody struct {
	Emoji string `json:"emoji"`
}

func (h *ChatHandler) AddReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	var body reactionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Emoji == "" {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	h.react(w, r, chatID, msgID, body.Emoji, true)
}

func (h *ChatHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	emoji := chi.URLParam(r, "emoji")
	if emoji == "" {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	h.react(w, r, chatID, msgID, emoji, false)
}

func (h *ChatHandler) react(w http.ResponseWriter, r *http.Request, chatID, msgID int64, emoji string, add bool) {
	err := h.svc.React(r.Context(), chatID, msgID, h.meID(r), emoji, add)
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "reaction failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *ChatHandler) ListReactions(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	counts, err := h.svc.ReactionsOf(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	// Агрегат реакций сообщения — конструктор `messageReactions`, тот же, что
	// едет ВНУТРИ самого сообщения: один предмет, одна форма. Значит и флаги у
	// него те же: «виден ли список реагировавших» отвечает тот же единственный
	// источник, что и в истории, и в кадре.
	agg := domain.NewMessageReactions(domain.ReactionCountsOf(counts), nil)
	agg.SetCanSeeList(h.svc.CanSeeReactionsList(r.Context(), chatID))
	writeJSON(w, http.StatusOK, agg)
}

// ReactionUsers — GET /chats/{chatID}/messages/{msgID}/reactions/users: кто
// отреагировал и каким эмодзи (для попапа who-reacted).
func (h *ChatHandler) ReactionUsers(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	users, err := h.svc.ReactionUsers(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	// Строки — конструкторы `messagePeerReaction` (пир + дата + реакция), а
	// карточки едут вектором `users`. Прежде витрина клеила карточку в КАЖДУЮ
	// строку рядом со строкой-эмодзи: тот же снимок вместо ссылки, что уже
	// убирался у диалогов и чёрного списка.
	rows := make([]domain.MessagePeerReaction, 0, len(users))
	cards := make([]domain.UserReal, 0, len(users))
	for _, ru := range users {
		rows = append(rows, domain.NewMessagePeerReaction(domain.NewPeerUser(ru.User.ID), time.Time{}, domain.NewReactionEmoji(ru.Emoji)))
		cards = append(cards, ru.User)
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesMessageReactionsList(rows, cards))
}

// SavedTags — GET /saved/tags: теги-реакции «Избранного» вызывающего (реакция +
// имя + число помеченных сообщений), самые частые первыми.
// SendAs — GET /chats/{chatID}/send_as: доступные «личности отправителя»
// (Telegram channels.getSendAs). Всегда содержит самого пользователя; для групп —
// плюс привязанный канал (если юзер его админ) и саму группу (анонимный админ).
func (h *ChatHandler) SendAs(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	peers, err := h.svc.GetSendAs(r.Context(), h.meID(r), chatID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load send-as")
		return
	}
	// Раскладка channels.sendAsPeers: ССЫЛКИ на пиры отдельно, их тела —
	// векторами users/chats. Вид личности («это канал, а это я сам») читается
	// из конструктора тела, а не из строкового kind рядом.
	refs := make([]domain.SendAsPeer, 0, len(peers))
	users := make([]domain.UserReal, 0, len(peers))
	chats := make([]domain.Chat, 0, len(peers))
	for _, p := range peers {
		refs = append(refs, domain.NewSendAsPeer(p.Peer))
		if p.User != nil {
			users = append(users, *p.User)
		}
		if p.Chat != nil {
			chats = append(chats, *p.Chat)
		}
	}
	// Конструктор перестал быть строковым ЛИТЕРАЛОМ внутри карты: форма была
	// угадана верно, но держалась на аккуратности автора — сверка со схемой
	// работает по типам и до карты не доходила.
	writeJSON(w, http.StatusOK, domain.NewChannelsSendAsPeers(refs, chats, users))
}

func (h *ChatHandler) SavedTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.svc.SavedTags(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load saved tags")
		return
	}
	// Реакция тега — ОБЪЕДИНЕНИЕ `Reaction`, а не строка эмодзи: тот же
	// предмет, что в агрегате сообщения, и та же форма.
	writeJSON(w, http.StatusOK, domain.NewMessagesSavedReactionTags(tags))
}

type savedTagBody struct {
	Title string `json:"title"`
}

// SetSavedTagName — PUT /saved/tags/{reaction}: задать/переименовать/очистить имя
// тега (Telegram updateSavedReactionTag). Пустой title стирает имя.
func (h *ChatHandler) SetSavedTagName(w http.ResponseWriter, r *http.Request) {
	reaction := chi.URLParam(r, "reaction")
	if reaction == "" {
		writeError(w, http.StatusBadRequest, "reaction is required")
		return
	}
	var body savedTagBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.svc.SetSavedTagName(r.Context(), h.meID(r), reaction, body.Title)
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}
	if errors.Is(err, domain.ErrTooLong) || errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid tag name")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update tag")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SendStarReaction — POST /chats/{chatID}/messages/{msgID}/star_reaction
// {count, anonymous}: платная ⭐-реакция. Списывает звёзды у отправителя,
// начисляет автору, накопительно фиксирует вклад; отдаёт новый агрегат,
// топ-отправителей и новый баланс.
func (h *ChatHandler) SendStarReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	var body struct {
		Count     int64 `json:"count"`
		Anonymous bool  `json:"anonymous"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	agg, top, bal, err := h.svc.SendStarReaction(r.Context(), chatID, msgID, h.meID(r), body.Count, body.Anonymous)
	if errors.Is(err, domain.ErrPaidRequired) {
		writeError(w, http.StatusPaymentRequired, "not enough stars")
		return
	}
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid star count")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "star reaction failed")
		return
	}
	// Баланса рядом больше нет: его владелец — кадр `updateStarsBalance`.
	_ = bal
	writeStarReaction(w, r, h.svc, chatID, agg, top)
}

// GetStarReaction — GET /chats/{chatID}/messages/{msgID}/star_reaction: агрегат
// звёзд сообщения (total + мой вклад) и топ-отправители.
func (h *ChatHandler) GetStarReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	agg, top, err := h.svc.StarReactionOf(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load star reaction")
		return
	}
	writeStarReaction(w, r, h.svc, chatID, agg, top)
}

// writeStarReaction — витрина ⭐-реакции сообщения.
//
// Прежде она отдавала безымянную тройку: пару `{total, mine}` под ключом
// `star_reaction`, список отправителей с ВКЛЕЕННОЙ карточкой в каждой строке и
// баланс. У оригинала всё это ОДИН предмет — агрегат реакций сообщения:
// платная реакция это `reactionPaid` среди обычных чипов, а доска
// отправителей — `top_reactors`, где строка несёт ССЫЛКУ на пира.
//
// Едет агрегат кадром `updateMessageReactions` в контейнере `updates`: сам по
// себе `messageReactions` вектора карточек не имеет, а ссылкам нужен адресат.
func writeStarReaction(w http.ResponseWriter, r *http.Request, svc *usecasechat.Interactor,
	chatID int64, agg domain.StarReactionAgg, top []domain.StarReactionSender) {
	results := []domain.MTReactionCount{
		domain.NewReactionCount(domain.NewReactionPaid(), int(agg.Total), agg.Mine > 0),
	}
	reactors := make([]domain.MessageReactor, 0, len(top)+1)
	users := make([]domain.UserReal, 0, len(top))
	for _, s := range top {
		// Анонимный отправитель едет БЕЗ ссылки на пира: личность затёрта в
		// usecase, и подставлять пустую карточку вместо неё нельзя.
		if s.Anonymous || s.User.ID == 0 {
			reactors = append(reactors, domain.NewMessageReactor(nil, int(s.Stars), false))
			continue
		}
		reactors = append(reactors, domain.NewMessageReactor(domain.NewPeer(domain.PeerID(s.User.ID)), int(s.Stars), false))
		users = append(users, s.User)
	}
	if agg.Mine > 0 {
		reactors = append(reactors, domain.NewMyMessageReactor(int(agg.Mine)))
	}
	reactions := domain.NewMessageReactions(results, nil)
	reactions.SetCanSeeList(svc.CanSeeReactionsList(r.Context(), chatID))
	reactions.TopReactors = reactors

	me, _ := UserFromContext(r.Context())
	peer, err := svc.ChatIDToPeer(r.Context(), me.ID, chatID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render star reaction")
		return
	}
	// Номер сообщения берётся из САМОГО адреса запроса: снаружи сообщение
	// адресуется парой «пир + номер», и второй раз выяснять его незачем.
	seq, ok := pathMsgSeq(w, r, "msgSeq")
	if !ok {
		return
	}
	update := domain.NewUpdateMessageReactions(domain.NewPeer(peer), seq, reactions)
	writeJSON(w, http.StatusOK, domain.NewUpdates([]domain.Update{update}, users, time.Now()))
}

// messagesJSON — витрина списка сообщений: КОНСТРУКТОРЫ схемы, собранные тем
// же переводом, что и realtime-кадр (usecase/chat/messagewire.go). Второго
// сериализатора у сообщения больше нет (решение Р5), поэтому здесь остаётся
// только вызов.
func messagesJSON(ctx context.Context, svc *usecasechat.Interactor, msgs []domain.Message) ([]domain.MTMessage, error) {
	me, _ := UserFromContext(ctx)
	return svc.MessagesWire(ctx, me.ID, msgs)
}

// writeMessagesSlice — витрина СТРАНИЦЫ списка сообщений: конструктор
// messages.messagesSlice, где count — размер полного набора.
//
// Параметров «дошли до верха/низа» у конструктора нет: их считает клиент из
// count и запрошенного окна (порт appMessagesManager.ts:9508-9518). Наши
// reached_top/reached_bottom были сервером, делавшим арифметику клиента.
func writeMessagesSlice(w http.ResponseWriter, r *http.Request, svc *usecasechat.Interactor, count int, msgs []domain.Message) {
	me, _ := UserFromContext(r.Context())
	out, users, err := svc.MessagesContainer(r.Context(), me.ID, msgs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render messages")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesMessagesSlice(count, out, nil, users))
}

// writeMessagesAll — витрина ПОЛНОГО набора: конструктор messages.messages.
// Параметра count у него нет — «это всё» сказано выбором конструктора.
func writeMessagesAll(w http.ResponseWriter, r *http.Request, svc *usecasechat.Interactor, msgs []domain.Message) {
	me, _ := UserFromContext(r.Context())
	out, users, err := svc.MessagesContainer(r.Context(), me.ID, msgs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render messages")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesMessages(out, nil, users))
}

// writeMessage — ответ одним сообщением (Send/EditMessage/SetFactCheck/
// UpdateGeoLive/PostComment и т.п.).
//
// Сбой перевода — 500-я, а не «отдать как есть»: см. MessagesWire.
func writeMessage(w http.ResponseWriter, r *http.Request, svc *usecasechat.Interactor, m domain.Message) {
	out, err := messagesJSON(r.Context(), svc, []domain.Message{m})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not render message")
		return
	}
	writeJSON(w, http.StatusOK, out[0])
}

func pathInt(w http.ResponseWriter, r *http.Request, key string) (int64, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, key), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid "+key)
		return 0, false
	}
	return v, true
}

func queryInt(r *http.Request, key string, def int64) int64 {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return v
		}
	}
	return def
}

// MyAutoDelete — GET /me/auto_delete: глобальный период автоудаления (сек).
func (h *ChatHandler) MyAutoDelete(w http.ResponseWriter, r *http.Request) {
	period, err := h.svc.MyAutoDelete(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewDefaultHistoryTTL(period))
}

// SetMyAutoDelete — PUT /me/auto_delete {period}: применяется к новым чатам.
func (h *ChatHandler) SetMyAutoDelete(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Period int `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetMyAutoDelete(r.Context(), h.meID(r), b.Period); err != nil {
		writeError(w, http.StatusBadRequest, "bad period")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewDefaultHistoryTTL(b.Period))
}

// SetChatAutoDelete — PUT /chats/{chatID}/auto_delete {period}.
func (h *ChatHandler) SetChatAutoDelete(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Period int `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SetChatAutoDelete(r.Context(), chatID, h.meID(r), b.Period)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewDefaultHistoryTTL(b.Period))
}

// SetChatTheme — PUT /chats/{chatID}/theme {theme_id}. Пустой theme_id (или
// отсутствие поля) — сброс темы к дефолту. Тема общая для чата (Telegram
// messages.setChatTheme): смена рассылается обоим участникам фреймом
// chat_theme_update.
func (h *ChatHandler) SetChatTheme(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		ThemeID string `json:"theme_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SetChatTheme(r.Context(), chatID, h.meID(r), b.ThemeID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	// Эхо запроса ответом не является: тему прислал сам клиент, и второй раз
	// она ему не нужна. Изменение уезжает участникам кадром `updateChatTheme`.
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// draftJSON — черновик витрины: КОНСТРУКТОР кадра updateDraftMessage с ключом
// пира ГЛАЗАМИ владельца.
//
// Форма взята у оригинала буквально: `messages.getAllDrafts` отвечает
// контейнером `Updates`, то есть списком тех же кадров, что приезжают живыми.
// Прежде витрина и кадр несли РАЗНЫЕ формы одного черновика (тут `text` и
// `peer_id` плоско, там вложенный словарь), и расходились они сами по себе.
func draftJSON(d domain.Draft, peer domain.PeerID) domain.UpdateDraftMessage {
	return domain.NewUpdateDraftMessage(domain.NewPeer(peer), d.Wire())
}

// sendAsChatID — знаковый ключ «личности отправителя» во внутренний chatID.
// send-as бывает только каналом/супергруппой, поэтому это чистая арифметика:
// пользователь в этом поле смысла не имеет и трактуется как «от себя».
func sendAsChatID(peer *domain.PeerID) *int64 {
	if peer == nil || !peer.IsAnyChat() {
		return nil
	}
	id := peer.ToChatID()
	return &id
}

// MyDrafts — GET /drafts: все облачные черновики пользователя.
func (h *ChatHandler) MyDrafts(w http.ResponseWriter, r *http.Request) {
	drafts, err := h.svc.MyDrafts(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]domain.Update, 0, len(drafts))
	for _, d := range drafts {
		out = append(out, draftJSON(d, peerOf(r, h.svc, d.ChatID)))
	}
	writeJSON(w, http.StatusOK, domain.NewUpdates(out, nil, time.Now()))
}

// SaveDraft — PUT /chats/{chatID}/draft {text, entities, reply_to_id}.
// Пустой текст без reply_to_id удаляет черновик (Telegram draftMessageEmpty).
func (h *ChatHandler) SaveDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Text      string                 `json:"text"`
		Entities  domain.MessageEntities `json:"entities"`
		ReplyToID *int64                 `json:"reply_to_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	d, err := h.svc.SaveDraft(r.Context(), h.meID(r), chatID, b.Text, b.Entities, b.ReplyToID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	// Ответ — ТОТ ЖЕ кадр, что приезжает живым и что едет в списке `/drafts`:
	// третьей формы одного черновика у нас больше нет.
	//
	// «Черновик снят» — КОНСТРУКТОР draftMessageEmpty, а не null: отсутствие
	// выражается выбором конструктора, как у любого объединения схемы.
	peer := domain.NewPeer(peerOf(r, h.svc, chatID))
	if d == nil {
		writeJSON(w, http.StatusOK, domain.NewUpdateDraftMessage(peer, domain.NewDraftMessageEmpty()))
		return
	}
	writeJSON(w, http.StatusOK, domain.NewUpdateDraftMessage(peer, d.Wire()))
}

// DeleteDraft — DELETE /chats/{chatID}/draft.
func (h *ChatHandler) DeleteDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.DeleteDraft(r.Context(), h.meID(r), chatID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ClearAllDrafts — DELETE /drafts («Удалить все черновики»).
func (h *ChatHandler) ClearAllDrafts(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.ClearAllDrafts(r.Context(), h.meID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
