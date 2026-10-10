package postgres

import "strconv"

// Предикаты ВИДИМОСТИ — по одному на предмет, общие для всех выборок.
//
// Пока условие видимости копировалось по запросам, каждая копия теряла своё:
// окно истории знало и очистку, и скрытую предысторию, а поиск, вкладки
// медиа, их счётчики, календарь, темы и скачивание медиа — нет, и через них
// читалось то, чего зритель в ленте не видит. Здесь условие одно, а выборки
// его только подставляют.

// messageVisibleTo — сообщение alias (алиас таблицы messages) видно зрителю
// viewer (плейсхолдер его id): не удалено у всех (deleted_at) и входит в его
// поле зрения (messageInViewOf).
func messageVisibleTo(alias, viewer string) string {
	return alias + `.deleted_at IS NULL AND ` + messageInViewOf(alias, viewer)
}

// messageInViewOf — та часть видимости, что зависит от ЗРИТЕЛЯ (без удаления
// у всех; его отдельно знает тот, кто снимает удалённое со счётчиков):
//
//   - не удалено им у себя (message_hides);
//   - выше его горизонта «очистить историю» (chat_members.cleared_max_seq);
//   - при скрытой предыстории (chats.history_for_new = false) отправлено после
//     его вступления; владельца и админов это не касается (роль ≠ member).
//
// Два последних условия — свойство членства, поэтому не-участнику (публичный
// чат читается без вступления) они не мешают: строки chat_members у него нет.
// Подзапрос идёт по первичному ключу chat_members (chat_id, user_id). viewer
// может быть и колонкой (cm.user_id) — так счётчики пересчитываются сразу
// всем участникам.
func messageInViewOf(alias, viewer string) string {
	return `NOT EXISTS (SELECT 1 FROM message_hides vh WHERE vh.msg_id = ` + alias + `.id AND vh.user_id = ` + viewer + `)` +
		` AND NOT EXISTS (SELECT 1 FROM chat_members vcm JOIN chats vc ON vc.id = vcm.chat_id` +
		` WHERE vcm.chat_id = ` + alias + `.chat_id AND vcm.user_id = ` + viewer +
		` AND (` + alias + `.seq <= vcm.cleared_max_seq` +
		` OR (vcm.role = 'member' AND NOT vc.history_for_new AND ` + alias + `.created_at < vcm.joined_at)))`
}

// chatReadableBy — чат chat (выражение его id) читается зрителем viewer:
// участник либо публичный чат, и не забанен. SQL-двойник
// domain.ChatAccess.CanRead для выборок, где снимок доступа по одному чату
// не подходит (скачивание медиа ищет чат по самому медиа).
func chatReadableBy(chat, viewer string) string {
	return `(EXISTS (SELECT 1 FROM chat_members rcm WHERE rcm.chat_id = ` + chat + ` AND rcm.user_id = ` + viewer + `)` +
		` OR EXISTS (SELECT 1 FROM chats rc WHERE rc.id = ` + chat + ` AND rc.is_public))` +
		` AND NOT EXISTS (SELECT 1 FROM chat_bans rb WHERE rb.chat_id = ` + chat + ` AND rb.user_id = ` + viewer + `)`
}

// storyVisibleTo — история alias (алиас таблицы stories) видна зрителю viewer.
// Одно правило на ленту, просмотр/реакцию по номеру, закреплённые профиля и
// скачивание медиа истории:
//
//   - автору — всегда;
//   - заблокированному автором — никогда;
//   - everyone — всем;
//   - contacts — тем, кто в контактах автора (как privacy.Check: правило
//     владельца смотрит в ЕГО книгу);
//   - close — близким друзьям автора;
//   - selected — тем, кто в списке истории (story_allow).
func storyVisibleTo(alias, viewer string) string {
	return `(` + alias + `.author_id = ` + viewer +
		` OR (NOT EXISTS (SELECT 1 FROM user_blocks sub WHERE sub.blocker_id = ` + alias + `.author_id AND sub.blocked_id = ` + viewer + `)` +
		` AND (` + alias + `.privacy = 'everyone'` +
		` OR (` + alias + `.privacy = 'contacts' AND EXISTS (SELECT 1 FROM contacts sct WHERE sct.owner_id = ` + alias + `.author_id AND sct.user_id = ` + viewer + `))` +
		` OR (` + alias + `.privacy = 'close' AND EXISTS (SELECT 1 FROM close_friends scf WHERE scf.owner_id = ` + alias + `.author_id AND scf.user_id = ` + viewer + `))` +
		` OR EXISTS (SELECT 1 FROM story_allow ssa WHERE ssa.story_id = ` + alias + `.id AND ssa.user_id = ` + viewer + `))))`
}

// UnreadCountCap — верхняя граница подсчёта непрочитанного: дальше счёт не
// идёт (клиент рисует число как есть, как у оригинала при больших значениях
// бейдж всё равно сокращён). Без границы непрочитанный канал с десятками тысяч
// постов стоил бы десятков тысяч строк на каждый /chats.
const UnreadCountCap = 9999

// unreadPostsCount — ОДНА формула непрочитанного на всех: посты чата chat
// выше горизонта readSeq, не от viewer и не удалённые, не больше
// UnreadCountCap. Зеркало поста в группе обсуждения — ничьё (его автор —
// канал, A1-13), поэтому непрочитано и у опубликовавшего пост админа. Её
// подставляют строка списка (dialogUnreadCount) и пересчёт
// при прочтении (MessagesRepo.CountUnread → still_unread_count), поэтому
// бейдж в списке и после прочтения совпадает. Индекс —
// idx_messages_unread_count (0142), index-only scan.
//
// Видимость — общий предикат messageVisibleTo (удалённое, скрытое у себя,
// очищенное, скрытая предыстория): что зритель в ленте не видит, то ему и не
// непрочитанное (Ф-4 перевёл пересчёт при прочтении на него — список обязан
// считать так же).
func unreadPostsCount(chat, readSeq, viewer string) string {
	return `(SELECT count(*) FROM (SELECT 1 FROM messages um WHERE um.chat_id = ` + chat +
		` AND um.seq > ` + readSeq + ` AND (um.sender_id <> ` + viewer + ` OR um.is_discussion_mirror)` +
		` AND ` + messageVisibleTo("um", viewer) + ` LIMIT ` + strconv.Itoa(UnreadCountCap) + `) uc)::int`
}

// dialogUnreadCount — счётчик непрочитанного строки членства m (алиас
// chat_members) в чате c (алиас chats).
//
// У broadcast-канала счётчик считается НА ЧТЕНИИ: пост канала пишется одной
// строкой журнала канала, без веера по подписчикам (O(1) на пост), поэтому
// хранимому chat_members.unread_count расти не от чего. Формула —
// unreadPostsCount. У остальных чатов — хранимый счётчик веера.
func dialogUnreadCount(m, c string) string {
	return `CASE WHEN ` + c + `.type = 'channel' THEN ` +
		unreadPostsCount(c+".id", m+".last_read_seq", m+".user_id") +
		` ELSE ` + m + `.unread_count END`
}
