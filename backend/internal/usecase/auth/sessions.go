package auth

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

func (i *Interactor) ListSessions(ctx context.Context, userID int64) ([]domain.Device, error) {
	return i.devices.ListByUser(ctx, userID)
}

func (i *Interactor) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := i.devices.Delete(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if i.cache != nil {
		_ = i.cache.DelSession(ctx, tokenHash)
	}
	if i.revoker != nil {
		_ = i.revoker.NotifyRevoked(ctx, deviceID)
	}
	return true, nil
}

// RevokeOtherSessions terminates every session of the user except the current
// one ("Terminate All Other Sessions"): rows are deleted, cached sessions
// evicted and each device's sockets closed. Returns how many were revoked.
func (i *Interactor) RevokeOtherSessions(ctx context.Context, userID, currentDeviceID int64) (int, error) {
	removed, err := i.devices.DeleteOthers(ctx, userID, currentDeviceID)
	if err != nil {
		return 0, err
	}
	for _, d := range removed {
		if i.cache != nil {
			_ = i.cache.DelSession(ctx, d.TokenHash)
		}
		if i.revoker != nil {
			_ = i.revoker.NotifyRevoked(ctx, d.ID)
		}
	}
	return len(removed), nil
}

// IsFreshSession — текущая сессия моложе FreshAuthorizationPeriod (строго
// «больше», tweb appAccountManager.ts:220-223: date + PERIOD > now). Нет строки
// сессии — domain.ErrNotFound.
func (i *Interactor) IsFreshSession(ctx context.Context, userID, currentDeviceID int64) (bool, error) {
	d, err := i.devices.Get(ctx, userID, currentDeviceID)
	if err != nil {
		return false, err
	}
	return d.CreatedAt.Add(domain.FreshAuthorizationPeriod).After(i.now()), nil
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
// отказ), затем RevokeOtherSessions.
func (i *Interactor) TerminateOtherSessions(ctx context.Context, userID, currentDeviceID int64) (int, error) {
	fresh, err := i.IsFreshSession(ctx, userID, currentDeviceID)
	if err != nil {
		return 0, err
	}
	if fresh {
		return 0, domain.ErrFreshAuthorization
	}
	return i.RevokeOtherSessions(ctx, userID, currentDeviceID)
}
