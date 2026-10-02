-- +goose Up
-- Публичные имена пользователей и чатов — ОДНО пространство, как у Telegram:
-- @имя адресует ровно одного пира (contacts.resolveUsername), и группа не может
-- взять имя, которое уже у человека, и наоборот. Уникальные индексы у нас
-- раздельные (users.username — 0001/0010, chats.username — 0006), поэтому
-- общая граница держится триггером на обеих таблицах. Отказ — тот же
-- unique_violation (23505), что у индекса: сохранение имени уже переводит его
-- в domain.ErrConflict. Advisory-блокировка по имени сериализует встречные
-- записи в РАЗНЫЕ таблицы (одну таблицу стережёт её индекс): второй писатель
-- ждёт коммита первого и в READ COMMITTED видит его строку.
-- +goose StatementBegin
CREATE FUNCTION username_namespace_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.username IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(lower(NEW.username::text)));
  IF TG_TABLE_NAME = 'users' THEN
    IF EXISTS (SELECT 1 FROM chats WHERE username = NEW.username::citext) THEN
      RAISE unique_violation USING MESSAGE = 'username is taken by a chat';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM users WHERE username = NEW.username::citext) THEN
    RAISE unique_violation USING MESSAGE = 'username is taken by a user';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER users_username_namespace BEFORE INSERT OR UPDATE OF username ON users
  FOR EACH ROW EXECUTE FUNCTION username_namespace_guard();
CREATE TRIGGER chats_username_namespace BEFORE INSERT OR UPDATE OF username ON chats
  FOR EACH ROW EXECUTE FUNCTION username_namespace_guard();

-- +goose Down
DROP TRIGGER IF EXISTS chats_username_namespace ON chats;
DROP TRIGGER IF EXISTS users_username_namespace ON users;
DROP FUNCTION IF EXISTS username_namespace_guard();
