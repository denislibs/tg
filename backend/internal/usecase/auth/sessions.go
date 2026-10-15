package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

func (i *Interactor) ListSessions(ctx context.Context, userID int64) ([]domain.Device, error) {
	return i.devices.ListByUser(ctx, userID)
}

// RevokeSession удаляет сессию (выход самой сессии, завершение чужой). Если она
// была неподтверждённой, остальные устройства получают updateNewAuthorization
// без флага — запрос «это вы?» о ней снимается, кто бы её ни закрыл.
func (i *Interactor) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	d, found, err := i.devices.Delete(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	i.evict(ctx, d)
	i.emitPromptsRemoved(ctx, userID, []domain.Device{d})
	return true, nil
}

// evict выбрасывает удалённую сессию из кэша и закрывает её сокеты.
func (i *Interactor) evict(ctx context.Context, d domain.Device) {
	if i.cache != nil {
		_ = i.cache.DelSession(ctx, d.TokenHash)
	}
	if i.revoker != nil {
		_ = i.revoker.NotifyRevoked(ctx, d.ID)
	}
}

// revokeOtherSessions terminates every session of the user except the current
// one ("Terminate All Other Sessions"): rows are deleted, cached sessions
// evicted and each device's sockets closed. Returns how many were revoked.
// Запросы «это вы?» об удалённых неподтверждённых сессиях снимаются.
func (i *Interactor) revokeOtherSessions(ctx context.Context, userID, currentDeviceID int64) (int, error) {
	removed, err := i.devices.DeleteOthers(ctx, userID, currentDeviceID)
	if err != nil {
		return 0, err
	}
	for _, d := range removed {
		i.evict(ctx, d)
	}
	i.emitPromptsRemoved(ctx, userID, removed)
	return len(removed), nil
}

// ownSyncTimeout — срок записи строки «новый вход» в журнал после коммита
// мутации: запрос клиента могут закрыть, а строка всё равно нужна.
const ownSyncTimeout = 10 * time.Second

// newAuthorizationRow — тип строки журнала updateNewAuthorization.
const newAuthorizationRow = "new_authorization"

// emitOwnSessions пишет строку журнала и шлёт кадр всем устройствам владельца
// (общий путь ownsync). Мутация уже закоммичена: ошибка только в лог, вход или
// завершение сессии остаются успешными.
func (i *Interactor) emitOwnSessions(ctx context.Context, userID int64, u domain.UpdateNewAuthorization) {
	if i.emit == nil {
		return
	}
	raw, err := json.Marshal(u)
	if err != nil {
		i.logf("ownsync: %s user=%d: %v", newAuthorizationRow, userID, err)
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		i.logf("ownsync: %s user=%d: %v", newAuthorizationRow, userID, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), ownSyncTimeout)
	defer cancel()
	if err := i.emit.Emit(ctx, []int64{userID}, newAuthorizationRow, body); err != nil {
		i.logf("ownsync: %s user=%d: %v", newAuthorizationRow, userID, err)
	}
}

// emitPromptsRemoved снимает запросы «это вы?» об удалённых сессиях: по строке
// updateNewAuthorization без unconfirmed на каждую удалённую неподтверждённую
// (так приходят и update* Telegram; таких удалений единицы). Строки, у которых
// флаг уже погас по сроку, не трогаются — клиент их отбросил сам.
func (i *Interactor) emitPromptsRemoved(ctx context.Context, userID int64, removed []domain.Device) {
	now := i.now()
	for _, d := range removed {
		if d.IsUnconfirmed(now) {
			i.emitOwnSessions(ctx, userID, domain.NewUpdateNewAuthorizationRemoved(d.ID))
		}
	}
}

// IsFreshSession — текущая сессия моложе FreshAuthorizationPeriod (строго
// «больше», tweb appAccountManager.ts:220-223: date + PERIOD > now). Сравнение
// в целых секундах, как у tweb (date_created и tsNow(true) — секунды). Нет строки
// текущей сессии — domain.ErrNoCurrentSession.
func (i *Interactor) IsFreshSession(ctx context.Context, userID, currentDeviceID int64) (bool, error) {
	d, err := i.devices.Get(ctx, userID, currentDeviceID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, domain.ErrNoCurrentSession
	}
	if err != nil {
		return false, err
	}
	return d.CreatedAt.Unix()+int64(domain.FreshAuthorizationPeriod/time.Second) > i.now().Unix(), nil
}

// TerminateSession — завершение ЧУЖОЙ сессии из списка устройств
// (account.resetAuthorization). Порядок проверок: свежая текущая →
// ErrFreshAuthorization; потом своя сессия → ErrInvalid; потом удаление
// (false — цели нет).
//
// Своя сессия по этому пути не отзывается — ни нулём (адрес текущей строки
// витрины), ни угаданным настоящим id. У оригинала такой возможности нет по
// построению: адреса у текущей авторизации не существует, для неё есть выход
// из аккаунта (RevokeSession). У нас адрес есть, поэтому отказ явный — иначе
// выходил бы «половинный логаут»: сессия умирает на сервере, а вкладка держит
// мёртвый токен до ближайшего 401.
func (i *Interactor) TerminateSession(ctx context.Context, userID, currentDeviceID, targetID int64) (bool, error) {
	fresh, err := i.IsFreshSession(ctx, userID, currentDeviceID)
	if err != nil {
		return false, err
	}
	if fresh {
		return false, domain.ErrFreshAuthorization
	}
	if targetID == 0 || targetID == currentDeviceID {
		return false, domain.ErrInvalid
	}
	return i.RevokeSession(ctx, userID, targetID)
}

// TerminateOtherSessions — «завершить все прочие» (auth.resetAuthorizations):
// то же правило свежести, без особых случаев (прочих сессий нет — всё равно
// отказ), затем revokeOtherSessions.
func (i *Interactor) TerminateOtherSessions(ctx context.Context, userID, currentDeviceID int64) (int, error) {
	fresh, err := i.IsFreshSession(ctx, userID, currentDeviceID)
	if err != nil {
		return 0, err
	}
	if fresh {
		return 0, domain.ErrFreshAuthorization
	}
	return i.revokeOtherSessions(ctx, userID, currentDeviceID)
}

// ConfirmSession — «Да, это я» (account.changeAuthorizationSettings{confirmed}):
// снимает флаг unconfirmed с чужой сессии. Порядок проверок, как у
// TerminateSession: свежая текущая → ErrFreshAuthorization (tweb
// FRESH_CHANGE_AUTHORIZATION_FORBIDDEN); потом своя сессия → ErrInvalid; потом
// подтверждение (ErrNotFound — такой сессии нет). Уже подтверждённая — не
// ошибка, и кадра нет. Остальные устройства получают updateNewAuthorization без
// флага: запрос о ней снимается.
func (i *Interactor) ConfirmSession(ctx context.Context, userID, currentDeviceID, targetID int64) error {
	fresh, err := i.IsFreshSession(ctx, userID, currentDeviceID)
	if err != nil {
		return err
	}
	if fresh {
		return domain.ErrFreshAuthorization
	}
	if targetID == 0 || targetID == currentDeviceID {
		return domain.ErrInvalid
	}
	changed, err := i.devices.Confirm(ctx, userID, targetID)
	if err != nil {
		return err
	}
	if changed {
		i.emitOwnSessions(ctx, userID, domain.NewUpdateNewAuthorizationRemoved(targetID))
	}
	return nil
}
