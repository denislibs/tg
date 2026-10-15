package chat

import (
	"context"
	"log"

	"github.com/messenger-denis/backend/internal/domain"
)

// chatUpdatePayload — АБСОЛЮТНЫЙ снимок чата (не дифф) в форме оригинала:
// messages.chatFull, то есть полная карточка ВМЕСТЕ с краткой формой самого
// чата. Как и у reaction/poll, абсолютное представление делает catch-up через
// getDifference идемпотентным — клиент просто заменяет карточку чата на этот снимок,
// в каком бы порядке апдейты ни доехали.
//
// Это ТОТ ЖЕ объект, что отдаёт ручка карточки (GroupHandler.Card). Раньше
// одна и та же ChatCard ехала здесь и там в двух разных формах — плоско с id
// против вложенно, — и клиент разбирал их двумя разными путями.
//
// Снимок БЕЗ ЗРИТЕЛЯ (кадр один на всех участников), и это видно в самом
// объекте: флагов членства нет вовсе (см. ChatRecord.ViewerID), а обязательные
// горизонты чтения channelFull едут нулями. Их зритель-зависимые значения
// приезжают ручкой карточки, которую клиент и без того открывает поимённо.
func chatUpdatePayload(peer domain.PeerID, c domain.ChatRecord) map[string]any {
	return chatFullSnapshotPayload(domain.UpdateChatFullSnapshotTag, peer, c)
}

// channelUpdatePayload — тот же снимок, но кадром КАНАЛЬНОГО журнала.
//
// Конструктор второй, и это не дубль: он и есть ответ на вопрос «какой курсор
// двигать». Схема отвечает на него ровно так же — updateNewMessage против
// updateNewChannelMessage, — потому что предмет один, а журнала два. По самому
// снимку различить журналы нельзя: наша группа в модели тоже channel (решение
// №2 порта пиров), так что «канальность» здесь свойство ДОСТАВКИ.
func channelUpdatePayload(peer domain.PeerID, c domain.ChatRecord) map[string]any {
	return chatFullSnapshotPayload(domain.UpdateChannelFullSnapshotTag, peer, c)
}

func chatFullSnapshotPayload(tag string, peer domain.PeerID, c domain.ChatRecord) map[string]any {
	return map[string]any{
		"_":         tag,
		"peer":      domain.NewPeer(peer),
		"chat_full": domain.NewMessagesChatFull(c.ToChannelFull(), c.ToChannel()),
		"pts_count": domain.PtsCountOne,
	}
}

// publishChatUpdate логирует и рассылает участникам chat_update — абсолютный
// снимок метаданных чата после мутации (title/photo/member/admin/settings), так
// что изменение доезжает и через getDifference (плотный pts-курсор), а не только живым
// кадром. Снимок viewer-agnostic (viewerID=0): один payload всем и в лог.
// Best-effort — метаданные косметические, ошибка рассылки не должна валить мутацию.
func (i *Interactor) publishChatUpdate(ctx context.Context, chatID int64) {
	_, known, err := i.publishChatSnapshot(ctx, chatID, false)
	if err == nil && !known {
		// состояние звонка узнать не удалось, снимок ушёл без флагов — следом
		// отправится исправляющий (иначе иконка гасла бы до следующей выдачи)
		i.resnapshotLater(ctx, chatID)
	}
}

// publishChatSnapshot — снимок чата в журнал и живьём. active — состояние
// звонка, которое снимок несёт; known=false — источник звонков не ответил.
// strict: при неизвестном состоянии не публиковать вовсе (снимок по переходу
// звонка существует ради флагов, без них он вреден), иначе — опубликовать без
// флагов. domain.ErrNotFound — чата уже нет.
func (i *Interactor) publishChatSnapshot(ctx context.Context, chatID int64, strict bool) (active, known bool, err error) {
	if i.groups == nil {
		return false, true, nil
	}
	card, err := i.groups.Card(ctx, chatID, 0)
	if err != nil {
		return false, true, err
	}
	// Снимок несёт channel, а он есть только у группы и канала (у личного чата
	// пир — человек, и `channel` с внутренним ключом строки выдавал бы наш id).
	if !hasChannelBody(card.Type) {
		return false, true, nil
	}
	// Состояние звонка общее для всех зрителей, поэтому едет и в снимке без
	// зрителя (min): клиент берёт из min общее (peersManager.mergeApiChat), и без
	// флагов любое переименование гасило бы иконку идущего звонка.
	recs := []domain.ChatRecord{card}
	known = true
	if err := i.fillCallStateStrict(ctx, recs); err != nil {
		if strict {
			return false, false, err
		}
		log.Printf("chat %d: %v", chatID, err)
		known = false
	}
	card = recs[0]
	// Канал: один channel-broadcast (O(1)) по channel-конверту вместо N+1 fan-out
	// в per-user лог каждого подписчика. Подписчики получают кадр живым, остальные
	// добирают снимок при открытии через /channels/{id}/difference. Группа —
	// прежний per-user путь (у групп нет канального курсора/топика).
	if card.Type == domain.ChatTypeChannel {
		// Ключ канала один на всех подписчиков — пер-зрительского в нём нет.
		err = i.logAndPublishChannel(ctx, chatID, "chat_update",
			channelUpdatePayload(domain.ToPeerID(chatID, true), card))
		return card.Call.Active, known, err
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return false, known, err
	}
	err = i.logAndPublishPerPeer(ctx, chatID, members, "chat_update",
		func(peer domain.PeerID) map[string]any { return chatUpdatePayload(peer, card) })
	return card.Call.Active, known, err
}
