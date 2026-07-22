-- +goose Up
-- RTMP-трансляции в групповом звонке канала/группы (Telegram livestream / RTMP
-- stream): админ запускает трансляцию вместо обычного видеочата и получает
-- креды для OBS (rtmp URL сервера + stream key). Трансляция — «приправленный»
-- групповой звонок: зрители присоединяются через существующий Redis-сет
-- участников (их число = счётчик зрителей), а метаданные потока (ключ, активна
-- ли, время старта) персистятся здесь — ключ должен переживать перезапуски и
-- перевыпускаться (revoke). Одна трансляция на чат, поэтому chat_id — ключ.
CREATE TABLE livestreams (
    chat_id    BIGINT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    stream_key TEXT NOT NULL,             -- секрет для OBS; перевыпускается revoke_key
    active     BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ                 -- когда трансляция была запущена (NULL, если неактивна)
);

-- +goose Down
DROP TABLE livestreams;
