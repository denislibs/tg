package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// DialogsPage — страница списка чатов, РАЗЛОЖЕННАЯ по векторам контейнера
// messages.Dialogs (см. domain/mtdialog.go).
//
// Диалог у нас перестал держать в себе чат и последнее сообщение: сам `dialog`
// несёт только состояние чтения и место в списке, а имя/аватарка едут в
// `chats`, собеседник и авторы последних сообщений — в `users`, само сообщение
// — в `messages` и адресуется числом top_message.
//
// Сообщения здесь остаются domain.Message: проводного конструктора `message` у
// нас ещё нет (своя подсистема программы), и наружу их переводит существующий
// рендерер delivery/http. Это ВРЕМЕННЫЙ стык, и он назван в
// domain.MessagesDialogs.Messages.
type DialogsPage struct {
	Dialogs  []domain.Dialog
	Messages []domain.Message
	Chats    []domain.Chat
	Users    []domain.UserReal
	// Count — размер ПОЛНОГО набора (внутри запрошенной папки).
	Count int
	// Whole — набор отдан целиком: контейнер messages.dialogs, у которого поля
	// count нет вовсе. Иначе messages.dialogsSlice{count, …}.
	Whole bool
}

// DialogsPage собирает страницу списка чатов в раскладке контейнера.
//
// Порядок обращений к базе фиксирован и пакетный: полный список диалогов (кэш
// на 15с) → нарезка страницы → ОДИН запрос за последними сообщениями страницы →
// ОДИН запрос за недостающими авторами. N+1 на страницу здесь недопустим: он и
// был причиной, по которой сервер когда-то склеивал sender_name подзапросом
// внутри LATERAL вместо того, чтобы отдать автора пиром.
func (i *Interactor) DialogsPage(ctx context.Context, viewerID int64, p domain.DialogPage) (DialogsPage, error) {
	page, err := i.ListDialogsPage(ctx, viewerID, p)
	if err != nil {
		return DialogsPage{}, err
	}

	// ── messages: последние сообщения ТОЛЬКО отданной страницы ──────────────
	ids := make([]int64, 0, len(page.Dialogs))
	for _, d := range page.Dialogs {
		if d.TopMessageID != 0 {
			ids = append(ids, d.TopMessageID)
		}
	}
	var messages []domain.Message
	if len(ids) > 0 && i.msgs != nil {
		messages, err = i.msgs.GetByIDs(ctx, ids)
		if err != nil {
			return DialogsPage{}, err
		}
	}
	// ── dialogs + chats ─────────────────────────────────────────────────────
	dialogs := make([]domain.Dialog, 0, len(page.Dialogs))
	chats := make([]domain.Chat, 0, len(page.Dialogs))
	users := make([]domain.UserReal, 0, len(page.Dialogs))
	seen := make(map[int64]bool, len(page.Dialogs))
	for _, d := range page.Dialogs {
		peerID := i.DialogPeerID(d, viewerID)
		// Ссылка на пир и ТЕЛО пира — разные вещи: dialog.peer это ссылка, а
		// тело едет вектором chats (у группы/канала) либо users (у приватного
		// чата и «Избранного», где пир это человек).
		// top_message берётся ИЗ ТОЙ ЖЕ строки выборки, что и TopMessageID
		// (см. DialogRecord.TopMessageSeq), а не поиском по загруженным
		// сообщениям: промах такого поиска отдавал бы 0, а 0 здесь значит
		// «самое новое» — подмена, а не деградация.
		dialogs = append(dialogs, d.ToDialog(domain.NewPeer(peerID), d.TopMessageSeq))
		if peerID.IsAnyChat() {
			chats = append(chats, d.ToChannel())
		}
		if d.Peer != nil && !seen[d.Peer.ID] {
			seen[d.Peer.ID] = true
			users = append(users, *d.Peer)
		}
	}

	// ── users: авторы последних сообщений ───────────────────────────────────
	// Их не было в ответе вовсе, из-за чего сервер склеивал имя автора сам
	// (last_sender_name) — последний живой экземпляр той болезни, которую у
	// пиров снял уход display_name. С автором-пиром имя собирает клиент.
	missing := make([]int64, 0, len(messages))
	for _, m := range messages {
		if m.SenderID != 0 && !seen[m.SenderID] {
			seen[m.SenderID] = true
			missing = append(missing, m.SenderID)
		}
	}
	if len(missing) > 0 && i.groups != nil {
		authors, err := i.groups.UsersByIDs(ctx, missing)
		if err != nil {
			return DialogsPage{}, err
		}
		i.gateAuthorPhotos(ctx, viewerID, authors)
		users = append(users, authors...)
	}

	return DialogsPage{
		Dialogs:  dialogs,
		Messages: messages,
		Chats:    chats,
		Users:    users,
		Count:    page.Count,
		Whole:    page.Whole,
	}, nil
}

// gateAuthorPhotos гасит аватарки тех авторов, кому правило profile_photo не
// разрешает показ этому зрителю, — тем же правилом, что и собеседников
// приватных диалогов (см. ListDialogs). Сбой правила не должен ронять выдачу
// списка, но и показывать аватарку «на всякий случай» нельзя: при ошибке гасим.
func (i *Interactor) gateAuthorPhotos(ctx context.Context, viewerID int64, users []domain.UserReal) {
	if i.privacy == nil || len(users) == 0 {
		return
	}
	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	vis, err := i.privacy.VisibleMap(ctx, viewerID, ids, domain.PrivacyProfilePhoto)
	for idx := range users {
		if users[idx].ID == viewerID {
			continue
		}
		if err != nil || !vis[users[idx].ID] {
			// «Фото нет» — это СОСТОЯНИЕ (userProfilePhotoEmpty), а не пустая
			// строка url рядом с непогашенным превью.
			users[idx].Photo = domain.NewUserProfilePhotoEmpty()
		}
	}
}
