// Package ownsync — запись «своих» мутаций в пер-юзерный журнал апдейтов и
// живой кадр на устройства получателей.
//
// Один путь для всех, кто меняет настройки владельца вне usecase/chat
// (уведомления, приватность, стикеры, теги, карточка контакта): строка
// журнала с плотным pts (её отдаёт getDifference) и кадр {t, d, pts},
// несущий тот же курсор.
package ownsync

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Log — пер-юзерный журнал (реализация: pgadapter.UpdatesRepo).
type Log interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
	AppendUpdateBulk(ctx context.Context, userIDs []int64, ptsCount int, date int64, typ string, payload json.RawMessage) (map[int64]int64, error)
	// LockState берёт блокировку строки курсора владельца (user_state) до конца
	// транзакции; строку при отсутствии создаёт. Зовётся только внутри TxManager.
	LockState(ctx context.Context, userID int64) error
}

// Publisher — живой кадр (реализация: rtredis.RedisPublisher).
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// TxManager — тот же контракт, что у folders (реализация: pgadapter.TxManager).
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// Emitter пишет журнал и шлёт кадры. Нулевые порты допустимы: без log не делает
// ничего, без pub только пишет, без tx EmitSnapshot работает как Emit одному
// получателю (build → AppendUpdate без блокировки).
type Emitter struct {
	log Log
	pub Publisher
	tx  TxManager
}

// New — nil-безопасный конструктор. Вызывающий передаёт именно nil-интерфейс, а
// не типизированный nil (`var pub Publisher; if p != nil { pub = p }`).
func New(log Log, pub Publisher, tx TxManager) *Emitter {
	return &Emitter{log: log, pub: pub, tx: tx}
}

// Emit — одна строка журнала на каждого получателя (одно тело на всех), затем
// кадр {t: typ, d: body, pts} каждому. pts лежит в теле, если конструктор
// (body["_"]) его объявляет (domain.UpdateDeclaresPts), иначе — в конверте.
//
// Получатели проходят дедуп и сортировку по возрастанию ДО записи: дубль id
// валит INSERT … ON CONFLICT DO UPDATE ("cannot affect row a second time"), а
// разный порядок двух параллельных пачек даёт взаимную блокировку на user_state.
//
// Зовётся ПОСЛЕ коммита мутации, вне её транзакции. Ошибку журнала возвращает —
// вызывающий её логирует, ответ клиенту остаётся успешным.
func (e *Emitter) Emit(ctx context.Context, userIDs []int64, typ string, body map[string]any) error {
	if e == nil || e.log == nil || len(userIDs) == 0 {
		return nil
	}
	ids := slices.Clone(userIDs)
	slices.Sort(ids)
	ids = slices.Compact(ids)

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	ptsByUser, err := e.log.AppendUpdateBulk(ctx, ids, 1, time.Now().Unix(), typ, payload)
	if err != nil {
		return err
	}
	for _, uid := range ids {
		e.publish(ctx, uid, typ, body, ptsByUser[uid])
	}
	return nil
}

// EmitSnapshot — для тел-снимков ОДНОМУ владельцу (его же устройства). В одной
// транзакции: LockState → build перечитывает текущее состояние → AppendUpdate.
// Публикация — после коммита.
//
// Снимок нельзя собирать до записи без блокировки: с двух устройств снимки
// легли бы в журнал в обратном порядке (A перечитал → B записал и выпустил
// pts 11 → A выпустил pts 12 со старым состоянием). Перечитывание после
// блокировки гарантирует: у большего pts состояние не старее. Саму мутацию в
// эту транзакцию класть не нужно — она закоммичена раньше.
func (e *Emitter) EmitSnapshot(ctx context.Context, userID int64, typ string,
	build func(ctx context.Context) (map[string]any, error)) error {
	if e == nil || e.log == nil {
		return nil
	}
	var (
		body map[string]any
		pts  int64
	)
	run := func(ctx context.Context) error {
		if e.tx != nil {
			if err := e.log.LockState(ctx, userID); err != nil {
				return err
			}
		}
		b, err := build(ctx)
		if err != nil {
			return err
		}
		payload, err := json.Marshal(b)
		if err != nil {
			return err
		}
		p, err := e.log.AppendUpdate(ctx, userID, 1, time.Now().Unix(), typ, payload)
		if err != nil {
			return err
		}
		body, pts = b, p
		return nil
	}
	var err error
	if e.tx != nil {
		err = e.tx.WithinTx(ctx, run)
	} else {
		err = run(ctx)
	}
	if err != nil {
		return err
	}
	e.publish(ctx, userID, typ, body, pts)
	return nil
}

func (e *Emitter) publish(ctx context.Context, userID int64, typ string, body map[string]any, pts int64) {
	if e.pub == nil {
		return
	}
	// Ошибка публикации не теряет апдейт: строка уже в журнале, клиент догонит
	// её через getDifference.
	if f := frame(typ, body, pts); f != nil {
		_ = e.pub.PublishToUser(ctx, userID, f)
	}
}

// frame — {t, d, pts}. Курсор едет в теле у конструктора с параметром pts, у
// остальных — в конверте (своего pts у них в схеме нет). Конверт несёт ссылки
// тела на пиров (domain.FrameRefsKey): по ним соединение доклеивает карточки.
func frame(typ string, body map[string]any, pts int64) []byte {
	env := map[string]any{"t": typ}
	d := body
	if tag, ok := body["_"].(string); ok && !domain.UpdateDeclaresPts(tag) {
		env["pts"] = pts
	} else {
		d = make(map[string]any, len(body)+1)
		for k, v := range body {
			d[k] = v
		}
		d["pts"] = pts
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return nil
	}
	env["d"] = json.RawMessage(raw)
	if bytes.Contains(raw, []byte(`"_":`)) {
		if refs := domain.CollectPeerRefsJSON(raw); !refs.Empty() {
			env[domain.FrameRefsKey] = refs
		}
	}
	out, err := json.Marshal(env)
	if err != nil {
		return nil
	}
	return out
}
