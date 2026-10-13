// Package notify — глобальные настройки уведомлений пользователя по типу чатов
// (notifyUsers / notifyChats / notifyBroadcasts: срок мьюта и показ превью).
package notify

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// Repo хранит настройки; Get возвращает domain.ErrNotFound, если пользователь
// ещё ничего не менял (тогда действуют дефолты).
type Repo interface {
	Get(ctx context.Context, userID int64) (domain.NotifySettings, error)
	// PatchType меняет только переданные поля ОДНОГО типа чатов одним
	// выражением: параллельные правки разных типов не затирают друг друга, как
	// затёрло бы «прочитать всю строку → записать целиком».
	PatchType(ctx context.Context, userID int64, t domain.NotifyType, muted, preview *bool) error
}

type Interactor struct {
	repo Repo
	emit *ownsync.Emitter
	now  func() time.Time
}

func New(repo Repo) *Interactor { return &Interactor{repo: repo, now: time.Now} }

// SetEmitter подключает журнал своих устройств; без него мутация проходит, но
// второе устройство о ней не узнаёт.
func (i *Interactor) SetEmitter(e *ownsync.Emitter) { i.emit = e }

// settings возвращает настройки пользователя (дефолты, если не сохранялись).
func (i *Interactor) settings(ctx context.Context, userID int64) (domain.NotifySettings, error) {
	s, err := i.repo.Get(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.DefaultNotifySettings(), nil
	}
	return s, err
}

// Get — account.getNotifySettings для типа: peerNotifySettings с явным сроком
// мьюта и показом превью.
func (i *Interactor) Get(ctx context.Context, userID int64, t domain.NotifyType) (domain.PeerNotifySettings, error) {
	s, err := i.settings(ctx, userID)
	if err != nil {
		return domain.PeerNotifySettings{}, err
	}
	return s.ForType(t).PeerNotifySettings(), nil
}

// Update — account.updateNotifySettings для типа. Переданные поля накладываются
// на текущие; mute_until в будущем хранится как «навсегда» (хранилище булево),
// в прошлом или 0 — «включено». После записи своим устройствам уходит строка
// журнала notify_settings со СНИМКОМ, перечитанным под блокировкой журнала.
func (i *Interactor) Update(ctx context.Context, userID int64, t domain.NotifyType, in domain.InputPeerNotifySettings) error {
	var muted *bool
	if in.MuteUntil != nil {
		m := *in.MuteUntil > i.now().Unix()
		muted = &m
	}
	if muted == nil && in.ShowPreviews == nil {
		return nil // пустое тело: менять нечего, журнал не раздуваем
	}
	if err := i.repo.PatchType(ctx, userID, t, muted, in.ShowPreviews); err != nil {
		return err
	}
	// Мутация закоммичена: сбой журнала ответ не портит (клиент получит
	// результат ответом, второе устройство — при следующей синхронизации).
	err := i.emit.EmitSnapshot(ctx, userID, "notify_settings", func(ctx context.Context) (map[string]any, error) {
		s, err := i.Get(ctx, userID, t)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"_":               domain.UpdateNotifySettingsTag,
			"peer":            domain.NotifyTypePeer(t),
			"notify_settings": s,
		}, nil
	})
	if err != nil {
		log.Printf("ownsync: notify_settings user=%d: %v", userID, err)
	}
	return nil
}
