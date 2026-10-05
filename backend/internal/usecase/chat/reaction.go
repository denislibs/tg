package chat

import (
	"context"
	"encoding/json"
	"slices"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Сколько реакций ставит ОДИН пользователь на ОДНО сообщение. В оригинале это
// не константа: значение приезжает конфигурацией приложения (help.getAppConfig,
// ключи `reactions_user_max_default` / `reactions_user_max_premium` —
// tweb src/lib/appManagers/apiManagerMethods.ts:369-395, строка :375), и клиент
// читает её через `getLimit('reactions')`. Ручки appConfig у нас нет вовсе,
// поэтому здесь зашиты дефолтные значения Telegram; когда ручка появится,
// лимит должен приехать из неё, а не отсюда.
//
// Тот же лимит и с теми же числами держит фронт
// (web-client/src/core/reactions/messageReactions.ts) — сервер здесь источник
// истины, потому что прямой POST мимо клиента иначе обходит правило.
//
// ЭТИ ЖЕ ЧИСЛА ЛИТЕРАЛАМИ ЛЕЖАТ В МИГРАЦИИ
// internal/store/postgres/migrations/0130_reactions_user_limit.sql (`CASE WHEN
// u.is_premium THEN 3 ELSE 1 END`). Свести в одно место нельзя: миграция —
// статический SQL, goose применяет её без участия кода. Когда лимит переедет в
// конфигурацию (help.getAppConfig), константы отсюда исчезнут, а числа в 0130
// останутся описанием уже применённой однажды чистки и меняться не должны; в
// миграции стоит встречная пометка.
const (
	reactionsUserMaxDefault = 1
	reactionsUserMaxPremium = 3
)

// React adds or removes a user's reaction to a message in a chat, then appends a
// reaction update to every member and publishes it live. The chatID must match
// the message's chat and the user must be a member.
func (i *Interactor) React(ctx context.Context, chatID, messageID, userID int64, emoji string, add bool) error {
	if emoji == "" || len(emoji) > maxEmojiLen || !utf8.ValidString(emoji) {
		return domain.ErrBadReaction
	}
	msg, err := i.msgs.GetByID(ctx, messageID)
	if err != nil {
		return err // domain.ErrNotFound if the message is gone
	}
	// Удалённое у всех — то же, что несуществующее (Telegram
	// MESSAGE_ID_INVALID): реакция на нём не ставится и не бампит бейдж.
	if msg.ChatID != chatID || msg.Deleted {
		return domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	// Невидимое зрителю (скрытая предыстория, очищенное, скрытое у себя) —
	// тоже несуществующее.
	if err := i.RequireMessagesVisible(ctx, userID, []int64{messageID}); err != nil {
		return err
	}
	// Политика реакций чата: none — запрещены, some — только из списка (снятие
	// своей реакции разрешено всегда, чтобы можно было убрать устаревшую).
	if add && i.groups != nil {
		if s, e := i.groups.Settings(ctx, chatID); e == nil {
			switch s.ReactionsMode {
			case "none":
				return domain.ErrForbidden
			case "some":
				if !slices.Contains(s.ReactionsAllowed, emoji) {
					return domain.ErrBadReaction
				}
			}
		}
	}
	// Реакция на ЧУЖОЕ сообщение — непрочитанная для его автора
	// (messagePeerReaction.pFlags.unread): из неё растёт его бейдж ❤.
	unread := userID != msg.SenderID && countsUnreadReactions(i.chatKind(ctx, chatID))

	var deliver func(context.Context)
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if add {
			// Лимит своих реакций: лишние СНИМАЮТСЯ, начиная со старейшей, и
			// снимаются молча — тоста об упёршемся лимите нет и в оригинале
			// (tweb appReactionsManager.ts:733-751).
			//
			// КРОМЕ «ИЗБРАННОГО»: реакция на сообщение самочата — это ТЕГ
			// (признак тот же, что у оригинала, `peerId === myId`: tweb
			// contextMenu.ts:1660, reactions.ts:149-156), а теги под лимит не
			// попадают — см. isSavedTag ниже.
			if !i.isSavedTag(ctx, chatID) {
				if e := i.evictExcessReactions(ctx, messageID, userID, emoji); e != nil {
					return e
				}
			}
			if e := i.reactions.Add(ctx, messageID, userID, emoji, unread); e != nil {
				return e
			}
		} else {
			if e := i.reactions.Remove(ctx, messageID, userID, emoji); e != nil {
				return e
			}
		}
		// Счётчик автора — число его СООБЩЕНИЙ с непрочитанной реакцией
		// (Telegram unread_reactions_count), а не число событий: повтор, смена
		// и снятие чужой реакции, вытеснение по лимиту пересчитывают его по
		// строкам, а не прибавляют единицу.
		if userID != msg.SenderID {
			if _, e := i.chats.RecountUnreadReactions(ctx, chatID, msg.SenderID); e != nil {
				return e
			}
		}
		d, e := i.journalReactions(ctx, chatID, msg, userID, msg.SenderID)
		deliver = d
		return e
	})
	if err != nil {
		return err
	}
	if userID != msg.SenderID {
		i.invalidateDialogs(ctx, msg.SenderID)
	}
	deliver(ctx)
	return nil
}

// countsUnreadReactions — растит ли реакция в чате этого вида бейдж ❤ автора.
// Нет в вещательном канале (реакции там анонимны, recent_reactions не едут
// вовсе) и в «Избранном» (там реакции — теги самого владельца).
func countsUnreadReactions(kind string) bool {
	return kind != domain.ChatTypeChannel && kind != domain.ChatTypeSaved
}

// journalReactions пишет в журнал каждого участника кадр реакций сообщения
// msg (внутри транзакции вызывающего) и возвращает доставку живых кадров —
// звать ПОСЛЕ коммита.
//
// Тело — АБСОЛЮТНЫЙ агрегат, и он разный у получателей. Всем — урезанный
// (`min`, без пер-зрительского). А тем, чей личный кусок в агрегате изменился
// (personal: поставивший и автор сообщения), — агрегат ИХ глазами без `min`:
// своя реакция с chosen_order у второго устройства поставившего (сервер
// Telegram отвечает автору действия полным телом) и pFlags.unread в
// recent_reactions у автора — по их смене клиент ведёт бейдж ❤ (tweb
// onUpdateMessageReactions → modifyUnreadReactions).
func (i *Interactor) journalReactions(ctx context.Context, chatID int64, msg domain.Message, personal ...int64) (func(context.Context), error) {
	common, err := i.reactionsSeenBy(ctx, chatID, msg.ID, 0)
	if err != nil {
		return nil, err
	}
	own := map[int64]domain.MessageReactions{}
	for _, uid := range personal {
		if _, done := own[uid]; done || uid == 0 {
			continue
		}
		r, e := i.reactionsSeenBy(ctx, chatID, msg.ID, uid)
		if e != nil {
			return nil, e
		}
		own[uid] = r
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return nil, err
	}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return nil, err
	}
	bodies := make(map[int64]map[string]any, len(members))
	ptsByUser := make(map[int64]int64, len(members))
	date := nowMillis()
	for _, uid := range members {
		r := common
		if o, ok := own[uid]; ok {
			r = o
		}
		body := reactionsPayload(addr.forViewer(uid), msg.Seq, r)
		payload, e := json.Marshal(body)
		if e != nil {
			return nil, e
		}
		pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "reaction", payload)
		if e != nil {
			return nil, e
		}
		bodies[uid], ptsByUser[uid] = body, pts
	}
	return func(ctx context.Context) {
		if i.publisher == nil {
			return
		}
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, framePts("reaction", bodies[uid], ptsByUser[uid]))
		}
	}, nil
}

// journalOwnReactions — кадры реакций msgs ОДНОМУ пользователю (всем его
// устройствам), агрегатом его глазами: прочтение реакций гасит pFlags.unread,
// и по этой смене остальные устройства снимают бейдж ❤ сами. Внутри
// транзакции вызывающего; доставка — после коммита.
func (i *Interactor) journalOwnReactions(ctx context.Context, chatID, userID int64, msgs []domain.Message) (func(context.Context), error) {
	if len(msgs) == 0 {
		return func(context.Context) {}, nil
	}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return nil, err
	}
	peer := addr.forViewer(userID)
	frames := make([][]byte, 0, len(msgs))
	date := nowMillis()
	for _, m := range msgs {
		r, e := i.reactionsSeenBy(ctx, chatID, m.ID, userID)
		if e != nil {
			return nil, e
		}
		body := reactionsPayload(peer, m.Seq, r)
		payload, e := json.Marshal(body)
		if e != nil {
			return nil, e
		}
		pts, e := i.updates.AppendUpdate(ctx, userID, 1, date, "reaction", payload)
		if e != nil {
			return nil, e
		}
		frames = append(frames, framePts("reaction", body, pts))
	}
	return func(ctx context.Context) {
		if i.publisher == nil {
			return
		}
		for _, f := range frames {
			_ = i.publisher.PublishToUser(ctx, userID, f)
		}
	}, nil
}

// isSavedTag — реакции ЭТОГО чата являются ТЕГАМИ «Избранного», а не реакциями.
// Признак ровно тот же, что у оригинала («сообщение в самочате»: tweb
// `message.peerId === rootScope.myId`, contextMenu.ts:1660 и
// reactions.ts:149-156). У нас самочат — чат типа `saved` с единственным
// участником, и этот участник автор всех реакций в нём, поэтому по типу чата
// строки тегов отделяются от строк реакций однозначно (таблица одна:
// adapter/repo/postgres/savedtagsrepo.go читает теги из `reactions`).
//
// ПОЧЕМУ ТЕГИ ВЫВЕДЕНЫ ИЗ-ПОД ЛИМИТА. В оригинале лимит и теги связаны
// подпиской: тег ставит ТОЛЬКО премиум — не-подписчику вместо постановки
// показывают предложение премиума (tweb contextMenu.ts:1681-1684), — и
// состояния «не-подписчик с одним тегом на заметке» там не существует. Мы
// портировали половину связки (лимит) и не портировали вторую (премиум-гейт на
// теги); применив лимит к тегам, мы получили бы поведение, которого нет ни у
// кого в оригинале: каждый новый тег молча стирает предыдущий. Долг на вторую
// половину — backend/backlogs/saved-tags-under-reactions-limit.md.
func (i *Interactor) isSavedTag(ctx context.Context, chatID int64) bool {
	return i.chatKind(ctx, chatID) == domain.ChatTypeSaved
}

// evictExcessReactions приводит набор СВОИХ реакций пользователя на сообщении к
// лимиту ПЕРЕД постановкой `emoji`: снимает самые старые, освобождая место под
// новую. Порт вытеснения из оригинала — tweb
// src/lib/appManagers/appReactionsManager.ts:733-751, ключевая строка :738
// (`unsetReactions.push(...chosenReactions.splice(limit - +(chosenReactionIdx === -1)))`):
// снимаются САМЫЕ СТАРЫЕ и молча, без ошибки вызывающему.
//
// Ставящаяся реакция из кандидатов на вытеснение исключается: повторный POST по
// уже поставленной реакции набор не увеличивает (Add идемпотентен), и снимать
// её, чтобы тут же вернуть, значило бы переставить её в конец очереди.
//
// Констрейнтом БД это не выражается: лимит зависит от users.is_premium, то есть
// от строки ДРУГОЙ таблицы, — правило держит юзкейс, а миграция
// 0130_reactions_user_limit приводит к нему уже накопленные данные.
func (i *Interactor) evictExcessReactions(ctx context.Context, messageID, userID int64, emoji string) error {
	// Пара «сообщение + пользователь» БЕРЁТСЯ ПОД ЗАМОК до чтения набора.
	// Правило здесь read-modify-write, а транзакция идёт на READ COMMITTED: два
	// одновременных клика одного пользователя по разным чипам прочитали бы
	// каждый «своих ноль» и оба вставили — у аккаунта осталось бы две реакции
	// при лимите одна. Строчной блокировки для этого мало: при пустом наборе
	// блокировать нечего (`SELECT ... FOR SHARE` не видит ещё не вставленных
	// строк), поэтому замок берётся на КЛЮЧ пары, а не на строки.
	if err := i.reactions.LockUserReactions(ctx, messageID, userID); err != nil {
		return err
	}
	mine, err := i.reactions.UserReactions(ctx, messageID, userID) // старейшие первыми
	if err != nil {
		return err
	}
	others := slices.DeleteFunc(mine, func(e string) bool { return e == emoji })
	// Премиум-репозиторий необязателен (SetPremiumRepo): без него у всех
	// базовый лимит — это же значение у Telegram и стоит для не-подписчика.
	limit := reactionsUserMaxDefault
	if i.premium != nil {
		prem, e := i.premium.IsPremium(ctx, userID)
		if e != nil {
			return e
		}
		if prem {
			limit = reactionsUserMaxPremium
		}
	}
	// После Add своих реакций станет len(others)+1, значит чужих места —
	// не больше limit-1.
	for k := 0; k < len(others)-(limit-1); k++ {
		if e := i.reactions.Remove(ctx, messageID, userID, others[k]); e != nil {
			return e
		}
	}
	return nil
}

// messageReactionsAggregate — АБСОЛЮТНЫЙ агрегат реакций сообщения в форме
// схемы: тот же конструктор messageReactions, что едет внутри самого сообщения
// (Message.reactions). Второй сборки у этого объекта нет.
//
// Собирается ЦЕЛИКОМ, обеими половинами сразу: эмодзи-чипы и платная
// ⭐-реакция (reactionPaid в том же векторе results). Половины у абсолютного
// агрегата быть не может — кадр, принёсший только свою часть, УТВЕРЖДАЕТ, что
// другой не существует, и стёр бы её у получателя. Прежде половин было ровно
// две: кадр `reaction` вёз только эмодзи, кадр `star_reaction` — только звёзды.
//
// Зрителя здесь нет намеренно: тело кадра одно на всех получателей, значит
// пер-зрительского (мой chosen_order, мой вклад звёздами) в нём нет — витрина
// кадра помечает агрегат `min` ровно поэтому.
//
// А вот ЧАТ здесь есть, и он не пер-зрительский: «виден ли список
// реагировавших» (can_see_list) — свойство чата, одинаковое для всех
// получателей кадра, и без него клиент в группе никогда не покажет аватарки
// реагировавших (tweb src/components/chat/reactions.ts:304-307).
func (i *Interactor) messageReactionsAggregate(ctx context.Context, chatID, messageID int64) (domain.MessageReactions, error) {
	return i.reactionsSeenBy(ctx, chatID, messageID, 0)
}

// reactionsSeenBy — тот же агрегат глазами зрителя viewerID: его реакции с
// chosen_order, его вклад звёздами, а если он автор — непрочитанность
// recent_reactions. viewerID 0 — без зрителя, и тогда агрегат помечен `min`:
// пер-зрительской части в нём нет.
func (i *Interactor) reactionsSeenBy(ctx context.Context, chatID, messageID, viewerID int64) (domain.MessageReactions, error) {
	byMsg, err := i.reactions.ReactionsFor(ctx, []int64{messageID}, viewerID)
	if err != nil {
		return domain.MessageReactions{}, err
	}
	kind := i.chatKind(ctx, chatID)
	canSeeList := domain.CanSeeReactionsList(kind)
	m := domain.Message{Reactions: byMsg[messageID]}
	if i.starReaction != nil {
		stars, e := i.starReaction.AggregatesFor(ctx, []int64{messageID}, viewerID)
		if e != nil {
			return domain.MessageReactions{}, e
		}
		m.StarReactionTotal = stars[messageID].Total
		m.StarReactionMine = stars[messageID].Mine
	}
	out := domain.NewMessageReactions(nil, nil)
	if r := m.WireReactions(canSeeList, domain.CanViewReactionsList(kind)); r != nil {
		out = *r
	} else {
		// Реакций не осталось. Внутри СООБЩЕНИЯ это выражается отсутствием
		// параметра, но кадр несёт агрегат ОБЯЗАТЕЛЬНЫМ параметром: «реакций
		// нет» — такое же состояние, как «есть три», и едет пустым вектором.
		out.SetCanSeeList(canSeeList)
	}
	if viewerID == 0 {
		out.MarkMin()
	}
	return out, nil
}

// chatKind — вид чата ОДНИМ вопросом для правил реакций. Неизвестен — пустая
// строка, и правила ниже отвечают на неё «нельзя»: и флаг, и право УТВЕРЖДАЮТ
// доступ, а утверждать его, не зная чата, нельзя.
func (i *Interactor) chatKind(ctx context.Context, chatID int64) string {
	if i.chats == nil {
		return ""
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return ""
	}
	return typ
}

// CanSeeReactionsList — видит ли зритель СПИСОК реагировавших в этом чате.
// Тонкая обёртка над единственным правилом (domain.CanSeeReactionsList) поверх
// вида чата: своего ответа на этот вопрос у usecase нет.
func (i *Interactor) CanSeeReactionsList(ctx context.Context, chatID int64) bool {
	return domain.CanSeeReactionsList(i.chatKind(ctx, chatID))
}

// ReactionsOf returns aggregated reaction counts for a message the user can see.
func (i *Interactor) ReactionsOf(ctx context.Context, chatID, messageID, userID int64) ([]domain.ReactionCount, error) {
	msgChat, err := i.msgs.MessageChatID(ctx, messageID)
	if err != nil {
		return nil, err
	}
	if msgChat != chatID {
		return nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	byMsg, err := i.reactions.ReactionsFor(ctx, []int64{messageID}, userID)
	if err != nil {
		return nil, err
	}
	return byMsg[messageID], nil
}

// ReactionUsers returns who reacted to a message (with which emoji) for the
// who-reacted popup. The caller must be a member of the message's chat.
func (i *Interactor) ReactionUsers(ctx context.Context, chatID, messageID, userID int64) ([]domain.ReactionUser, error) {
	msgChat, err := i.msgs.MessageChatID(ctx, messageID)
	if err != nil {
		return nil, err
	}
	if msgChat != chatID {
		return nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	// ЧЛЕНСТВА мало: список реагировавших существует не в каждом чате. В
	// вещательном канале реакции анонимны, и ручка обязана отказать — иначе
	// право остаётся разметкой (can_see_list на проводе) и не становится
	// ограничением доступа. Правило то же самое, что рисует флаг, целиком:
	// domain.CanViewReactionsList (группа И личка).
	//
	// Отказ, а не пустой список: пустой список УТВЕРЖДАЛ БЫ, что никто не
	// реагировал, — это другой ответ, и клиент нарисовал бы по нему пустой
	// попап вместо того, чтобы не открывать его вовсе.
	if !domain.CanViewReactionsList(i.chatKind(ctx, chatID)) {
		return nil, domain.ErrForbidden
	}
	return i.reactions.ReactionUsers(ctx, userID, messageID)
}

// CanAccessMedia reports whether userID may download a media object: КТО
// ВИДИТ ИСТОЧНИК, ТОТ И КАЧАЕТ — свой файл, сообщение или история, которые
// зритель видит, фото читаемого им чата (MediaAccessRepo.CanAccess), фото
// профиля, которое ему открывает правило profile_photo владельца (с блоком).
// Медиа стикеров читается всеми: наборы публичны, и стикер из неустановленного
// набора должен отрисоваться у любого получателя.
func (i *Interactor) CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	ok, err := i.mediaAccess.CanAccess(ctx, userID, mediaID)
	if err != nil {
		return false, err
	}
	if !ok {
		if ok, err = i.canSeeProfilePhoto(ctx, userID, mediaID); err != nil {
			return false, err
		}
	}
	if ok {
		// Платное медиа: даже член чата не качает байты, пока не оплатил (автор —
		// исключение, проверяется по sender_id внутри LockedMedia).
		if i.paidMedia != nil {
			locked, e := i.paidMedia.LockedMedia(ctx, userID, mediaID)
			if e != nil {
				return false, e
			}
			if locked {
				return false, nil
			}
		}
		return true, nil
	}
	// Публичные справочники: наборы стикеров и каталог реакций. Оба принадлежат
	// сервисному аккаунту и ни в одном чате не лежат, поэтому проверка выше их
	// не пропускает — а рисовать их должен каждый.
	if i.stickers != nil {
		ok, err := i.stickers.IsStickerMedia(ctx, mediaID)
		if err != nil || ok {
			return ok, err
		}
	}
	if i.reactionCat != nil {
		return i.reactionCat.IsReactionMedia(ctx, mediaID)
	}
	return false, nil
}

// canSeeProfilePhoto — файл это фото профиля (аватарка или снимок галереи)
// пользователя, чьё правило profile_photo открывает его зрителю (privacy.Check
// учитывает и блок). Тем же правилом гасится фото в карточках (gatePhotos):
// скрытое там не должно скачиваться напрямую по id медиа. Без проверки
// приватности (не подключена) фото профиля видно всем, как и в карточках.
func (i *Interactor) canSeeProfilePhoto(ctx context.Context, viewerID, mediaID int64) (bool, error) {
	owners, err := i.mediaAccess.AvatarOwners(ctx, mediaID)
	if err != nil || len(owners) == 0 {
		return false, err
	}
	if i.privacy == nil {
		return true, nil
	}
	for _, owner := range owners {
		ok, err := i.privacy.Check(ctx, owner, viewerID, domain.PrivacyProfilePhoto)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}
