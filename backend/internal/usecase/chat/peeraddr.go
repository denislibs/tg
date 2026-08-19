package chat

import (
	"context"
	"sync"

	"github.com/messenger-denis/backend/internal/domain"
)

// ── Слой разрешения peerId ↔ внутренний chatID ──────────────────────────────
//
// ЕДИНСТВЕННОЕ место, где живёт соответствие «знаковый ключ пира ↔ строка в
// chats». Наружу — в URL, тела запросов и ответов, realtime-кадры, журналы
// updates/channel_updates и ключи Redis — выходит только domain.PeerID
// (пользователь ≥ 0, чат < 0, порт tweb utils/peers/isUser.ts и isAnyChat.ts).
// Внутрь — в репозитории, SQL и chat_members — по-прежнему уходит chats.id.
//
// Почему слой вообще существует, ведь в оригинале приватного чата как сущности
// НЕТ (peerId приватного диалога — это id СОБЕСЕДНИКА). Полный паритет на
// уровне ХРАНЕНИЯ потребовал бы переделки хранения сообщений: серверу нужен
// какой-то ключ разговора. Поэтому строка в chats для приватного чата остаётся
// внутренней деталью сервера — и наружу она не выходит НИКОГДА.
//
// ── Асимметрия приватного диалога ───────────────────────────────────────────
// У приватного диалога peerId РАЗНЫЙ у двух сторон одного разговора: для A это
// id B, для B — id A. Это не дефект, а устройство оригинала: диалог принадлежит
// пользователю. Симметричное соответствие («один chatID — один peerId») было бы
// самой естественной ошибкой здесь и перепутало бы диалоги: обе стороны
// получили бы кадр с ключом, указывающим на них же самих.
//
// Отсюда правило: любой выход наружу знает ЗРИТЕЛЯ. Ни одна функция ниже не
// умеет отвечать «peerId этого чата» без viewerID.

// chatAddress — чем один внутренний чат представляется наружу.
//
// members != nil означает «адрес зависит от зрителя» (приватный чат и
// «Избранное»); nil — адрес общий для всех: -chatID (группа, канал, секретный
// чат). Секретный чат адресуется своим id сознательно: в схеме это отдельное
// объединение EncryptedChat с собственным id, а не вариант Chat, и его id уже
// сегодня публичен (/secret_chats/{id}).
type chatAddress struct {
	chatID  int64
	members []int64
}

// forViewer — знаковый ключ этого чата ГЛАЗАМИ viewerID.
func (a chatAddress) forViewer(viewerID int64) domain.PeerID {
	if a.members == nil {
		return domain.ToPeerID(a.chatID, true)
	}
	for _, uid := range a.members {
		if uid != viewerID {
			return domain.PeerID(uid)
		}
	}
	// «Избранное» (единственный участник — сам зритель): пир это он сам, как
	// peerId Saved Messages в оригинале.
	return domain.PeerID(viewerID)
}

// peerAddrCache — кэш адресов. Записи НЕИЗМЕНЯЕМЫ по построению: тип чата не
// меняется за его жизнь (SetType правит username/is_public, а не chats.type), а
// состав приватного чата и «Избранного» фиксируется при создании. Инвалидации
// поэтому нет; ограничение размера — грубый сброс, чтобы кэш не рос без предела
// на инстансе с миллионом диалогов.
type peerAddrCache struct {
	mu sync.RWMutex
	m  map[int64]chatAddress
}

const peerAddrCacheMax = 50000

func newPeerAddrCache() *peerAddrCache { return &peerAddrCache{m: map[int64]chatAddress{}} }

func (c *peerAddrCache) get(chatID int64) (chatAddress, bool) {
	c.mu.RLock()
	a, ok := c.m[chatID]
	c.mu.RUnlock()
	return a, ok
}

func (c *peerAddrCache) put(chatID int64, a chatAddress) {
	c.mu.Lock()
	if len(c.m) >= peerAddrCacheMax {
		c.m = make(map[int64]chatAddress, peerAddrCacheMax/4)
	}
	c.m[chatID] = a
	c.mu.Unlock()
}

// peerAddress читает адрес чата (тип + участники приватного) — один раз за
// процесс на чат: см. про неизменяемость у peerAddrCache.
func (i *Interactor) peerAddress(ctx context.Context, chatID int64) (chatAddress, error) {
	if chatID == 0 {
		return chatAddress{}, domain.ErrNotFound
	}
	if a, ok := i.peerAddrs.get(chatID); ok {
		return a, nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return chatAddress{}, err
	}
	a := chatAddress{chatID: chatID}
	if typ == domain.ChatTypePrivate || typ == domain.ChatTypeSaved {
		members, err := i.chats.MemberIDs(ctx, chatID)
		if err != nil {
			return chatAddress{}, err
		}
		if members == nil {
			members = []int64{}
		}
		a.members = members
	}
	i.peerAddrs.put(chatID, a)
	return a, nil
}

// ChatIDToPeer — знаковый ключ чата ГЛАЗАМИ viewerID (обратное направление).
func (i *Interactor) ChatIDToPeer(ctx context.Context, viewerID, chatID int64) (domain.PeerID, error) {
	a, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return domain.NullPeerID, err
	}
	return a.forViewer(viewerID), nil
}

// PeerToChatID — внутренний chatID по знаковому ключу пира глазами viewerID.
// Приватный чат, которого ещё нет, — domain.ErrNotFound (читающие пути).
func (i *Interactor) PeerToChatID(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error) {
	return i.peerToChatID(ctx, viewerID, peer, false)
}

// PeerToChatIDOrCreate — то же, но заводит приватный чат / «Избранное», если
// его ещё нет: первое сообщение собеседнику открывает диалог.
func (i *Interactor) PeerToChatIDOrCreate(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error) {
	return i.peerToChatID(ctx, viewerID, peer, true)
}

func (i *Interactor) peerToChatID(ctx context.Context, viewerID int64, peer domain.PeerID, create bool) (int64, error) {
	if peer == domain.NullPeerID {
		return 0, domain.ErrNotFound
	}
	if peer.IsAnyChat() {
		chatID := peer.ToChatID()
		a, err := i.peerAddress(ctx, chatID)
		if err != nil {
			return 0, err
		}
		if a.members != nil {
			// Отрицательным ключом приватный чат («Избранное») не адресуется:
			// его строка — внутренняя деталь сервера, и снаружи о ней знать
			// нечего. Иначе id разговора утекал бы в URL первым же запросом.
			return 0, domain.ErrNotFound
		}
		return chatID, nil
	}
	userID := peer.ToUserID()
	if userID == viewerID {
		if create {
			return i.GetOrCreateSaved(ctx, viewerID)
		}
		return i.chats.FindSaved(ctx, viewerID)
	}
	if create {
		return i.CreatePrivateChat(ctx, viewerID, userID)
	}
	return i.chats.FindPrivate(ctx, viewerID, userID)
}

// DialogPeerID — ключ диалога глазами зрителя БЕЗ обращения к базе: у витрины
// списка диалогов уже есть и тип чата, и собеседник приватного (Dialog.Peer).
// Правило адресации при этом не раздваивается — оно по-прежнему одно,
// chatAddress.forViewer; здесь лишь собирается тот же адрес из готовых данных.
func (i *Interactor) DialogPeerID(d domain.Dialog, viewerID int64) domain.PeerID {
	return dialogAddress(d, viewerID).forViewer(viewerID)
}

func dialogAddress(d domain.Dialog, viewerID int64) chatAddress {
	a := chatAddress{chatID: d.ChatID}
	switch {
	case d.Type == domain.ChatTypeSaved:
		a.members = []int64{viewerID}
	case d.Type == domain.ChatTypePrivate && d.Peer != nil:
		a.members = []int64{viewerID, d.Peer.ID}
	}
	return a
}
