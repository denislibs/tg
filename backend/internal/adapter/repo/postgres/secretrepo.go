package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
)

// SecretRepo — postgres-адаптер handshake секретных чатов (только публичные
// ключи + состояние; приватные ключи и plaintext на сервер не попадают).
type SecretRepo struct{ pool *pgxpool.Pool }

func NewSecretRepo(pool *pgxpool.Pool) *SecretRepo { return &SecretRepo{pool: pool} }

func (r *SecretRepo) Create(ctx context.Context, sc domain.SecretChat) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO secret_chats (chat_id, initiator_id, responder_id, initiator_pub, state)
		 VALUES ($1,$2,$3,$4,'requested')`,
		sc.ChatID, sc.InitiatorID, sc.ResponderID, sc.InitiatorPub)
	return err
}

func (r *SecretRepo) Accept(ctx context.Context, chatID int64, responderPub []byte) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE secret_chats SET responder_pub=$2, state='accepted' WHERE chat_id=$1 AND state='requested'`,
		chatID, responderPub)
	return err
}

func (r *SecretRepo) SetState(ctx context.Context, chatID int64, state string) error {
	_, err := r.pool.Exec(ctx, `UPDATE secret_chats SET state=$2 WHERE chat_id=$1`, chatID, state)
	return err
}

func (r *SecretRepo) Get(ctx context.Context, chatID int64) (domain.SecretChat, error) {
	var sc domain.SecretChat
	err := r.pool.QueryRow(ctx,
		`SELECT chat_id, initiator_id, responder_id, initiator_pub, responder_pub, state, created_at
		 FROM secret_chats WHERE chat_id=$1`, chatID).
		Scan(&sc.ChatID, &sc.InitiatorID, &sc.ResponderID, &sc.InitiatorPub, &sc.ResponderPub, &sc.State, &sc.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.SecretChat{}, domain.ErrNotFound
	}
	return sc, err
}
