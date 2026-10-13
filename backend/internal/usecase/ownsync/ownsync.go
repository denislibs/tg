// Package ownsync — запись «своих» мутаций в пер-юзерный журнал апдейтов и
// живой кадр на устройства получателей.
//
// Один путь для всех, кто меняет настройки владельца вне usecase/chat
// (уведомления, приватность, стикеры, теги, карточка контакта): строка
// журнала с плотным pts (её отдаёт getDifference) и кадр {t, d, pts},
// несущий тот же курсор.
package ownsync

import (
	"context"
	"encoding/json"
	"errors"
	"log"
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

// batchPublisher — необязательное расширение издателя (rtredis.RedisPublisher):
// кадры N получателей одним конвейером Redis вместо N подряд идущих PUBLISH.
type batchPublisher interface {
	PublishToUsers(ctx context.Context, userIDs []int64, frames [][]byte) error
}

// ErrBodyWithoutConstructor — у тела нет дискриминатора `_`. Без него
// foldJournal подставил бы дискриминатором тип строки журнала, а курсор лёг бы
// в тело не по схеме: потребитель обязан отдавать конструктор TL.
var ErrBodyWithoutConstructor = errors.New("ownsync: body without constructor \"_\"")

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
	if tag, ok := body["_"].(string); !ok || tag == "" {
		return ErrBodyWithoutConstructor
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
	e.publishAll(ctx, ids, typ, body, ptsByUser)
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
//
// build обязан читать состояние ЧЕРЕЗ ctx, который ему передан (репозитории
// берут транзакцию из него) и не писать в журнал: pts поднимется дважды, а в
// транзакции с замком лишняя запись удлиняет его. EmitSnapshot зовут ВНЕ чужой
// транзакции: WithinTx не присоединяется к внешней, и вложенный вызов при
// уже взятом замке владельца ждал бы собственную внешнюю транзакцию. Тело —
// конструктор TL с `_` (ErrBodyWithoutConstructor).
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
		if tag, ok := b["_"].(string); !ok || tag == "" {
			return ErrBodyWithoutConstructor
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
	e.publishAll(ctx, []int64{userID}, typ, body, map[int64]int64{userID: pts})
	return nil
}

// publishAll — живые кадры получателям. Курсор в конверте (конструктор без
// параметра pts): тело и ссылки на пиров считаются один раз, на получателя
// меняется только курсор. Курсор в теле (конструктор с pts): тело у каждого своё. Ошибка публикации не
// теряет апдейт: строка уже в журнале, клиент догонит её через getDifference —
// но потерю кадров видно в логе.
func (e *Emitter) publishAll(ctx context.Context, ids []int64, typ string, body map[string]any, ptsByUser map[int64]int64) {
	if e.pub == nil {
		return
	}
	shared, err := newSharedFrame(typ, body)
	if err != nil {
		log.Printf("ownsync: frame %s: %v", typ, err)
		return
	}
	userIDs := make([]int64, 0, len(ids))
	frames := make([][]byte, 0, len(ids))
	for _, uid := range ids {
		f := shared.forUser(ptsByUser[uid])
		if f == nil {
			continue
		}
		userIDs = append(userIDs, uid)
		frames = append(frames, f)
	}
	if bp, ok := e.pub.(batchPublisher); ok {
		if err := bp.PublishToUsers(ctx, userIDs, frames); err != nil {
			log.Printf("ownsync: publish %s users=%d: %v", typ, len(userIDs), err)
		}
		return
	}
	for i, uid := range userIDs {
		if err := e.pub.PublishToUser(ctx, uid, frames[i]); err != nil {
			log.Printf("ownsync: publish %s user=%d: %v", typ, uid, err)
		}
	}
}

// sharedFrame — часть кадра, одинаковая у всех получателей.
type sharedFrame struct {
	typ  string
	body map[string]any
	// Курсор в конверте (у конструктора нет параметра pts): тело и ссылки на
	// пиров маршалятся один раз.
	envelope bool
	raw      json.RawMessage
	refs     *domain.PeerRefs
}

func newSharedFrame(typ string, body map[string]any) (*sharedFrame, error) {
	sf := &sharedFrame{typ: typ, body: body}
	tag, _ := body["_"].(string)
	if domain.UpdateDeclaresPts(tag) {
		return sf, nil // курсор в теле: тело у каждого своё
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	sf.envelope, sf.raw = true, raw
	if refs := domain.CollectPeerRefsJSON(raw); !refs.Empty() {
		sf.refs = &refs
	}
	return sf, nil
}

// forUser — кадр {t, d, pts} с курсором получателя. Курсор едет в теле у
// конструктора с параметром pts, у остальных — в конверте (своего pts у них в
// схеме нет). Конверт несёт ссылки тела на пиров (domain.FrameRefsKey): по ним
// соединение доклеивает карточки.
func (sf *sharedFrame) forUser(pts int64) []byte {
	if sf.envelope {
		env := map[string]any{"t": sf.typ, "pts": pts, "d": sf.raw}
		if sf.refs != nil {
			env[domain.FrameRefsKey] = *sf.refs
		}
		out, err := json.Marshal(env)
		if err != nil {
			return nil
		}
		return out
	}
	d := make(map[string]any, len(sf.body)+1)
	for k, v := range sf.body {
		d[k] = v
	}
	d["pts"] = pts
	raw, err := json.Marshal(d)
	if err != nil {
		return nil
	}
	env := map[string]any{"t": sf.typ, "d": json.RawMessage(raw)}
	if refs := domain.CollectPeerRefsJSON(raw); !refs.Empty() {
		env[domain.FrameRefsKey] = refs
	}
	out, err := json.Marshal(env)
	if err != nil {
		return nil
	}
	return out
}
