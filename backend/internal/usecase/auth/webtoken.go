package auth

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// WebAuthTokenTTL — время жизни одноразового веб-токена входа. Короткое: токен
// путешествует в адресной строке (#?tgWebAuthToken=…) и попадает в историю
// браузера.
const WebAuthTokenTTL = 5 * time.Minute

// NewWebAuthToken выпускает одноразовый веб-токен входа для уже авторизованного
// пользователя: другой веб-клиент обменяет его на сессию через SignImport.
// Хранится только хеш — сырой токен возвращается ровно один раз, здесь.
func (i *Interactor) NewWebAuthToken(ctx context.Context, userID int64) (token string, expiresAt time.Time, err error) {
	if i.steps == nil {
		return "", time.Time{}, ErrLoginStepsUnavailable
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt = time.Now().Add(WebAuthTokenTTL)
	if err := i.steps.SaveWebAuthToken(ctx, hash, userID, expiresAt); err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

// SignImport меняет веб-токен на сессию (Telegram
// auth.importWebTokenAuthorization). Токен одноразовый — сгорает при обмене,
// даже если дальше требуется облачный пароль: клиент в этом случае продолжает
// вход по выданному password_token, как после SignIn.
func (i *Interactor) SignImport(ctx context.Context, rawToken, deviceName, platform string) (SignInResult, error) {
	if i.steps == nil {
		return SignInResult{}, ErrLoginStepsUnavailable
	}
	tokenHash := domain.HashToken(rawToken)
	userID, err := i.steps.WebAuthTokenUser(ctx, tokenHash)
	if err != nil {
		return SignInResult{}, err // ErrNotFound → токен истёк/уже использован
	}
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	if res, needed, err := i.startPasswordStep(ctx, userID); err != nil {
		return SignInResult{}, err
	} else if needed {
		_ = i.steps.DeleteWebAuthToken(ctx, tokenHash)
		return res, nil
	}
	res, err := i.mintSession(ctx, user, deviceName, platform)
	if err != nil {
		return SignInResult{}, err
	}
	_ = i.steps.DeleteWebAuthToken(ctx, tokenHash)
	return res, nil
}
