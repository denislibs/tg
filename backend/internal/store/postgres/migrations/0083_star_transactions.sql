-- +goose Up
-- Леджер транзакций звёзд (Telegram Stars wallet history). Каждое движение
-- баланса пишет строку: пополнение (+), подарок отправлен (−), подарок обменян
-- на звёзды (+), разблокировка платного медиа (−). Read-модель для экрана
-- «Кошелёк» (tweb Stars transactions: getStarsTransactions).
CREATE TABLE star_transactions (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     INT8 NOT NULL,               -- со знаком: + начисление, − списание
    kind       TEXT NOT NULL,               -- 'topup'|'gift_sent'|'gift_converted'|'paid_media'
    title      TEXT NOT NULL DEFAULT '',    -- человекочитаемая метка
    peer_id    INT8 REFERENCES users(id) ON DELETE SET NULL, -- контрагент (nullable)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_star_tx_user ON star_transactions(user_id, created_at DESC);

-- +goose Down
DROP TABLE star_transactions;
