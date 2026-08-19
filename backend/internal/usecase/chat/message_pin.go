package chat

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// pinPreviewMaxRunes — предел длины подписи в превью закреплённого
// (tweb messageForReply: limitSymbols(text, 100)).
const pinPreviewMaxRunes = 100

// pinServiceText — JSON-экшен сервисного сообщения о закреплении (tweb
// messageActionPinMessage). Помимо автора несёт разобранное превью закреплённого
// (tweb messageForReply): id/seq цели для ссылки-перехода, тип сообщения и
// «имя» медиа с подписью — так клиент собирает фразу целиком, не заглядывая в
// само сообщение (его может не быть в загруженном окне истории).
func pinServiceText(actor domain.UserCard, m domain.Message) string {
	a := map[string]any{
		"action":   "pin_message",
		"actor_id": actor.ID,
		"actor":    actor.DisplayName,
		"msg_id":   m.ID,
		"msg_seq":  m.Seq,
		"msg_type": m.Type,
	}
	if name := pinMediaName(m); name != "" {
		a["msg_name"] = name
	}
	if m.Text != "" {
		text := m.Text
		if utf8.RuneCountInString(text) > pinPreviewMaxRunes {
			text = string([]rune(text)[:pinPreviewMaxRunes])
		}
		a["msg_text"] = text
	}
	b, _ := json.Marshal(a)
	return string(b)
}

// pinMediaName — «имя» медиа для превью (tweb messageForReply:234-239): у аудио
// это теги «название - исполнитель», иначе имя файла; у документа — имя файла.
// У остального медиа имени нет — клиент подставляет лейбл по типу сообщения.
func pinMediaName(m domain.Message) string {
	fileName := m.Media.FileName()
	switch m.Type {
	case "audio":
		tags := make([]string, 0, 2)
		if a, ok := m.Media.AudioAttr(); ok {
			if a.Title != "" {
				tags = append(tags, a.Title)
			}
			if a.Performer != "" {
				tags = append(tags, a.Performer)
			}
		}
		if len(tags) > 0 {
			return strings.Join(tags, " - ")
		}
		return fileName
	case "document":
		return fileName
	default:
		return ""
	}
}

// SetPin pins or unpins a message in a chat and fans out a pin_message update to
// all members (so everyone's pinned bar updates live). Gated by the group's
// default PIN permission for plain members / RightPinMessages for admins.
func (i *Interactor) SetPin(ctx context.Context, chatID, msgID, userID int64, pin bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if i.groups != nil {
		if err := i.requirePermOrRight(ctx, chatID, userID, domain.PermPinMessages, domain.RightPinMessages); err != nil {
			return err
		}
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.ErrNotFound
	}

	var members []int64
	var pp *peerPayloads
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if pin {
			if e := i.chats.PinMessage(ctx, chatID, msgID, userID); e != nil {
				return e
			}
		} else if e := i.chats.UnpinMessage(ctx, chatID, msgID); e != nil {
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		pp, e = i.newPeerPayloads(ctx, chatID, map[string]any{"msg_id": msgID, "pinned": pin})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			payload, e := pp.payload(uid)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "pin_message", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, pp.frame("pin_message", uid, map[string]any{"pts": ptsByUser[uid]}))
		}
	}
	// Закрепление оставляет след в ленте (tweb messageActionPinMessage). У
	// открепления парного экшена в Telegram нет (в lang.ts только
	// Chat.Service.Group.UpdatedPinnedMessage/ActionPinnedNoText, ключа «открепил»
	// не существует) — снимаем закрепление молча.
	if pin {
		pinned := []domain.Message{cur}
		// Теги трека/имя файла лежат не в строке messages, а в мете медиа —
		// подмешиваем той же ручкой, что и read-модель истории. Best-effort:
		// без меты превью просто беднее (лейбл по типу).
		_ = i.hydrateMedia(ctx, pinned)
		i.postGroupService(ctx, chatID, userID, pinServiceText(i.userCard(ctx, userID), pinned[0]))
	}
	return nil
}

// ListPins returns a chat's pinned messages (newest pin first) for a member.
func (i *Interactor) ListPins(ctx context.Context, chatID, userID int64) ([]domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.chats.ListPins(ctx, chatID)
}

// MessageViewers returns the ids of members who have seen the message (read up to
// its seq), excluding its sender. The caller must be a member.
func (i *Interactor) MessageViewers(ctx context.Context, chatID, msgID, userID int64) ([]int64, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return nil, err
	}
	if msg.ChatID != chatID {
		return nil, domain.ErrNotFound
	}
	return i.chats.Viewers(ctx, chatID, msg.Seq, msg.SenderID)
}
