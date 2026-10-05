package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// ForwardInput selects messages from one chat to copy into another.
type ForwardInput struct {
	FromChatID int64
	ToChatID   int64
	MsgIDs     []int64
	SenderID   int64
	// DropAuthor — «скрыть отправителя» (tweb dropAuthor): копия создаётся без
	// атрибуции пересылки, выглядит как собственное сообщение получателя.
	DropAuthor bool
	// DropCaption — «убрать подпись» (tweb dropCaptions): у медиа-сообщений
	// текст/entities не копируются (для текстовых сообщений флаг игнорируется).
	DropCaption bool
	// Silent — без звука (messages.forwardMessages silent): пуш не шлётся.
	Silent bool
	// ThreadRootID — тема форума или тред, куда пересылают (top_msg_id): КЛЮЧ
	// СТРОКИ корня в ToChatID, номер переводит граница (ResolveThreadRootForSend).
	ThreadRootID *int64
}

// forwardCopy — копия одного исходного сообщения и всё, что нужно её доставке
// после коммита.
type forwardCopy struct {
	msg domain.Message
	// Канал-приёмник: тело и курсор журнала канала (живой кадр — то же тело).
	channelPayload map[string]any
	channelPts     int64
	// Остальные чаты: веер по участникам (fanOutNewMessage).
	recipients []int64
	ptsByUser  map[int64]int64
	mentions   map[int64]bool
	// Зеркало поста в группе обсуждения (пересылка в канал с обсуждением).
	mirror *mirrorDelivery
}

// ForwardMessages copies the given messages into ToChatID as new messages with
// forward attribution ("Переслано от X"). Forwarding a forward preserves the
// ORIGINAL origin (like Telegram).
//
// Источник читается по общим предикатам: чат — RequireChatRead (публичный
// канал пересылается и без вступления), каждое сообщение —
// RequireMessagesVisible (скрытая предыстория, очищенное и скрытое у себя по
// номеру не пересылаются: для зрителя их нет).
//
// Приёмник — та же отправка, что Send (у оригинала messages.forwardMessages
// подчиняется тем же CHAT_SEND_*_FORBIDDEN, USER_PRIVACY_RESTRICTED,
// SLOWMODE_WAIT, PAYMENT_REQUIRED): закрытая тема, право постинга в канал,
// права чата и личное ограничение (медиа-бит — по содержимому копий),
// медленный режим (пачку из нескольких единиц в нём не переслать),
// приватность получателя лички, плата за сообщение — всё ДО вставки. Копия
// содержимого — общий copyContent; веер, out пересылающего, упоминания,
// непрочитанное, пуш (кроме silent) и кэш диалогов — общие с Send.
func (i *Interactor) ForwardMessages(ctx context.Context, in ForwardInput) ([]domain.Message, error) {
	if len(in.MsgIDs) == 0 {
		return nil, nil
	}
	if err := i.RequireChatRead(ctx, in.FromChatID, in.SenderID); err != nil {
		return nil, err
	}
	if err := i.RequireMessagesVisible(ctx, in.SenderID, in.MsgIDs); err != nil {
		return nil, err
	}
	ok, err := i.chats.IsMember(ctx, in.ToChatID, in.SenderID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}

	// Исходники и их копии — до транзакции: по содержимому копий решаются
	// гейты (медиа-бит, голосовое, единицы медленного режима).
	srcs := make([]domain.Message, 0, len(in.MsgIDs))
	copies := make([]domain.Message, 0, len(in.MsgIDs))
	for _, srcID := range in.MsgIDs {
		src, e := i.msgs.GetByID(ctx, srcID)
		if e != nil {
			return nil, e
		}
		if src.ChatID != in.FromChatID || src.Deleted {
			return nil, domain.ErrNotFound
		}
		if !forwardable(src) {
			return nil, domain.ErrForbidden
		}
		c := copyContent(src)
		// «Убрать подпись» (tweb dropCaptions) — только для медиа-сообщений:
		// текст/entities не копируем, чтобы уехало голое медиа.
		if in.DropCaption && src.MediaID != nil {
			c.Text, c.Entities = "", nil
		}
		c.ChatID, c.SenderID, c.ThreadRootID = in.ToChatID, in.SenderID, in.ThreadRootID
		srcs = append(srcs, src)
		copies = append(copies, c)
	}
	units := regroup(copies)

	toType, err := i.chats.ChatType(ctx, in.ToChatID)
	if err != nil {
		return nil, err
	}
	broadcast := toType == domain.ChatTypeChannel
	if err := i.checkForwardAllowed(ctx, in, copies, units, broadcast); err != nil {
		return nil, err
	}
	// Цены платного медиа исходников: копия остаётся платной (иначе пересылка
	// открывала бы закрытое медиа даром).
	var prices map[int64]int64
	if i.paidMedia != nil {
		ids := make([]int64, len(srcs))
		for idx, src := range srcs {
			ids[idx] = src.ID
		}
		if prices, err = i.paidMedia.PricesByIDs(ctx, ids); err != nil {
			return nil, err
		}
	}

	// Правило автора «кто может ссылаться на мой аккаунт при пересылке»:
	// при запрете вместо ссылки (fwd_from_user_id) сохраняется только имя
	// текстом (fwd_from_name), как tweb fwd_from.from_name. Кэш на автора.
	linkAllowed := map[int64]bool{}
	canLink := func(authorID int64) bool {
		if i.privacy == nil {
			return true
		}
		if ok, cached := linkAllowed[authorID]; cached {
			return ok
		}
		ok, err := i.privacy.Check(ctx, authorID, in.SenderID, domain.PrivacyForwards)
		if err != nil {
			ok = true // best-effort: при сбое проверки атрибуцию не прячем
		}
		linkAllowed[authorID] = ok
		return ok
	}
	for idx, src := range srcs {
		// Атрибуцию пересылки заполняем, только если её не просят скрыть
		// (tweb dropAuthor): при DropAuthor копия — как собственное сообщение.
		if in.DropAuthor {
			continue
		}
		c := &copies[idx]
		// Preserve the true origin across forward-of-forward.
		c.FwdFromUserID = src.FwdFromUserID
		if c.FwdFromUserID == nil {
			c.FwdFromUserID = &srcs[idx].SenderID
		}
		c.FwdFromChatID = src.FwdFromChatID
		if c.FwdFromChatID == nil {
			c.FwdFromChatID = &srcs[idx].ChatID
		}
		c.FwdFromMsgID = src.FwdFromMsgID
		if c.FwdFromMsgID == nil {
			c.FwdFromMsgID = &srcs[idx].ID
		}
		c.FwdDate = src.FwdDate
		if c.FwdDate == nil {
			c.FwdDate = &srcs[idx].CreatedAt
		}
		// Уже скрытая атрибуция едет дальше как имя; иначе правило forwards
		// автора решает — ссылка или только имя.
		c.FwdFromName = src.FwdFromName
		if c.FwdFromName == nil && !canLink(*c.FwdFromUserID) {
			name := i.userCard(ctx, *c.FwdFromUserID).ShortName()
			c.FwdFromName = &name
		}
		if c.FwdFromName != nil {
			c.FwdFromUserID, c.FwdFromChatID, c.FwdFromMsgID = nil, nil, nil
		}
	}

	out := make([]forwardCopy, 0, len(copies))
	var charge paidCharge // платная группа: последнее списание (балансы абсолютны)
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		for idx, c := range copies {
			// Плата — за каждое сообщение (allow_paid_stars = цена × число).
			ch, e := i.chargePaidMessage(ctx, sendProbe(in.ToChatID, in.SenderID, c))
			if e != nil {
				return e
			}
			if ch.applied {
				charge = ch
			}
			seq, e := i.msgs.NextSeq(ctx, in.ToChatID)
			if e != nil {
				return e
			}
			c.Seq = seq
			msg, e := i.insertCopy(ctx, c)
			if e != nil {
				return e
			}
			if price, ok := prices[srcs[idx].ID]; ok && msg.MediaID != nil {
				if e := i.paidMedia.SetPrice(ctx, msg.ID, price); e != nil {
					return e
				}
			}
			// Пересылка увеличивает счётчик пересылок исходного поста (Telegram
			// message.forwards) — best-effort, как views.
			_ = i.msgs.IncrementForwards(ctx, srcs[idx].ID)
			// Пост в канал зеркалится в группу обсуждения (см. discussion_mirror.go).
			md, e := i.mirrorChannelPost(ctx, msg)
			if e != nil {
				return e
			}
			// Копия уходит той же формой, что история: медиа-мета, опрос,
			// чек-лист, розыгрыш, цена платного медиа (у пересылающего открыто).
			if msg, e = i.hydrateBroadcastMessage(ctx, msg); e != nil {
				return e
			}
			fc := forwardCopy{msg: msg, mirror: md}
			if broadcast {
				// Канал: одна запись журнала на копию, без веера — как пост в Send.
				fc.channelPayload = i.channelPostPayload(ctx, msg)
				raw, e := json.Marshal(fc.channelPayload)
				if e != nil {
					return e
				}
				if fc.channelPts, e = i.channels.AppendUpdate(ctx, in.ToChatID, "new_message", raw); e != nil {
					return e
				}
				out = append(out, fc)
				continue
			}
			mentioned, e := i.mentionedUsers(ctx, in.ToChatID, msg.Text, msg.Entities)
			if e != nil {
				return e
			}
			var outLocked map[string]any
			if msg.PaidMediaPrice != nil {
				outLocked = i.messageUpdatePayload(ctx, lockedPaidCopy(msg))
			}
			fc.recipients, fc.ptsByUser, fc.mentions, e = i.fanOutNewMessage(
				ctx, in.ToChatID, in.SenderID, msg.ID, msg.Seq, i.messageUpdatePayload(ctx, msg), outLocked, mentioned)
			if e != nil {
				return e
			}
			out = append(out, fc)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if charge.applied {
		i.publishBalance(ctx, in.SenderID, charge.senderBal)
		if charge.creatorID != 0 {
			i.publishBalance(ctx, charge.creatorID, charge.creatorBal)
		}
	}
	created := make([]domain.Message, 0, len(out))
	for _, fc := range out {
		created = append(created, fc.msg)
		if broadcast {
			// Пост канала — та же доставка, что у Send (channel_fanout.go);
			// черновик пересылка не снимает, превью у копии уже есть.
			i.deliverChannelPost(ctx, fc.msg, fc.channelPayload, fc.channelPts, channelPostOpts{silent: in.Silent})
		} else {
			i.publishMessageDelivery(ctx, fc.msg, in.SenderID, fc.recipients, fc.ptsByUser, fc.mentions)
			if i.notifier != nil && !in.Silent {
				for _, uid := range fc.recipients {
					if uid != in.SenderID {
						peer, _ := i.ChatIDToPeer(ctx, uid, fc.msg.ChatID)
						i.notifier.NotifyNewMessage(ctx, uid, fc.msg.ChatID, fc.msg.Seq, fc.msg.SenderID, fc.msg.Text, peer)
					}
				}
			}
		}
		// Зеркало пересланного поста — участникам группы обсуждения, тем же
		// путём, что и обычная отправка.
		if md := fc.mirror; md != nil {
			i.publishMessageDelivery(ctx, md.msg, md.msg.SenderID, md.recipients, md.ptsByUser, md.mentions)
		}
		i.publishPostReplies(ctx, fc.msg)
	}
	return created, nil
}

// checkForwardAllowed — гейты отправки Send для пачки копий, до вставки:
// закрытая тема; в канал — право постинга; иначе права чата, личное
// ограничение и медленный режим (один раз на пачку: медиа-бит — если медиа
// несёт хоть одна копия, единицы — альбом считается одной) и приватность
// получателя лички (голосовое — своё правило).
func (i *Interactor) checkForwardAllowed(ctx context.Context, in ForwardInput, copies []domain.Message, units int, broadcast bool) error {
	probe := sendProbe(in.ToChatID, in.SenderID, copies[0])
	for _, c := range copies {
		p := sendProbe(in.ToChatID, in.SenderID, c)
		if p.carriesMedia() && !probe.carriesMedia() {
			probe.MediaID, probe.PollID, probe.ChecklistID, probe.GeoLat, probe.ContactUserID =
				p.MediaID, p.PollID, p.ChecklistID, p.GeoLat, p.ContactUserID
		}
		if c.Type == "voice" || c.Type == "roundVideo" {
			probe.Type = c.Type
		}
	}
	probe.batchUnits = units
	if err := i.checkTopicOpen(ctx, probe); err != nil {
		return err
	}
	if broadcast {
		return i.requireRight(ctx, in.ToChatID, in.SenderID, domain.RightPostMessages)
	}
	if err := i.checkSendAllowed(ctx, probe); err != nil {
		return err
	}
	return i.checkPrivateSendPrivacy(ctx, probe)
}
