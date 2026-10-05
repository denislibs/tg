package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxMessageRunes caps message/caption text length (Telegram's message limit),
// bounding storage, bandwidth, and client render cost.
const maxMessageRunes = 4096

// maxReplyQuoteRunes caps the length of a reply's quoted fragment (Telegram reply
// quote), bounding storage/render cost independently of the full message limit.
const maxReplyQuoteRunes = 1024

// replyAuthorName — имя автора отвечаемого сообщения для КРОСС-ЧАТНОГО ответа:
// название канала/группы, от чьего имени он опубликован, иначе имя человека.
//
// Единственное место, где сервер по-прежнему склеивает имя, и это не оплошность:
// оригинал того ответа зрителю НЕДОСТУПЕН (публичного ключа у чата-источника не
// существует), поэтому карточки пира у него не будет никогда. На проводе имя
// едет как reply_from.from_name — ровно тем же параметром, каким оригинал
// выражает скрытую атрибуцию пересылки.
//
// Снимка ТЕКСТА оригинала здесь больше нет: в схеме превью недоступного
// оригинала строится из цитаты и вложения, а не из обрезанного сервером текста.
func (i *Interactor) replyAuthorName(ctx context.Context, orig domain.Message) string {
	if orig.SendAsChatID != nil && i.groups != nil {
		if briefs, err := i.groups.ChatBriefs(ctx, []int64{*orig.SendAsChatID}); err == nil {
			if b, ok := briefs[*orig.SendAsChatID]; ok && b.Title != "" {
				return b.Title
			}
		}
	}
	return i.userCard(ctx, orig.SenderID).Title()
}

// mentionedUserIDs collects the distinct target users of a message's
// "text_mention" entities (Telegram's mention-of-a-user-without-username, which
// carries the user id inline). Plain "@username" mentions carry no user id —
// they're resolved against the chat's members by mentionedUsers.
func mentionedUserIDs(entities domain.MessageEntities) map[int64]bool {
	var out map[int64]bool
	for _, e := range entities {
		v, ok := e.(domain.MessageEntityMentionName)
		if !ok || v.UserID <= 0 {
			continue
		}
		if out == nil {
			out = map[int64]bool{}
		}
		out[v.UserID] = true
	}
	return out
}

// mentionedUsers — кого упоминает сообщение в чате chatID: адресаты
// text_mention (user_id в сущности) плюс участники чата, чьё «@username»
// стоит в тексте. Второе сервер распознаёт сам, как Telegram: клиент шлёт
// @username голым текстом, без сущности (разметка — на показе). Отправителя
// отсекает fanOutNewMessage — упоминание считается только у получателей.
func (i *Interactor) mentionedUsers(ctx context.Context, chatID int64, text string, entities domain.MessageEntities) (map[int64]bool, error) {
	out := mentionedUserIDs(entities)
	names := domain.MentionedUsernames(text, entities)
	if len(names) == 0 {
		return out, nil
	}
	ids, err := i.chats.MemberIDsByUsernames(ctx, chatID, names)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if out == nil {
			out = map[int64]bool{}
		}
		out[id] = true
	}
	return out, nil
}

// messageMentions — кого упоминает сообщение msg в его чате: mentionedUsers
// плюс автор сообщения, на которое msg отвечает. Ответ на твоё сообщение в
// группе — упоминание (Telegram: reply → message.mentioned у автора
// оригинала). Только группа: в личке упоминать некого сверх собеседника, а
// пост канала адресатов не имеет. Ответ на сообщение от лица канала (send-as)
// и на зеркало поста канала человека не упоминает — автор там канал.
// Служебное сообщение не упоминает никого.
func (i *Interactor) messageMentions(ctx context.Context, msg domain.Message) (map[int64]bool, error) {
	// Служебное сообщение (пилюля) не упоминает: у messageService флага
	// mentioned нет, а его reply_to — цель действия (закреп), не ответ.
	if msg.Action != nil {
		return nil, nil
	}
	out, err := i.mentionedUsers(ctx, msg.ChatID, msg.Text, msg.Entities)
	if err != nil {
		return nil, err
	}
	if msg.ReplyToID == nil || msg.ReplyToPeerID != nil {
		return out, nil
	}
	typ, err := i.chats.ChatType(ctx, msg.ChatID)
	if err != nil || typ != domain.ChatTypeGroup {
		return out, err
	}
	orig, err := i.messageBySeq(ctx, msg.ChatID, *msg.ReplyToID)
	if errors.Is(err, domain.ErrNotFound) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	if orig.Deleted || orig.SendAsChatID != nil || orig.IsDiscussionMirror || orig.SenderID <= 0 {
		return out, nil
	}
	if out == nil {
		out = map[int64]bool{}
	}
	out[orig.SenderID] = true
	return out, nil
}

// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
func (i *Interactor) Send(ctx context.Context, in SendInput) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		// Комментарий в discussion-группе канала: подписчик пишет без вступления —
		// авто-джойн, как PostComment (tweb: sendMessage в тред вступает в группу).
		// Вступление — общей точкой (admit): забаненный ответом в тред не
		// возвращается.
		// Вступать может только читатель обсуждения: читает группу или её
		// канал и не забанен в группе (RequireDiscussionRead).
		joined := false
		if in.ThreadRootID != nil && i.groups != nil {
			if disc, e := i.groups.IsDiscussionGroup(ctx, in.ChatID); e == nil && disc &&
				i.RequireDiscussionRead(ctx, in.ChatID, in.SenderID) == nil {
				if _, e := i.admit(ctx, in.ChatID, in.SenderID, in.SenderID, admitSelf); e == nil {
					joined = true
				}
			}
		}
		if !joined {
			return domain.Message{}, domain.ErrNotFound
		}
	}
	if err := i.checkTopicOpen(ctx, in); err != nil {
		return domain.Message{}, err
	}
	// Вид ДОСТАВКИ — свойство ПИРА, а не ручки. У оригинала метод отправки один
	// (messages.sendMessage/sendMedia), а «пост канала» получается из того, что
	// получатель — broadcast: сервер отвечает updateNewChannelMessage, а не
	// веером по подписчикам. У нас развилка стояла в ДРУГОМ месте — в выборе
	// ручки (PostToChannel против Send), — и потому обходилась: ручка постинга
	// принимает только текст, так что пост С КАРТИНКОЙ уезжал обычной
	// отправкой, мимо журнала канала и мимо гейта прав.
	chatType, err := i.chats.ChatType(ctx, in.ChatID)
	if err != nil {
		return domain.Message{}, err
	}
	broadcast := chatType == domain.ChatTypeChannel
	// Вид строки выводится ИЗ ДЕЙСТВИЯ, а не приходит полем: «служебное ли» —
	// это выбор конструктора, и клиент его назначить не может (у него в теле
	// запроса действия нет вовсе; лог звонка кладёт сервер по концу звонка,
	// phonecall.go). Лог звонка при этом остаётся отдельным видом строки: по
	// нему идёт выборка журнала звонков.
	switch {
	case in.Action == nil && in.Type == "":
		in.Type = "text"
	case in.Action == nil:
	default:
		in.Text, in.Entities = "", nil
		if _, isCall := in.Action.(domain.MessageActionPhoneCall); isCall {
			in.Type = "call"
		} else {
			in.Type = "service"
		}
	}
	if utf8.RuneCountInString(in.Text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	in.Entities = domain.SanitizeEntities(in.Entities)
	// Ответ на сообщение: адрес оригинала — пара «пир + номер»
	// (messageReplyHeader: reply_to_msg_id осмыслен только вместе с
	// reply_to_peer_id, отсутствие которого значит «тот же пир»). Резолвим
	// оригинал всегда, когда ответ есть.
	//   • пир указан и он ДРУГОЙ → кросс-чат-ответ (Telegram reply_to_peer_id):
	//     проверяем членство отправителя в том чате (нет доступа → forbidden) и
	//     собираем снимок превью (имя автора + текст/лейбл) прямо на ответе, т.к.
	//     получатель может не иметь доступа к исходному чату;
	//   • пира нет → обычный ответ в этом же чате (снимки пустые, peer nil);
	//   • оригинал не найден/удалён → как ненайденный reply: не падаем, снимков
	//     нет, ссылка на чужой пир сбрасывается (непроверенный чат наружу не едет).
	var replyPeerID *int64
	var snapName string
	// origText — текст найденного оригинала ответа: цитата сверяется с ним.
	var origText *string
	if in.ReplyToID != nil {
		srcChat := in.ChatID
		if in.ReplyToPeerID != nil {
			srcChat = *in.ReplyToPeerID
		}
		orig, err := i.messageBySeq(ctx, srcChat, *in.ReplyToID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			// ненайденный оригинал — обычный reply без снимка (не ошибка)
		case err != nil:
			return domain.Message{}, err
		case orig.Deleted:
			// удалённый оригинал — как ненайденный
		case orig.ChatID != in.ChatID:
			origText = &orig.Text
			ok, err := i.chats.IsMember(ctx, orig.ChatID, in.SenderID)
			if err != nil {
				return domain.Message{}, err
			}
			if !ok {
				return domain.Message{}, domain.ErrForbidden // нет доступа к исходному чату
			}
			src := orig.ChatID
			replyPeerID = &src
			snapName = i.replyAuthorName(ctx, orig)
		default:
			origText = &orig.Text
		}
	}
	// Reply quote: осмыслен только при ответе; обрезаем длину, пустой — сбрасываем.
	// Цитата — ФРАГМЕНТ оригинала (сервер Telegram: QUOTE_TEXT_INVALID): чужих
	// слов, которых автор не писал, в «цитате» быть не может. Оригинала нет —
	// цитировать нечего, ответ остаётся обычным.
	if in.ReplyToID == nil {
		in.ReplyQuoteText, in.ReplyQuoteOffset = nil, nil
	} else if in.ReplyQuoteText != nil {
		q := *in.ReplyQuoteText
		if utf8.RuneCountInString(q) > maxReplyQuoteRunes {
			q = string([]rune(q)[:maxReplyQuoteRunes])
		}
		if q == "" || origText == nil {
			in.ReplyQuoteText, in.ReplyQuoteOffset = nil, nil
		} else {
			off, ok := quoteOffset(*origText, q, in.ReplyQuoteOffset)
			if !ok {
				return domain.Message{}, domain.ErrInvalid
			}
			in.ReplyQuoteText, in.ReplyQuoteOffset = &q, &off
		}
	}
	if in.MediaID != nil {
		ownerID, err := i.mediaAccess.OwnerID(ctx, *in.MediaID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			return domain.Message{}, domain.ErrNotFound // media absent
		case err != nil:
			return domain.Message{}, err // propagate real DB errors (don't mask as 403)
		case ownerID != in.SenderID && in.skipMediaOwner:
			// Share истории: media принадлежит автору истории, а не отправителю;
			// видимость истории уже проверена story-usecase, поэтому владельца не сверяем.
		case ownerID != in.SenderID:
			// Стикер шлётся чужим media: наборы публичны, поэтому достаточно,
			// чтобы media принадлежало какому-либо стикеру.
			if in.Type == "sticker" && i.stickers != nil {
				ok, e := i.stickers.IsStickerMedia(ctx, *in.MediaID)
				if e != nil {
					return domain.Message{}, e
				}
				if ok {
					break
				}
			}
			return domain.Message{}, domain.ErrNotFound // not owned by sender
		}
		if in.Type == "document" {
			t, err := i.documentKind(ctx, *in.MediaID)
			if err != nil {
				return domain.Message{}, err
			}
			in.Type = t
		}
	}

	// Гео/контакт: координаты в валидном диапазоне; контакт гидрируется по
	// аккаунту (снимок имени/телефона хранится на сообщении, как в Telegram).
	var contactName, contactPhone *string
	if in.Type == "geo" {
		if in.GeoLat == nil || in.GeoLng == nil ||
			*in.GeoLat < -90 || *in.GeoLat > 90 || *in.GeoLng < -180 || *in.GeoLng > 180 {
			return domain.Message{}, domain.ErrForbidden
		}
		// Live location: период трансляции в разумных пределах (Telegram: 15 мин…8 ч).
		if in.GeoLivePeriod != nil {
			if *in.GeoLivePeriod < 60 || *in.GeoLivePeriod > 8*3600 {
				return domain.Message{}, domain.ErrForbidden
			}
		}
		if in.GeoHeading != nil && (*in.GeoHeading < 0 || *in.GeoHeading > 359) {
			in.GeoHeading = nil
		}
	} else {
		in.GeoLat, in.GeoLng = nil, nil
		in.GeoTitle, in.GeoAddress, in.GeoLivePeriod, in.GeoHeading = nil, nil, nil, nil
	}
	if in.Type == "contact" {
		if in.ContactUserID == nil {
			return domain.Message{}, domain.ErrForbidden
		}
		c := i.userCard(ctx, *in.ContactUserID)
		if c.Title() == "" && c.Phone == "" {
			return domain.Message{}, domain.ErrNotFound // такого аккаунта нет
		}
		name, phone := c.Title(), c.Phone
		contactName, contactPhone = &name, &phone
	} else {
		in.ContactUserID = nil
	}

	if in.Type == "encrypted" {
		if len(in.EncBody) == 0 {
			return domain.Message{}, domain.ErrInvalid
		}
		// Плейнтекст в секретном чате не хранится: сервер держит только шифр-блоб.
		in.Text, in.Entities = "", nil
	}

	// Эффект сообщения (наш аналог Telegram message effects): whitelist + только
	// у text/медиа-сообщений (service/encrypted/gift/… эффект не несут).
	in.Effect = sanitizeEffect(in.Effect, in.Type)

	// Групповые дефолтные разрешения + slowmode + приватность получателя.
	// Служебные сообщения, которые генерирует сам сервер (лог звонка, состав
	// группы), не ограничиваем: решение «можно ли» принято там, где родилось
	// действие (звонок, например, гейтится правилом звонков на call_request).
	// Действие ПО ЗАПРОСУ пользователя (userAction) — та же отправка.
	if in.Action == nil || in.userAction {
		switch {
		case broadcast:
			// В канал пишут ПО ПРАВУ ПОСТИНГА. Дефолтная маска участника
			// группы здесь не годится: подписчик — read-only роль
			// (domain/rights.go), а маска чата по умолчанию (31) отправку
			// разрешает — и checkSendAllowed, у которого ветки для подписчика
			// нет вовсе, пропускал его. То есть подписчик мог опубликовать в
			// канал что угодно, послав обычное сообщение вместо вызова ручки
			// постинга. Слоумод и приватность получателя предмета у broadcast
			// не имеют.
			if err := i.requireRight(ctx, in.ChatID, in.SenderID, domain.RightPostMessages); err != nil {
				return domain.Message{}, err
			}
		default:
			if err := i.checkSendAllowed(ctx, in); err != nil {
				return domain.Message{}, err
			}
			// Приватный чат: настройки получателя «кто может отправлять мне
			// сообщения / голосовые» + чёрный список.
			if err := i.checkPrivateSendPrivacy(ctx, in); err != nil {
				return domain.Message{}, err
			}
		}
	}

	// Send-as (Telegram send_as): отправка от имени канала/группы. «От себя»
	// (send_as == сам автор) сбрасываем в nil; иначе проверяем право — юзер должен
	// быть админом/владельцем указанного канала, либо это анонимный постинг от
	// имени самой супергруппы (где он админ). Сервисные сообщения send_as не несут.
	if in.SendAsChatID != nil {
		if in.Type == "service" || *in.SendAsChatID == in.SenderID {
			in.SendAsChatID = nil
		} else {
			ok, e := i.canSendAs(ctx, in.SenderID, in.ChatID, *in.SendAsChatID)
			if e != nil {
				return domain.Message{}, e
			}
			if !ok {
				return domain.Message{}, domain.ErrForbidden
			}
		}
	}

	// PERF (send hot path): гидратация read-моделей (poll/checklist/giveaway/
	// gift) читает ПРЕД-существующие строки по input-ID и не зависит от
	// msg.ID/Seq — делаем ДО транзакции, чтобы не держать row-lock строки чата
	// (IncUnreadBulk) на этих чтениях. Результаты применяются к msg после Insert.
	// Media-мета (hydrateMedia) и все записи (charge/SetPrice/fan-out) — в tx.
	//
	// Снимка send-as здесь больше нет: отображаемый автор едет ссылкой на пир
	// (from_id), а его название и аватарка — карточкой чата.
	var (
		prePoll      *domain.PollInfo
		preChecklist *domain.ChecklistInfo
		preGiveaway  *domain.GiveawayInfo
		preGift      *domain.GiftInfo
	)
	if in.PollID != nil && i.polls != nil {
		if info, e := i.pollInfoFor(ctx, *in.PollID, 0); e == nil {
			prePoll = &info
		}
	}
	if in.ChecklistID != nil && i.checklists != nil {
		if info, e := i.checklists.Info(ctx, *in.ChecklistID); e == nil {
			preChecklist = &info
		}
	}
	if in.GiveawayID != nil && i.giveaways != nil {
		if info, e := i.giveawayInfoFor(ctx, *in.GiveawayID, 0); e == nil {
			preGiveaway = &info
		}
	}
	if in.GiftID != nil && i.stars != nil {
		if info, e := i.stars.GiftInfo(ctx, *in.GiftID, 0); e == nil {
			preGift = &info
		}
	}

	var msg domain.Message
	var recipients []int64      // non-nil only when a NEW message was inserted
	var mentions map[int64]bool // упомянутые получатели (pFlags.mentioned в кадре)
	// channelPts — курсор журнала канала, полученный при записи поста; 0 значит
	// «в журнал ничего не легло» (не канал либо дедуп по client_msg_id).
	// channelPayload — ТО ЖЕ тело, что легло в журнал: живой кадр строится из
	// него, а не собирается заново, иначе догон разрыва и live разъедутся.
	var channelPts int64
	var channelPayload map[string]any
	var charge paidCharge // платная группа: списание/начисление (публикуем после коммита)
	// Зеркало поста канала (если вставленное сообщение — пост в канал с
	// обсуждением, см. mirrorChannelPost): доставка публикуется ПОСЛЕ коммита
	// этой же transaction, тем же publishMessageDelivery, что и msg ниже.
	var mirrorDeliv *mirrorDelivery
	// Per-recipient pts (dense cursor), captured INSIDE the tx so the live frame
	// carries exactly the value persisted for each member.
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if in.ClientMsgID != "" {
			if existing, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
			} else if !errors.Is(e, domain.ErrNotFound) {
				return e
			}
		}
		// Платные сообщения (Telegram paid messages): списываем звёзды ПЕРЕД
		// вставкой, в той же транзакции (нехватка → ErrPaidRequired откатывает всё).
		c, e := i.chargePaidMessage(ctx, in)
		if e != nil {
			return e
		}
		charge = c
		// Запись, обязанная лечь в эту же транзакцию (подарок: списание и
		// выдача) — после всех гейтов, до вставки сообщения.
		if in.prepare != nil {
			if e := in.prepare(ctx, &in); e != nil {
				return e
			}
		}
		seq, e := i.msgs.NextSeq(ctx, in.ChatID)
		if e != nil {
			return e
		}
		var cmid *string
		if in.ClientMsgID != "" {
			cmid = &in.ClientMsgID
		}
		// grouped_id — схемный long: непрозрачный ключ медиагруппы, который
		// генерирует отправитель. 0 значит «не в группе» (в схеме это
		// отсутствие flags.17), поэтому отдельного «пустого» значения нет.
		var groupedID *int64
		if in.GroupedID != 0 {
			groupedID = &in.GroupedID
		}
		msg, e = i.msgs.Insert(ctx, domain.Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, Entities: in.Entities, ReplyToID: in.ReplyToID, ClientMsgID: cmid,
			ReplyQuoteText: in.ReplyQuoteText, ReplyQuoteOffset: in.ReplyQuoteOffset,
			ReplyToPeerID: replyPeerID, ReplySnapshotName: snapName, Action: in.Action,
			MediaID: in.MediaID, ThreadRootID: in.ThreadRootID, GroupedID: groupedID, PollID: in.PollID,
			ChecklistID: in.ChecklistID,
			GiveawayID:  in.GiveawayID,
			GiftID:      in.GiftID, ReplyMarkup: in.ReplyMarkup,
			GeoLat: in.GeoLat, GeoLng: in.GeoLng,
			GeoTitle: in.GeoTitle, GeoAddress: in.GeoAddress,
			GeoLivePeriod: in.GeoLivePeriod, GeoHeading: in.GeoHeading,
			ContactUserID: in.ContactUserID, ContactName: contactName, ContactPhone: contactPhone,
			EncBody: in.EncBody, TTLSeconds: in.TTLSeconds, Effect: in.Effect,
			SendAsChatID: in.SendAsChatID,
			// Спойлер — свойство вложения, без медиа он бессмысленен (так же
			// гейтится PaidMediaPrice ниже: только при msg.MediaID != nil).
			MediaSpoiler: in.MediaSpoiler && in.MediaID != nil,
			// Voice/round content starts "unlistened" (Telegram media_unread).
			MediaUnread: in.Type == "voice" || in.Type == "roundVideo",
		})
		if e != nil {
			return e
		}
		// Пост в канал зеркалится в группу обсуждения (см. discussion_mirror.go).
		// Что считать постом — решает сам хелпер (по типу чата-получателя), не
		// клиентское ThreadRootID. mirrorChannelPost уже доставляет зеркало
		// участникам группы (pts/unread) ВНУТРИ этой транзакции — mirrorDeliv
		// публикуется (кадры/кэш) ниже, после коммита, как и сам msg.
		md, e := i.mirrorChannelPost(ctx, msg)
		if e != nil {
			return e
		}
		mirrorDeliv = md
		// Применяем гидратацию, посчитанную ДО транзакции (представления
		// poll/checklist/giveaway/gift одинаковы для всех получателей и не
		// зависят от только что вставленной строки). Пустые — no-op.
		msg.Poll = prePoll
		msg.Checklist = preChecklist
		msg.Giveaway = preGiveaway
		msg.Gift = preGift
		if msg.Gift == nil && msg.GiftID != nil && i.stars != nil {
			// подарок выдан в этой же транзакции (prepare) — до неё id не было
			if info, e := i.stars.GiftInfo(ctx, *msg.GiftID, 0); e == nil {
				msg.Gift = &info
			}
		}
		// Медиа-мета в live-кадр (имя/размер/mime/размеры) — как в history read
		// model, чтобы файл у получателя не рисовался заглушкой до перезагрузки.
		if msg.MediaID != nil {
			one := []domain.Message{msg}
			if e := i.hydrateMedia(ctx, one); e == nil {
				msg = one[0]
			}
		}
		// Платное медиа (Telegram paid media): цена в отдельной таблице, флаг едет
		// на сообщении для рассылки. Только фото/видео с прикреплённым медиа.
		if in.PaidMediaPrice != nil && *in.PaidMediaPrice > 0 && msg.MediaID != nil &&
			isPaidMediaType(in.Type) && i.paidMedia != nil {
			price := *in.PaidMediaPrice
			if price > maxPaidMediaPrice {
				price = maxPaidMediaPrice
			}
			if e := i.paidMedia.SetPrice(ctx, msg.ID, price); e != nil {
				return e
			}
			msg.PaidMediaPrice = &price
		}
		// Канал: ОДНА запись в журнал канала вместо веера по подписчикам —
		// O(1) на пост независимо от числа читателей, и ровно эта запись
		// отдаётся догоном разрыва (/difference). Тело кадра одно на всех, оно
		// же уходит живьём (см. публикацию после коммита), поэтому
		// пер-зрительских вариантов — out, locked у платного медиа, счётчиков
		// непрочитанного и упоминаний — здесь нет вовсе: см. channelPostPayload.
		if broadcast {
			channelPayload = i.channelPostPayload(ctx, msg)
			payload, err := json.Marshal(channelPayload)
			if err != nil {
				return err
			}
			channelPts, err = i.channels.AppendUpdate(ctx, in.ChatID, "new_message", payload)
			return err
		}
		// Упоминания: text_mention, «@username» участников, автор отвечаемого.
		mentioned, e := i.messageMentions(ctx, msg)
		if e != nil {
			return e
		}
		// Корень треда едет ВНУТРИ сообщения (reply_to.reply_to_top_id) —
		// messageUpdatePayload его туда и кладёт. Отдельного ключа на уровне
		// кадра больше нет: это был второй источник того же факта, и именно
		// такие «каждый вызывающий дописывает сам» терялись поодиночке.
		outMsg := i.messageUpdatePayload(ctx, msg)
		// Платное медиа: получателям (не автору) в персональный апдейт кладём
		// заблокированный вариант — без ссылок на контент, только blur+цена.
		var outLocked map[string]any
		if msg.PaidMediaPrice != nil {
			outLocked = i.messageUpdatePayload(ctx, lockedPaidCopy(msg))
		}
		// Веер по участникам чата (pts-лог + unread + упоминания), батчами: 3
		// запроса вместо 3×M. Раньше на каждого участника шли AppendUpdate (2
		// запроса) + IncUnread — под локом строки chats это O(M) запросов в
		// одной транзакции (замер: 0.34 мс/участник, 200 → 70 мс). Общий с
		// доставкой зеркала поста канала — см. fanOutNewMessage.
		recipients, ptsByUser, mentions, e = i.fanOutNewMessage(
			ctx, in.ChatID, in.SenderID, msg.ID, msg.Seq, outMsg, outLocked, mentioned)
		return e
	})
	if err != nil {
		return domain.Message{}, err
	}
	// Платная отправка прошла: рассылаем обеим сторонам новый баланс звёзд.
	if charge.applied {
		i.publishBalance(ctx, in.SenderID, charge.senderBal)
		if charge.creatorID != 0 {
			i.publishBalance(ctx, charge.creatorID, charge.creatorBal)
		}
	}
	// Канал: одна публикация в топик канала вместо веера. Кадр несёт
	// channel_pts — тот же конверт, который переигрывает /difference, поэтому
	// клиент гейтит его по пер-канальному курсору и не получает дубля.
	if channelPts != 0 && i.chPub != nil {
		_ = i.chPub.PublishToChannel(ctx, in.ChatID, frameChannelMessage("new_message", channelPayload, channelPts))
	}
	if recipients != nil {
		// Кэш диалогов + realtime-кадры получателям — общий с доставкой
		// зеркала поста канала путь (см. publishMessageDelivery/fanout.go).
		i.publishMessageDelivery(ctx, msg, in.SenderID, recipients, ptsByUser, mentions)
		if i.notifier != nil && !in.Silent {
			for _, uid := range recipients {
				if uid != in.SenderID {
					peer, _ := i.ChatIDToPeer(ctx, uid, msg.ChatID)
					i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.Seq, msg.SenderID, msg.Text, peer)
				}
			}
		}
		// Отправка сообщения снимает черновик чата (Telegram-семантика);
		// служебное — например, лог звонка — черновика не трогает.
		if in.Action == nil {
			i.clearDraftAfterSend(ctx, in.SenderID, in.ChatID)
		}
	}
	// Комментарий к посту канала (сообщение в тред зеркала): счётчик «N
	// комментариев» у самого поста вырос — рассылаем его подписчикам канала.
	// «Комментарий ли это» решает сама publishPostReplies, по корню треда.
	i.publishPostReplies(ctx, msg)
	// Зеркало поста канала (если было создано выше) — доставляем участникам
	// группы обсуждения ТЕМ ЖЕ путём, тоже после коммита. Отдельно от блока
	// выше: зеркало живёт в ДРУГОМ чате (группе обсуждения), не in.ChatID.
	if mirrorDeliv != nil {
		i.publishMessageDelivery(ctx, mirrorDeliv.msg, mirrorDeliv.msg.SenderID,
			mirrorDeliv.recipients, mirrorDeliv.ptsByUser, mirrorDeliv.mentions)
	}
	// Серверное превью ссылки (Telegram-семантика: превью строит сервер и
	// рассылает всем): для нового текстового сообщения с http/https-ссылкой —
	// асинхронно после коммита, кадром web_page_update (сервисные/секретные
	// сообщения исключены: service не text, secret отсекается по типу чата).
	if recipients != nil && i.preview != nil && in.Type == "text" {
		if u := firstURL(msg.Text, msg.Entities); u != "" {
			go i.attachWebPreview(msg, u, recipients)
		}
	}
	// Авто-ответ бота: обычное текстовое сообщение в приватный чат с ботом.
	if in.Type == "text" && in.Text != "" {
		i.maybeBotReply(ctx, in.ChatID, in.SenderID, msg.ID, in.Text)
	}
	return msg, nil
}

// MessageByClientMsgID — сообщение по КЛЮЧУ ИДЕМПОТЕНТНОСТИ ОТПРАВКИ (чат +
// автор + client_msg_id): ровно по нему Send отсекает повторную отправку. Метод
// отвечает на вопрос «это уже отправлено?» ДО вызова Send — тому, кто платит за
// саму подготовку отправки (заливка медиа, создание опроса) и не может
// позволить себе узнать про дубль только внутри Send.
// Спрашивают ОТ ИМЕНИ senderID (метод отдаёт только его собственные
// сообщения), и он обязан состоять в чате — как у соседних сквозных чтений
// (ListPins, MessageViewers): без этой проверки метод отвечал бы по паре
// «чат + автор», к которой спрашивающий отношения не имеет.
// domain.ErrNotFound — сообщения нет либо senderID в чате не состоит.
func (i *Interactor) MessageByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, senderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	return i.msgs.FindByClientMsgID(ctx, chatID, senderID, clientMsgID)
}

// documentKind — вид сообщения для файла, присланного документом. Трек
// (domain.IsAudioMime) — это 'audio', каким бы пунктом меню его ни выбрали:
// у оригинала ветка аудио в makeDocumentAndMetaForSendingFile стоит до
// `!args.isMedia`, а сервер Telegram определяет тип контента документа сам.
// Вид строки messages решает атрибуты документа (documentAttributeAudio) и
// вкладку «Музыка», поэтому нормализуется здесь, при приёме, — данные верны
// от любого клиента, включая Bot API sendDocument.
func (i *Interactor) documentKind(ctx context.Context, mediaID int64) (string, error) {
	dims, err := i.mediaAccess.DimsByIDs(ctx, []int64{mediaID})
	if err != nil {
		return "", err
	}
	if domain.IsAudioMime(dims[mediaID].Mime) {
		return "audio", nil
	}
	return "document", nil
}

// SendStoryShare posts a story into a chat as a regular media message with an
// attribution caption (story-usecase's MessageSender port; tweb inputMediaStory,
// lightweight variant without a dedicated message type). The story-usecase has
// already checked story visibility, so the media-owner check is skipped; chat
// membership, slowmode and send-privacy still apply through Send (a non-member
// yields domain.ErrNotFound). The message type follows the media mime.
func (i *Interactor) SendStoryShare(ctx context.Context, chatID, senderID, mediaID int64, caption string) error {
	msgType := "photo"
	if dims, err := i.mediaAccess.DimsByIDs(ctx, []int64{mediaID}); err == nil {
		if d, ok := dims[mediaID]; ok && strings.HasPrefix(d.Mime, "video/") {
			msgType = "video"
		}
	}
	_, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: senderID, Type: msgType,
		Text: caption, MediaID: &mediaID, skipMediaOwner: true,
	})
	return err
}

// MarkRead advances a member's last_read_seq, recomputes unread, and appends a
// read update to all members (so senders see read receipts and other devices sync).
func (i *Interactor) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	var members []int64
	var effective int64
	var advanced bool
	var unread int
	var readAddr chatAddress
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		cur, e := i.chats.CurrentReadSeq(ctx, chatID, userID)
		if e != nil {
			return e
		}
		effective = upToSeq
		if cur > effective {
			effective = cur
		}
		advanced = effective > cur
		u, e := i.msgs.CountUnread(ctx, chatID, userID, effective)
		if e != nil {
			return e
		}
		unread = u
		if e := i.chats.SetRead(ctx, chatID, userID, effective, unread); e != nil {
			return e
		}
		// История горизонта: по отметке на каждое продвижение — из неё берётся
		// дата «Прочитано в HH:MM» для конкретного сообщения (OutboxReadDate).
		if advanced {
			if e := i.chats.AppendReadMark(ctx, chatID, userID, effective); e != nil {
				return e
			}
		}
		// Прочитанное до effective снимает непрочитанные упоминания с seq<=effective
		// и пересчитывает счётчик «@» (Telegram readMentions).
		if _, e := i.chats.ClearMentions(ctx, chatID, userID, effective); e != nil {
			return e
		}
		// Открытие чата гасит и бейдж непрочитанных реакций (Telegram
		// readReactions): счётчик простой, сбрасываем в ноль при прочтении.
		if e := i.chats.ClearUnreadReactions(ctx, chatID, userID); e != nil {
			return e
		}
		// Self-destruct: запускаем таймер для секретных сообщений, которые
		// читатель только что получил (no-op для чатов без ttl).
		if e := i.msgs.SetDestructOnRead(ctx, chatID, userID, effective); e != nil {
			return e
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		// Тело кадра — КОНСТРУКТОР, и он разный у читателя и у остальных:
		// updateReadHistoryInbox несёт мой счётчик непрочитанного,
		// updateReadHistoryOutbox — только горизонт (см. readPayload).
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		readAddr = addr
		date := nowMillis()
		for _, uid := range members {
			payload, e := json.Marshal(readPayload(addr.forViewer(uid), effective, unread, uid == userID))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "read", payload)
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
	// Прочтение обнулило unread читателя — сбрасываем его кэш снапшота диалогов.
	if i.dialogsCache != nil && advanced {
		i.dialogsCache.Invalidate(ctx, userID)
	}
	// Only fan out when the read marker actually advanced — a no-op re-read
	// must not spam every member with a redundant read frame.
	if i.publisher != nil && advanced {
		for _, uid := range members {
			body := readPayload(readAddr.forViewer(uid), effective, unread, uid == userID)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("read", body, ptsByUser[uid]))
		}
	}
	// Channel posts track a per-viewer view count: register this reader's view of
	// every post up to the read marker (deduped, self-gated to channels). Only on a
	// real advance — a no-op re-read shouldn't re-run it. Best-effort: views are
	// approximate and must never fail the read.
	if advanced {
		_ = i.msgs.RegisterChannelViews(ctx, chatID, userID, effective)
	}
	return nil
}

// OutboxReadDate returns when the peer read the caller's outgoing message in a
// private 1:1 chat (tweb messages.getOutboxReadDate → outboxReadDate.date).
//
// Only private chats, only the caller's own (outgoing) message, only once the
// peer has actually read it (message seq within the peer's read horizon).
// Reciprocity mirrors Telegram: the caller sees the peer's read time only if
// both sides share their read time with each other (read_time privacy) — hide
// yours and you stop seeing theirs → domain.ErrForbidden. Anything that simply
// makes the read date unavailable (not private, not outgoing, not yet read, peer
// never read anything) → domain.ErrNotFound, so the client just omits the row.
func (i *Interactor) OutboxReadDate(ctx context.Context, chatID, msgID, viewerID int64) (time.Time, error) {
	kind, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return time.Time{}, err
	}
	if kind != domain.ChatTypePrivate {
		return time.Time{}, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return time.Time{}, err
	}
	// Must be the caller's own message in this chat (outgoing).
	if msg.ChatID != chatID || msg.SenderID != viewerID {
		return time.Time{}, domain.ErrNotFound
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return time.Time{}, err
	}
	var peerID int64
	for _, uid := range members {
		if uid != viewerID {
			peerID = uid
			break
		}
	}
	if peerID == 0 {
		return time.Time{}, domain.ErrNotFound
	}
	// The peer must have read this message (seq within their read horizon).
	peerRead, err := i.chats.CurrentReadSeq(ctx, chatID, peerID)
	if err != nil {
		return time.Time{}, err
	}
	if msg.Seq > peerRead {
		return time.Time{}, domain.ErrNotFound
	}
	// Reciprocity: both sides must share their read time with each other.
	if i.privacy != nil {
		peerShares, err := i.privacy.Check(ctx, peerID, viewerID, domain.PrivacyReadTime)
		if err != nil {
			return time.Time{}, err
		}
		iShare, err := i.privacy.Check(ctx, viewerID, peerID, domain.PrivacyReadTime)
		if err != nil {
			return time.Time{}, err
		}
		if !peerShares || !iShare {
			return time.Time{}, domain.ErrForbidden
		}
	}
	// Дата — из истории горизонта: ближайшая сверху отметка, покрывшая этот seq.
	// Фолбэк на общую last_read_at нужен для сообщений, прочитанных ДО появления
	// истории (и для тех, чья отметка вышла за срок хранения).
	at, ok, err := i.chats.ReadAtForSeq(ctx, chatID, peerID, msg.Seq)
	if err != nil {
		return time.Time{}, err
	}
	if !ok {
		at, ok, err = i.chats.LastReadAt(ctx, chatID, peerID)
		if err != nil {
			return time.Time{}, err
		}
	}
	if !ok {
		return time.Time{}, domain.ErrNotFound
	}
	return at, nil
}

// NextMention returns the id (номер в чате) of the caller's earliest unread
// mention past afterSeq (Telegram getUnreadMentions / «jump to next @»). Not a
// member → domain.ErrNotFound; also domain.ErrNotFound when there is none.
func (i *Interactor) NextMention(ctx context.Context, chatID, userID, afterSeq int64) (seq int64, err error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, domain.ErrNotFound
	}
	return i.chats.NextMention(ctx, chatID, userID, afterSeq)
}

// ClearHistory очищает историю чата у себя (Telegram deleteHistory just_clear):
// поднимает персональный горизонт участника до текущего максимума seq чата —
// сообщения с seq<=горизонта больше не отдаются в истории этому пользователю и
// не удаляются у других. Заодно обнуляет непрочитанное. Не член → ErrNotFound.
func (i *Interactor) ClearHistory(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.tx.WithinTx(ctx, func(ctx context.Context) error {
		maxSeq, e := i.chats.MaxSeq(ctx, chatID)
		if e != nil {
			return e
		}
		if e := i.chats.SetClearedSeq(ctx, chatID, userID, maxSeq); e != nil {
			return e
		}
		// Всё «до горизонта» считается прочитанным: read-маркер и непрочитанное
		// сдвигаются к максимуму (иначе бейдж застынет на скрытых сообщениях).
		if e := i.chats.SetRead(ctx, chatID, userID, maxSeq, 0); e != nil {
			return e
		}
		// ...включая непрочитанные упоминания — иначе «@»-бейдж застынет.
		_, e = i.chats.ClearMentions(ctx, chatID, userID, maxSeq)
		return e
	})
}

// ReadReactions explicitly clears the caller's unread-reactions badge for a chat
// (Telegram readReactions — POST /chats/{chatID}/reactions/read), without
// touching the read horizon. MarkRead clears it too; this is the "read only the
// reactions" path. Not a member → domain.ErrNotFound.
func (i *Interactor) ReadReactions(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.chats.ClearUnreadReactions(ctx, chatID, userID)
}

// ReadMedia clears a voice/round message's media_unread flag when its recipient
// plays it (tweb messages.readMessageContents) and fans out a media_read frame
// to every member — the sender's "unlistened" dot goes out live. Idempotent:
// repeat plays and own messages publish nothing.
func (i *Interactor) ReadMedia(ctx context.Context, chatID, userID, msgID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if msg.ChatID != chatID || msg.SenderID == userID {
		return nil
	}
	// Упоминание зрителя в этом сообщении: прочтение содержимого гасит его
	// «непрочитано» (Telegram readMessageContents снимает media_unread
	// упомянутому) — у него одного, факт упоминания остаётся.
	if err := i.readMentionContents(ctx, chatID, userID, msg); err != nil {
		return err
	}
	if !msg.MediaUnread {
		return nil
	}
	var members []int64
	var cleared bool
	var mediaReadAddr chatAddress
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		c, e := i.msgs.ClearMediaUnread(ctx, msgID)
		if e != nil || !c {
			return e
		}
		cleared = true
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		mediaReadAddr = addr
		date := nowMillis()
		for _, uid := range members {
			payload, e := json.Marshal(mediaReadPayload(addr.forViewer(uid), msg.Seq))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "media_read", payload)
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
	if cleared && i.publisher != nil {
		for _, uid := range members {
			body := mediaReadPayload(mediaReadAddr.forViewer(uid), msg.Seq)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("media_read", body, ptsByUser[uid]))
		}
	}
	return nil
}

// readMentionContents снимает «непрочитано» с упоминания зрителя в msg и
// шлёт ЕМУ (всем его устройствам) кадр прочтения содержимого — тот же
// updateReadPeerMessagesContents, что у прослушанного голосового: клиент
// снимает pFlags.media_unread и с ним бейдж «@» (tweb
// onUpdateReadMessagesContents). Не упомянут или уже прочитано — no-op.
func (i *Interactor) readMentionContents(ctx context.Context, chatID, userID int64, msg domain.Message) error {
	var pts int64
	var addr chatAddress
	var read bool
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		r, e := i.chats.ReadMention(ctx, chatID, msg.ID, userID)
		if e != nil || !r {
			return e
		}
		read = true
		if addr, e = i.peerAddress(ctx, chatID); e != nil {
			return e
		}
		payload, e := json.Marshal(mediaReadPayload(addr.forViewer(userID), msg.Seq))
		if e != nil {
			return e
		}
		pts, e = i.updates.AppendUpdate(ctx, userID, 1, nowMillis(), "media_read", payload)
		return e
	})
	if err != nil || !read {
		return err
	}
	if i.dialogsCache != nil {
		i.dialogsCache.Invalidate(ctx, userID)
	}
	if i.publisher != nil {
		body := mediaReadPayload(addr.forViewer(userID), msg.Seq)
		_ = i.publisher.PublishToUser(ctx, userID, framePts("media_read", body, pts))
	}
	return nil
}

// checkPrivateSendPrivacy применяет к отправке в приватный и в секретный чат
// правила получателя «кто может отправлять мне сообщения/голосовые» и чёрный
// список (заблокированный отправитель получает message_error reason=privacy).
// Удалённому аккаунту не пишут вовсе (Telegram INPUT_USER_DEACTIVATED).
func (i *Interactor) checkPrivateSendPrivacy(ctx context.Context, in SendInput) error {
	typ, err := i.chats.ChatType(ctx, in.ChatID)
	if err != nil {
		return err
	}
	if typ != domain.ChatTypePrivate && typ != domain.ChatTypeSecret {
		return nil
	}
	members, err := i.chats.MemberIDs(ctx, in.ChatID)
	if err != nil {
		return err
	}
	var peer int64
	for _, id := range members {
		if id != in.SenderID {
			peer = id
		}
	}
	if peer == 0 { // «Избранное»/self — ограничений нет
		return nil
	}
	if i.userCard(ctx, peer).Deleted() {
		return domain.ErrForbidden
	}
	if i.privacy == nil {
		return nil
	}
	keys := []domain.PrivacyKey{domain.PrivacyMessages}
	if in.Type == "voice" || in.Type == "roundVideo" {
		keys = append(keys, domain.PrivacyVoices)
	}
	for _, key := range keys {
		ok, err := i.privacy.Check(ctx, peer, in.SenderID, key)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrPrivacy
		}
	}
	return nil
}

// Typing publishes an ephemeral typing indicator to the other chat members.
// No DB write. No-op if the user isn't a member or no publisher is attached.
//
// Действие приходит КОНСТРУКТОРОМ объединения SendMessageAction: белый список
// значений здесь больше не нужен — разбор с провода и есть единственное место,
// где неизвестное сводится к обычной печати (domain.SendMessageActionByTag).
func (i *Interactor) Typing(ctx context.Context, chatID, userID int64, action domain.SendMessageAction) error {
	if i.publisher == nil {
		return nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil || !ok {
		return err
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return err
	}
	// Тело одно на всех: адрес кадр несёт САМ (конструктором), пер-зрительского
	// в нём ничего нет — поэтому и развёртки по ключам пира здесь больше нет.
	body := frame("typing", typingPayload(addr, userID, action))
	for _, uid := range members {
		if uid == userID {
			continue
		}
		_ = i.publisher.PublishToUser(ctx, uid, body)
	}
	return nil
}

// quoteOffset — где цитата q стоит в тексте оригинала, в единицах UTF-16 (так
// считает offset схема, inputReplyToMessage.quote_offset). Сперва — по
// присланному offset; не совпало (клиент выделил тот же фрагмент, но посчитал
// сдвиг иначе) — первое вхождение. Нет вхождения — цитата не из оригинала.
func quoteOffset(text, q string, hint *int) (int, bool) {
	t := utf16.Encode([]rune(text))
	u := utf16.Encode([]rune(q))
	if hint != nil && *hint >= 0 && *hint+len(u) <= len(t) && slices.Equal(t[*hint:*hint+len(u)], u) {
		return *hint, true
	}
	for at := 0; at+len(u) <= len(t); at++ {
		if slices.Equal(t[at:at+len(u)], u) {
			return at, true
		}
	}
	return 0, false
}
