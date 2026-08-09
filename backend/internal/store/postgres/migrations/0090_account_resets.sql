-- +goose Up
-- Отложенный сброс аккаунта (Telegram account.deleteAccount на шаге пароля).
-- Сброс НЕ мгновенный: первый запрос только планирует удаление через окно
-- ожидания (неделя), клиент получает 2FA_CONFIRM_WAIT_<секунды>. Удаление
-- исполняет повторный вызов ручки, когда окно истекло, — фоновой задачи нет,
-- как и у Telegram, где счётчик просто отдаётся клиенту.
--
-- cancelled_at ставится при любом успешном ВХОДЕ владельца: живой аккаунт
-- отменяет чужую попытку сброса, следующий запрос получает 2FA_RECENT_CONFIRM.
-- Запись при этом не удаляется — она держит карантин (те же 7 дней, ровно как
-- обещает текст клиента «Please try again in 7 days»), иначе отменённый сброс
-- перепланировался бы сразу и окно обнулялось бы бесконечно.
--
-- Одна строка на пользователя: параллельные попытки сброса делят одно окно и не
-- могут продлевать его повторными запросами.
CREATE TABLE account_resets (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL,
    delete_at    TIMESTAMPTZ NOT NULL,
    cancelled_at TIMESTAMPTZ
);

-- Срок исполнения — единственное, по чему запись отбирают (истекло окно или
-- нет). Отменённые в этот отбор не попадают никогда.
CREATE INDEX account_resets_delete_at_idx ON account_resets (delete_at) WHERE cancelled_at IS NULL;

-- +goose Down
DROP TABLE account_resets;
