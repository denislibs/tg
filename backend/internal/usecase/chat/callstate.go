package chat

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Состояние звонка в карточке чата (VA2-03, A4-13).
//
// Оригинал показывает идущий видеочат или эфир флагами channel.call_active и
// call_not_empty (tweb dialogs.ts:758-759 — иконка в строке списка,
// topbar.ts:356/:386 — кнопки шапки, topbarGroupCall/container.tsx:38-41 и
// topbarLive/container.tsx:44-45 — плашки). У нас звонок — эфемерное состояние:
// участники в Redis (GroupCallStore), эфир в livestreams. Поэтому флаги не
// колонка, а ЗАПРОС на сборке: FillCallState заполняет ChatRecord.Call перед
// каждым ToChannel.
//
// Клиент заменяет лежащий полный channel целиком вместе с pFlags
// (peersManager.mergeApiChat), так что любой вектор chats, собранный без
// флагов, погасил бы иконку при идущем звонке. Поэтому правило одно: перед
// ToChannel — FillCallState (или callsAmong для строк списка).

const (
	// callSnapshotWindow — не чаще одного снимка чата за это окно: снимок
	// chat_update мегагруппы это O(участников) строк журнала, а вход/выход из
	// звонка может мигать.
	callSnapshotWindow = 5 * time.Second
	// callSnapshotLease — срок аренды отложенного снимка: упавшая реплика
	// оставляет запись, и через это время её подбирает любая.
	callSnapshotLease = 30 * time.Second
	// callFlushBatch — сколько отложенных снимков тик берёт за раз.
	callFlushBatch = 100
)

func (i *Interactor) callClock() time.Time {
	if i.callNow != nil {
		return i.callNow()
	}
	return time.Now()
}

// callsAmong — множество чатов среди ids, где идёт звонок или эфир. Один
// Redis-pipeline и один SQL на пачку. При сбое источника ошибка возвращается
// вместе с тем, что удалось узнать: «не знаем» и «звонка нет» — разные ответы.
func (i *Interactor) callsAmong(ctx context.Context, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	var firstErr error
	if i.groupCalls != nil {
		active, err := i.groupCalls.ActiveAmong(ctx, ids)
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("состояние видеочатов: %w", err)
		}
		for id := range active {
			out[id] = true
		}
	}
	if i.livestreams != nil {
		active, err := i.livestreams.ActiveAmong(ctx, ids)
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("состояние эфиров: %w", err)
		}
		for id := range active {
			out[id] = true
		}
	}
	return out, firstErr
}

// callsAmongSoft — callsAmong для выдачи (список, история, карточка): сбой
// источника не роняет ответ, чат отдаётся без флагов и поправится со следующей
// выдачей. В журнал так писать нельзя — см. fillCallStateStrict.
func (i *Interactor) callsAmongSoft(ctx context.Context, ids []int64) map[int64]bool {
	out, err := i.callsAmong(ctx, ids)
	if err != nil {
		log.Printf("chat: %v", err)
	}
	return out
}

// hasChannelBody — у вида чата есть тело `channel` (группа и канал; у личного
// чата и «Избранного» пир это человек).
func hasChannelBody(chatType string) bool {
	return chatType == domain.ChatTypeGroup || chatType == domain.ChatTypeChannel
}

// FillCallState заполняет recs[k].Call: идёт ли в чате видеочат или эфир. Звать
// перед ToChannel на каждой записи, которая уйдёт полным channel. Чат,
// нечитаемый зрителю (Hidden), уходит честным min без состояния звонка — его не
// спрашиваем.
func (i *Interactor) FillCallState(ctx context.Context, recs []domain.ChatRecord) {
	if err := i.fillCallStateStrict(ctx, recs); err != nil {
		log.Printf("chat: %v", err)
	}
}

// fillCallStateStrict — FillCallState с ошибкой, для снимков, которые уйдут в
// журнал: сбой источника звонков — ошибка, а не «звонка нет». Абсолютный снимок
// без флагов лёг бы всем участникам и при догонке погасил бы иконку идущего звонка.
func (i *Interactor) fillCallStateStrict(ctx context.Context, recs []domain.ChatRecord) error {
	if i.groupCalls == nil && i.livestreams == nil {
		return nil
	}
	ids := make([]int64, 0, len(recs))
	for _, c := range recs {
		if hasChannelBody(c.Type) && !(c.Hidden && c.ViewerID != 0) {
			ids = append(ids, c.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	active, err := i.callsAmong(ctx, ids)
	for k := range recs {
		recs[k].Call = domain.ActiveCall(active[recs[k].ID])
	}
	return err
}

// callsOfDialogs — состояние звонков для строк списка одной пачкой.
func (i *Interactor) callsOfDialogs(ctx context.Context, recs []domain.DialogRecord) map[int64]bool {
	ids := make([]int64, 0, len(recs))
	for _, d := range recs {
		if hasChannelBody(d.Type) {
			ids = append(ids, d.ChatID)
		}
	}
	return i.callsAmongSoft(ctx, ids)
}

// announceCallChange — состояние звонка чата сменилось (вошёл первый участник,
// вышел последний, эфир начат или окончен): разослать снимок chat_update, но не
// чаще раза в callSnapshotWindow на чат.
//
// Окно свободно — снимок уходит сразу (в фоне: на мегагруппе это O(участников)
// строк журнала, а выход из звонка при обрыве WS и вход не ждут). Занято —
// снимок откладывается записью в сторе, и итог публикует тик
// FlushDirtyCallSnapshots любой реплики, в том числе после рестарта. Снимок
// всегда собирается из состояния на момент публикации, поэтому цикл
// «вошёл/вышел» даёт не больше двух снимков, и последний верен.
func (i *Interactor) announceCallChange(ctx context.Context, chatID int64) {
	publish := func() {
		i.goBG("chat.callSnapshot", func(bg context.Context) {
			if err := i.publishCallSnapshot(bg, chatID); err != nil {
				log.Printf("chat %d: снимок звонка: %v", chatID, err)
			}
		})
	}
	if i.groupCalls == nil {
		publish() // звонков нет, эфир без ограничителя
		return
	}
	bg := context.WithoutCancel(ctx) // Leave при обрыве WS приходит с отменённым ctx
	free, err := i.groupCalls.ClaimSnapshot(bg, chatID, callSnapshotWindow)
	if err != nil {
		log.Printf("chat %d: окно снимка звонка: %v", chatID, err)
		free = true // лучше лишний снимок, чем потерянный
	}
	if free {
		publish()
		return
	}
	if err := i.groupCalls.MarkSnapshotDirty(bg, chatID, i.callClock().Add(callSnapshotWindow)); err != nil {
		log.Printf("chat %d: отложенный снимок звонка: %v", chatID, err)
	}
}

// publishCallSnapshot — снимок по переходу звонка с проверкой результата.
// Публикации одного чата ничем не упорядочены (долгий снимок мегагруппы может
// лечь в журнал ПОСЛЕ более свежего), поэтому после публикации состояние
// читается заново: разошлось с опубликованным или публикация не удалась —
// исправляющий снимок откладывается (resnapshotLater), и последним в журнале
// остаётся верный. Снимок при неизвестном состоянии не публикуется (strict).
func (i *Interactor) publishCallSnapshot(ctx context.Context, chatID int64) error {
	published, _, err := i.publishChatSnapshot(ctx, chatID, true)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) { // удалённый чат снимка не ждёт
			i.resnapshotLater(ctx, chatID)
		}
		return err
	}
	now, err := i.callsAmong(ctx, []int64{chatID})
	if err != nil || now[chatID] != published {
		i.resnapshotLater(ctx, chatID)
	}
	return nil
}

// resnapshotLater откладывает ещё один снимок чата на окно вперёд (тик любой
// реплики его подхватит). Без Redis очереди нет.
func (i *Interactor) resnapshotLater(ctx context.Context, chatID int64) {
	if i.groupCalls == nil {
		return
	}
	if err := i.groupCalls.MarkSnapshotDirty(context.WithoutCancel(ctx), chatID, i.callClock().Add(callSnapshotWindow)); err != nil {
		log.Printf("chat %d: отложенный снимок звонка: %v", chatID, err)
	}
}

// FlushDirtyCallSnapshots публикует отложенные снимки, чей срок наступил:
// зовётся тикером каждой реплики раз в секунду. Запись берётся в аренду
// (LeaseDirtySnapshots) и закрывается после успешной публикации; реплика,
// упавшая до публикации, оставляет запись, и она вернётся после аренды.
// Возвращает число опубликованных снимков.
func (i *Interactor) FlushDirtyCallSnapshots(ctx context.Context) (int, error) {
	if i.groupCalls == nil {
		return 0, nil
	}
	now := i.callClock()
	lease := now.Add(callSnapshotLease)
	ids, err := i.groupCalls.LeaseDirtySnapshots(ctx, now, lease, callFlushBatch)
	if err != nil {
		return 0, err
	}
	published := 0
	for _, chatID := range ids {
		pubErr := i.publishCallSnapshot(ctx, chatID)
		if pubErr != nil && !errors.Is(pubErr, domain.ErrNotFound) { // удалённый чат снимка не ждёт
			log.Printf("chat %d: отложенный снимок звонка: %v", chatID, pubErr)
			continue // аренда истечёт — запись подберёт следующий тик
		}
		if err := i.groupCalls.FinishDirtySnapshot(ctx, chatID, lease, callSnapshotWindow); err != nil {
			log.Printf("chat %d: закрытие отложенного снимка звонка: %v", chatID, err)
			continue
		}
		if pubErr == nil {
			published++
		}
	}
	return published, nil
}
