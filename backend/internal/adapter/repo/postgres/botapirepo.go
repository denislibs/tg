package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// BotAPIRepo — Bot API: учётки/токены ботов, очередь апдейтов (getUpdates),
// mini-app'ы и состояние мастера BotFather.
type BotAPIRepo struct {
	pool *pgxpool.Pool
}

func NewBotAPIRepo(pool *pgxpool.Pool) *BotAPIRepo { return &BotAPIRepo{pool: pool} }

func randSecret() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) // 32 hex-символа
}

func (r *BotAPIRepo) CreateBot(ctx context.Context, ownerID int64, name, username string) (domain.BotAccount, error) {
	secret := randSecret()
	q := querier(ctx, r.pool)
	var botID int64
	// Синтетический уникальный phone (у ботов нет номера).
	phone := "bot_" + secret
	err := q.QueryRow(ctx,
		`INSERT INTO users (phone, username, first_name, display_name, is_bot, is_verified)
		 VALUES ($1, $2, $3, $3, true, false) RETURNING id`,
		phone, username, name).Scan(&botID)
	if err != nil {
		return domain.BotAccount{}, err
	}
	token := fmt.Sprintf("%d:%s", botID, secret)
	if _, err := q.Exec(ctx,
		`INSERT INTO bot_accounts (bot_id, owner_id, token) VALUES ($1, $2, $3)`,
		botID, ownerID, token); err != nil {
		return domain.BotAccount{}, err
	}
	return domain.BotAccount{BotID: botID, OwnerID: ownerID, Token: token, Username: username, Name: name}, nil
}

const botSelect = `SELECT a.bot_id, a.owner_id, a.token, a.webhook_url, a.menu_button_text, a.menu_button_url,
	COALESCE(u.username, ''), u.display_name
	FROM bot_accounts a JOIN users u ON u.id = a.bot_id `

func scanBot(row pgx.Row) (domain.BotAccount, error) {
	var b domain.BotAccount
	err := row.Scan(&b.BotID, &b.OwnerID, &b.Token, &b.WebhookURL, &b.MenuButtonText, &b.MenuButtonURL, &b.Username, &b.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.BotAccount{}, domain.ErrNotFound
	}
	return b, err
}

func (r *BotAPIRepo) BotByToken(ctx context.Context, token string) (domain.BotAccount, error) {
	return scanBot(querier(ctx, r.pool).QueryRow(ctx, botSelect+`WHERE a.token = $1`, token))
}
func (r *BotAPIRepo) BotByID(ctx context.Context, botID int64) (domain.BotAccount, error) {
	return scanBot(querier(ctx, r.pool).QueryRow(ctx, botSelect+`WHERE a.bot_id = $1`, botID))
}

func (r *BotAPIRepo) BotsByOwner(ctx context.Context, ownerID int64) ([]domain.BotAccount, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, botSelect+`WHERE a.owner_id = $1 ORDER BY a.created_at`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotAccount
	for rows.Next() {
		b, err := scanBot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *BotAPIRepo) UsernameTaken(ctx context.Context, username string) (bool, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx, `SELECT count(*) FROM users WHERE lower(username) = lower($1)`, username).Scan(&n)
	return n > 0, err
}

func (r *BotAPIRepo) SetWebhook(ctx context.Context, botID int64, url string) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE bot_accounts SET webhook_url = $2 WHERE bot_id = $1`, botID, url)
	return err
}
func (r *BotAPIRepo) SetMenuButton(ctx context.Context, botID int64, text, url string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE bot_accounts SET menu_button_text = $2, menu_button_url = $3 WHERE bot_id = $1`, botID, text, url)
	return err
}
func (r *BotAPIRepo) RegenToken(ctx context.Context, botID int64) (string, error) {
	token := fmt.Sprintf("%d:%s", botID, randSecret())
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE bot_accounts SET token = $2 WHERE bot_id = $1`, botID, token)
	return token, err
}

func (r *BotAPIRepo) SetCommands(ctx context.Context, botID int64, cmds []domain.BotCommand) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `DELETE FROM bot_commands WHERE bot_id = $1`, botID); err != nil {
		return err
	}
	for i, c := range cmds {
		if _, err := q.Exec(ctx,
			`INSERT INTO bot_commands (bot_id, command, description, sort) VALUES ($1, $2, $3, $4)`,
			botID, c.Command, c.Description, i); err != nil {
			return err
		}
	}
	return nil
}

func (r *BotAPIRepo) EnqueueUpdate(ctx context.Context, botID int64, payload []byte) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO bot_updates (bot_id, payload) VALUES ($1, $2) RETURNING update_id`,
		botID, string(payload)).Scan(&id)
	return id, err
}

func (r *BotAPIRepo) PullUpdates(ctx context.Context, botID, offset int64, limit int) ([]domain.BotUpdate, error) {
	q := querier(ctx, r.pool)
	// offset>0 подтверждает предыдущую пачку — удаляем прочитанное.
	if offset > 0 {
		if _, err := q.Exec(ctx, `DELETE FROM bot_updates WHERE bot_id = $1 AND update_id < $2`, botID, offset); err != nil {
			return nil, err
		}
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := q.Query(ctx,
		`SELECT update_id, payload FROM bot_updates WHERE bot_id = $1 AND update_id >= $2 ORDER BY update_id LIMIT $3`,
		botID, offset, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotUpdate
	for rows.Next() {
		var u domain.BotUpdate
		if err := rows.Scan(&u.UpdateID, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *BotAPIRepo) CreateApp(ctx context.Context, app domain.BotApp) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO bot_apps (bot_id, short_name, title, url) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (bot_id, short_name) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url`,
		app.BotID, app.ShortName, app.Title, app.URL)
	return err
}
func (r *BotAPIRepo) AppByShortName(ctx context.Context, botID int64, shortName string) (domain.BotApp, error) {
	var a domain.BotApp
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT bot_id, short_name, title, url FROM bot_apps WHERE bot_id = $1 AND lower(short_name) = lower($2)`,
		botID, shortName).Scan(&a.BotID, &a.ShortName, &a.Title, &a.URL)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.BotApp{}, domain.ErrNotFound
	}
	return a, err
}
func (r *BotAPIRepo) AppsByBot(ctx context.Context, botID int64) ([]domain.BotApp, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT bot_id, short_name, title, url FROM bot_apps WHERE bot_id = $1 ORDER BY short_name`, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotApp
	for rows.Next() {
		var a domain.BotApp
		if err := rows.Scan(&a.BotID, &a.ShortName, &a.Title, &a.URL); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *BotAPIRepo) WizardGet(ctx context.Context, userID int64) (domain.BotWizard, error) {
	var w domain.BotWizard
	w.UserID = userID
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT flow, step, data FROM bot_wizard WHERE user_id = $1`, userID).Scan(&w.Flow, &w.Step, &w.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.BotWizard{UserID: userID}, nil // пустой мастер
	}
	return w, err
}
func (r *BotAPIRepo) WizardSet(ctx context.Context, w domain.BotWizard) error {
	data := string(w.Data)
	if data == "" {
		data = "{}"
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO bot_wizard (user_id, flow, step, data, updated_at) VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (user_id) DO UPDATE SET flow = EXCLUDED.flow, step = EXCLUDED.step, data = EXCLUDED.data, updated_at = now()`,
		w.UserID, w.Flow, w.Step, data)
	return err
}
func (r *BotAPIRepo) WizardClear(ctx context.Context, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM bot_wizard WHERE user_id = $1`, userID)
	return err
}

func (r *BotAPIRepo) UserBrief(ctx context.Context, id int64) (string, string, error) {
	var username, firstName string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(username, ''), first_name FROM users WHERE id = $1`, id).Scan(&username, &firstName)
	return username, firstName, err
}
