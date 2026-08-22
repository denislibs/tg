package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxStarReaction ограничивает одну порцию платной ⭐-реакции (звёзд за клик/
// отправку). Накопление за несколько отправок не ограничено этим порогом.
const maxStarReaction = 10000

// starReactionTopN — сколько топ-отправителей отдаём клиенту (попап tweb).
const starReactionTopN = 3

// SendStarReaction ставит платную ⭐-реакцию: списывает count звёзд у отправителя,
// начисляет их автору сообщения, накопительно фиксирует вклад отправителя —
// транзакционно, затем рассылает новый агрегат участникам чата. Возвращает новый
// агрегат сообщения (total+mine зрителя), топ-отправителей и новый баланс отправителя.
func (i *Interactor) SendStarReaction(ctx context.Context, chatID, messageID, userID, count int64, anonymous bool) (domain.StarReactionAgg, []domain.StarReactionSender, int64, error) {
	if i.starReaction == nil || i.stars == nil {
		return domain.StarReactionAgg{}, nil, 0, domain.ErrNotFound
	}
	if count <= 0 || count > maxStarReaction {
		return domain.StarReactionAgg{}, nil, 0, domain.ErrBadReaction
	}
	msg, err := i.msgs.GetByID(ctx, messageID)
	if err != nil {
		return domain.StarReactionAgg{}, nil, 0, err // domain.ErrNotFound, если сообщения нет
	}
	if msg.ChatID != chatID {
		return domain.StarReactionAgg{}, nil, 0, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.StarReactionAgg{}, nil, 0, err
	}
	if !ok {
		return domain.StarReactionAgg{}, nil, 0, domain.ErrNotFound
	}

	var (
		agg          domain.StarReactionAgg
		members      []int64
		senderBal    int64
		authorBal    int64
		authorCredit bool
	)
	ptsByUser := map[int64]int64{}
	// Кадром платной реакции служит ТОТ ЖЕ конструктор, что у обычной:
	// updateMessageReactions с абсолютным агрегатом сообщения. Тело собирается
	// один раз в транзакции, чтобы журнал и живой кадр не разъехались.
	var aggregate domain.MessageReactions
	var reactionAddr chatAddress
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		b, e := i.stars.AddBalance(ctx, userID, -count)
		if e == domain.ErrForbidden {
			return domain.ErrPaidRequired // недостаточно звёзд
		}
		if e != nil {
			return e
		}
		senderBal = b
		// Начисляем автору сообщения. Реакция на своё сообщение — списание и
		// начисление на один баланс (нетто-ноль), поэтому автору начисляем только
		// если это не сам отправитель и автор известен.
		if msg.SenderID != 0 && msg.SenderID != userID {
			ab, e := i.stars.AddBalance(ctx, msg.SenderID, count)
			if e != nil {
				return e
			}
			authorBal, authorCredit = ab, true
		}
		mine, e := i.starReaction.Add(ctx, messageID, userID, count, anonymous)
		if e != nil {
			return e
		}
		// Свежий агрегат для рассылки/ответа берём после upsert (та же tx).
		byMsg, e := i.starReaction.AggregatesFor(ctx, []int64{messageID}, userID)
		if e != nil {
			return e
		}
		agg = byMsg[messageID]
		agg.Mine = mine // страховка: mine точно равен вкладу этого пользователя
		// Агрегат сообщения ЦЕЛИКОМ: платный чип плюс эмодзи-чипы. Отдельного
		// кадра у платной реакции нет ни в схеме, ни здесь — она второй
		// конструктор объединения Reaction в том же векторе results, и кадр,
		// принёсший только её, стёр бы у получателя обычные чипы.
		aggregate, e = i.messageReactionsAggregate(ctx, messageID)
		if e != nil {
			return e
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		members = m
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		reactionAddr = addr
		date := nowMillis()
		for _, uid := range members {
			payload, e := json.Marshal(reactionsPayload(addr.forViewer(uid), msg.Seq, aggregate))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "reaction", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return domain.StarReactionAgg{}, nil, 0, err
	}

	if i.publisher != nil {
		// Свой вклад звёздами (mine) в кадре не едет: он пер-зрительский, а тело
		// одно на всех получателей. Отправитель узнаёт его из ОТВЕТА этой же
		// ручки, остальные сохраняют собственный — агрегат помечен `min`.
		for _, uid := range members {
			body := reactionsPayload(reactionAddr.forViewer(uid), msg.Seq, aggregate)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("reaction", body, ptsByUser[uid]))
		}
	}
	i.publishBalance(ctx, userID, senderBal)
	if authorCredit {
		i.publishBalance(ctx, msg.SenderID, authorBal)
	}

	top, _ := i.starReaction.TopSenders(ctx, messageID, starReactionTopN)
	return agg, hideAnonymousSenders(top), senderBal, nil
}

// StarReactionOf возвращает агрегат платной ⭐-реакции сообщения для зрителя
// (total + личный вклад) и топ-отправителей. Зритель должен быть членом чата.
func (i *Interactor) StarReactionOf(ctx context.Context, chatID, messageID, userID int64) (domain.StarReactionAgg, []domain.StarReactionSender, error) {
	if i.starReaction == nil {
		return domain.StarReactionAgg{}, nil, domain.ErrNotFound
	}
	msgChat, err := i.msgs.MessageChatID(ctx, messageID)
	if err != nil {
		return domain.StarReactionAgg{}, nil, err
	}
	if msgChat != chatID {
		return domain.StarReactionAgg{}, nil, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.StarReactionAgg{}, nil, err
	}
	if !ok {
		return domain.StarReactionAgg{}, nil, domain.ErrNotFound
	}
	byMsg, err := i.starReaction.AggregatesFor(ctx, []int64{messageID}, userID)
	if err != nil {
		return domain.StarReactionAgg{}, nil, err
	}
	top, err := i.starReaction.TopSenders(ctx, messageID, starReactionTopN)
	if err != nil {
		return domain.StarReactionAgg{}, nil, err
	}
	return byMsg[messageID], hideAnonymousSenders(top), nil
}

// hideAnonymousSenders прячет карточку отправителя, попросившего анонимность:
// клиент рисует такого как «Anonymous» без имени/аватара (1:1 tweb).
func hideAnonymousSenders(top []domain.StarReactionSender) []domain.StarReactionSender {
	for idx := range top {
		if top[idx].Anonymous {
			// Личность стирается, но КОНСТРУКТОР остаётся валидным: голая
			// структура уехала бы на провод без дискриминатора `_`, и
			// разбирающая сторона не смогла бы понять, что это вообще такое.
			top[idx].User = domain.NewUser(0, domain.UserFlags{})
		}
	}
	return top
}

// hydrateStarReactions наполняет агрегат платной ⭐-реакции (total + вклад
// зрителя) на окне сообщений одним батч-запросом. Best-effort: реакции
// косметические, ошибка не должна ломать историю.
func (i *Interactor) hydrateStarReactions(ctx context.Context, viewerID int64, msgs []domain.Message) {
	if i.starReaction == nil {
		return
	}
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if !m.Deleted {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	byMsg, err := i.starReaction.AggregatesFor(ctx, ids, viewerID)
	if err != nil || len(byMsg) == 0 {
		return
	}
	for idx := range msgs {
		if agg, ok := byMsg[msgs[idx].ID]; ok {
			msgs[idx].StarReactionTotal = agg.Total
			msgs[idx].StarReactionMine = agg.Mine
		}
	}
}
