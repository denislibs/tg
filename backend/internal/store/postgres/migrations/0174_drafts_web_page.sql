-- +goose Up
-- Повторяемая (IF NOT EXISTS).
--
-- Ф-5, БЭК-2b. Черновик хранит решение о превью ссылки — параметры TL
-- messages.saveDraft no_webpage, invert_media и media:inputMediaWebPage
-- (tweb appDraftsManager.ts:281-291), и draftMessage отдаёт их обратно
-- (draftsAreEqual сравнивает черновик целиком). Форма — domain.WebPageInput,
-- та же, что у снимка отложенного (scheduled_messages.params.web_page); NULL
-- — решения нет.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS web_page JSONB;

-- +goose Down
ALTER TABLE drafts DROP COLUMN IF EXISTS web_page;
