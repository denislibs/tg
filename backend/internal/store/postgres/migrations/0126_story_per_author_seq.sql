-- +goose Up
-- Пер-авторская нумерация историй и ГОРИЗОНТ прочтения.
--
-- Решение Р3 разбора историй (docs/readiness/tl-stories-analysis.md). У
-- оригинала прочитанность историй выражена не признаком на каждой истории, а
-- одним номером на автора — `peerStories.max_read_id`, ровно как
-- `read_inbox_max_id` у диалога. Горизонт имеет смысл ТОЛЬКО при пер-авторской
-- нумерации, а `stories.id` — глобальный BIGSERIAL (миграция 0009), поэтому до
-- этой миграции наружу ехал временный признак `viewed`.
--
-- Приём тот же, что у сообщения (миграция 0105): внутренний ключ строки
-- остаётся `id`, наружу едет НОМЕР ВНУТРИ автора (`seq`), а счётчик номеров
-- живёт у самого автора (`users.last_story_seq` — зеркало `chats.last_seq`).

ALTER TABLE users ADD COLUMN last_story_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN seq BIGINT NOT NULL DEFAULT 0;

-- Номер внутри автора в порядке появления: тот же порядок, в котором истории
-- создавались, поэтому «свежее» и «больший номер» совпадают.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY author_id ORDER BY id) AS n FROM stories
)
UPDATE stories s SET seq = numbered.n FROM numbered WHERE numbered.id = s.id;

UPDATE users u
   SET last_story_seq = COALESCE((SELECT max(seq) FROM stories WHERE author_id = u.id), 0);

-- Ссылка репоста адресовала источник ГЛОБАЛЬНЫМ ключом; на проводе
-- `storyFwdHeader{from, story_id}` — это пир плюс номер ВНУТРИ него, и автор
-- источника рядом уже хранится.
UPDATE stories s SET fwd_from_story_id = src.seq
  FROM stories src
 WHERE s.fwd_from_story_id IS NOT NULL AND src.id = s.fwd_from_story_id;

ALTER TABLE stories ALTER COLUMN seq DROP DEFAULT;
CREATE UNIQUE INDEX idx_stories_author_seq ON stories(author_id, seq);

CREATE TABLE story_read (
  viewer_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (viewer_id, author_id)
);

-- Горизонт восстанавливается из уже записанных просмотров: до миграции
-- «прочитано» и было строкой в story_views, поэтому данные не теряются.
--
-- Таблица story_views при этом остаётся — она отвечает на ДРУГОЙ вопрос, «кто
-- посмотрел» (stories.getStoryViewsList), и горизонт её не заменяет.
INSERT INTO story_read (viewer_id, author_id, max_read_id)
  SELECT sv.viewer_id, s.author_id, max(s.seq)
    FROM story_views sv JOIN stories s ON s.id = sv.story_id
   GROUP BY sv.viewer_id, s.author_id
ON CONFLICT DO NOTHING;

-- +goose Down
-- Обратный ход возвращает глобальную адресацию ссылки репоста и снимает
-- нумерацию. Горизонт теряется — но не безвозвратно: он и восстанавливался из
-- story_views, которая остаётся на месте.

UPDATE stories s SET fwd_from_story_id = src.id
  FROM stories src
 WHERE s.fwd_from_story_id IS NOT NULL
   AND src.author_id = s.fwd_from_author_id
   AND src.seq = s.fwd_from_story_id;

DROP TABLE story_read;
DROP INDEX idx_stories_author_seq;
ALTER TABLE stories DROP COLUMN seq;
ALTER TABLE users DROP COLUMN last_story_seq;
