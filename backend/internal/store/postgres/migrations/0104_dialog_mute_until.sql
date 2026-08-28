-- +goose Up
-- Мьют диалога: две колонки на один вопрос схлопываются в одну.
--
-- Было (0002 + 0020): `muted BOOLEAN` — «навсегда», `muted_until TIMESTAMPTZ` —
-- «на срок», эффективный мьют считался как `muted OR muted_until > now()`, и
-- этот предикат был размножен по пяти запросам. В схеме механизм ОДИН:
-- peerNotifySettings.mute_until — unix-время, до которого молчим, а «навсегда»
-- это не отдельный флаг, а срок в далёком будущем (tweb constants.ts:15,
-- MUTE_UNTIL = 0x7FFFFFFF = 2147483647). Разбор — docs/readiness/tl-dialogs-analysis.md,
-- решение Р4.
--
-- Дефект, который это чинит, не теоретический: цепочка «заглушить на час» была
-- построена целиком (UI предлагает срок, клиент шлёт, база хранит), а провод её
-- терял — витрина схлопывала срок в булево. «На час» работало как «навсегда».
UPDATE chat_members
   SET muted_until = to_timestamp(2147483647)
 WHERE muted
   AND (muted_until IS NULL OR muted_until < to_timestamp(2147483647));

ALTER TABLE chat_members DROP COLUMN muted;

-- +goose Down
ALTER TABLE chat_members ADD COLUMN muted BOOLEAN NOT NULL DEFAULT false;

-- Обратный перенос: «навсегда» снова становится флагом, срок при этом
-- снимается — иначе после отката чат оказался бы замьючен ДВАЖДЫ, и снятие
-- флага не сняло бы мьют.
UPDATE chat_members
   SET muted = true, muted_until = NULL
 WHERE muted_until = to_timestamp(2147483647);
