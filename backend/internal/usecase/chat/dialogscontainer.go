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
// на 15с) → нарезка страницы → ОДИН запрос за последними сообщениями страницы
// (и их гидрация — та же, что у истории, см. hydrateMessages) → ОДИН запрос за
// недостающими авторами. N+1 на страницу здесь недопустим: он и был причиной,
// по которой сервер когда-то склеивал sender_name подзапросом внутри LATERAL
// вместо того, чтобы отдать автора пиром.
func (i *Interactor) DialogsPage(ctx context.Context, viewerID int64, p domain.DialogPage) (DialogsPage, error) {
	page, err := i.ListDialogsPage(ctx, viewerID, p)
	if err != nil {
		return DialogsPage{}, err
	}
	out, err := i.dialogsContainer(ctx, viewerID, page.Dialogs)
	if err != nil {
		return DialogsPage{}, err
	}
	out.Count = page.Count
	out.Whole = page.Whole
	return out, nil
}

// PeerDialogs — порт messages.getPeerDialogs: строки ТОЛЬКО запрошенных
// диалогов зрителя, разложенные теми же векторами, что и страница списка.
//
// Клиент спрашивает так строку, у которой удалено последнее сообщение, а
// нового низа истории у него нет (tweb onUpdateDeleteMessages →
// reloadConversation, appMessagesManager.ts:11577-11593, :6247-6366): новый
// top_message и сам объект сообщения знает только сервер.
//
// Выборка — тот же полный список (ListDialogs, кэш на 15с), что у страниц, и
// отбор по КЛЮЧУ ПИРА глазами зрителя: так чужой чат или неизвестный ключ
// просто не попадает в ответ — ровно как у оригинала, который такие пиры
// резолвит пустым значением (fullfillLeft, :6283-6293). Кэш удалением
// сбрасывается (DeleteMessage → dialogsCache.Invalidate), поэтому строка после
// удаления читается свежей.
func (i *Interactor) PeerDialogs(ctx context.Context, viewerID int64, peers []domain.PeerID) (DialogsPage, error) {
	if len(peers) == 0 {
		return DialogsPage{}, nil
	}
	want := make(map[domain.PeerID]bool, len(peers))
	for _, p := range peers {
		want[p] = true
	}
	all, err := i.ListDialogs(ctx, viewerID)
	if err != nil {
		return DialogsPage{}, err
	}
	picked := make([]domain.DialogRecord, 0, len(peers))
	for _, d := range all {
		if want[i.DialogPeerID(d, viewerID)] {
			picked = append(picked, d)
		}
	}
	return i.dialogsContainer(ctx, viewerID, picked)
}

// dialogsContainer раскладывает строки выборки по векторам контейнера.
func (i *Interactor) dialogsContainer(ctx context.Context, viewerID int64, records []domain.DialogRecord) (DialogsPage, error) {
	var err error
	// ── messages: последние сообщения ТОЛЬКО отданных строк ─────────────────
	ids := make([]int64, 0, len(records))
	for _, d := range records {
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
		// top_message в tweb — полный объект message, то же сообщение, что в
		// истории: превью собирает клиент из него самого (last_text/last_type
		// с провода сняты). Сырая строка несёт вложение и опрос лишь ключом,
		// и фото с опросом оставались в списке без превью.
		if err := i.hydrateMessages(ctx, viewerID, messages); err != nil {
			return DialogsPage{}, err
		}
	}
	// ── drafts: черновики зрителя ───────────────────────────────────────────
	// ОДИН запрос на страницу, не N: черновиков у пользователя единицы, и
	// хранятся они парой (чат, владелец). Место черновика — сам диалог: пока
	// он ехал отдельным списком, дата последней активности чата собиралась из
	// двух источников, а от неё зависит порядок списка.
	drafts := map[int64]domain.DraftMessage{}
	if i.drafts != nil {
		list, err := i.drafts.ListByUser(ctx, viewerID)
		if err != nil {
			return DialogsPage{}, err
		}
		for _, d := range list {
			drafts[d.ChatID] = d.Wire()
		}
	}

	// ── dialogs + chats ─────────────────────────────────────────────────────
	dialogs := make([]domain.Dialog, 0, len(records))
	chats := make([]domain.Chat, 0, len(records))
	users := make([]domain.UserReal, 0, len(records))
	seen := make(map[int64]bool, len(records))
	for _, d := range records {
		peerID := i.DialogPeerID(d, viewerID)
		// Ссылка на пир и ТЕЛО пира — разные вещи: dialog.peer это ссылка, а
		// тело едет вектором chats (у группы/канала) либо users (у приватного
		// чата и «Избранного», где пир это человек).
		// top_message берётся ИЗ ТОЙ ЖЕ строки выборки, что и TopMessageID
		// (см. DialogRecord.TopMessageSeq), а не поиском по загруженным
		// сообщениям: промах такого поиска отдавал бы 0, а 0 здесь значит
		// «самое новое» — подмена, а не деградация.
		dialog := d.ToDialog(domain.NewPeer(peerID), d.TopMessageSeq)
		// «Черновика нет» — отсутствие параметра, а не draftMessageEmpty:
		// пустой конструктор значит «сняли», и это событие, а не состояние.
		if draft, ok := drafts[d.ChatID]; ok {
			dialog.Draft = draft
		}
		dialogs = append(dialogs, dialog)
		if peerID.IsAnyChat() {
			chats = append(chats, d.ToChannel())
		}
		if d.Peer != nil && !seen[d.Peer.ID] {
			seen[d.Peer.ID] = true
			users = append(users, d.Peer.WithHiddenPhone(d.PeerPhone))
		}
	}

	// ── users: авторы последних сообщений ───────────────────────────────────
	// Их не было в ответе вовсе, из-за чего сервер склеивал имя автора сам
	// (last_sender_name) — последний живой экземпляр той болезни, которую у
	// пиров снял уход display_name. С автором-пиром имя собирает клиент.
	// Автор поста канала без подписей профилями не едет (postAuthorHidden):
	// вид чата и подписи — из тех же строк витрины.
	kinds := make(map[int64]string, len(records))
	shown := make(map[int64]bool, len(records))
	for _, d := range records {
		kinds[d.ChatID] = d.Type
		shown[d.ChatID] = d.SignatureProfiles
	}
	missing := make([]int64, 0, len(messages))
	for _, m := range messages {
		if m.SenderID != 0 && !seen[m.SenderID] && !postAuthorHidden(m, kinds, shown) {
			seen[m.SenderID] = true
			missing = append(missing, m.SenderID)
		}
	}
	if len(missing) > 0 && i.groups != nil {
		authors, err := i.groups.UsersByIDs(ctx, viewerID, missing)
		if err != nil {
			return DialogsPage{}, err
		}
		users = append(users, authors...)
	}
	// Собеседники и авторы — одним сборщиком глазами зрителя: фото, номер и
	// статус по правилам приватности. Собеседники приходят из кэша списка,
	// поэтому статус (живой факт) ставится здесь, после кэша, а не в нём.
	i.viewUsers(ctx, viewerID, users)

	return DialogsPage{
		Dialogs:  dialogs,
		Messages: messages,
		Chats:    chats,
		Users:    users,
	}, nil
}

// viewUsers — карточки глазами зрителя: ОДИН сборщик на все витрины
// (privacy.ViewUsers → domain.UserViewRules): фото, номер и статус по
// правилам приватности. Без проверяющего — фото гасятся: показывать аватарку
// «на всякий случай» нельзя.
func (i *Interactor) viewUsers(ctx context.Context, viewerID int64, users []domain.UserReal) {
	if len(users) == 0 {
		return
	}
	if i.privacy == nil {
		domain.UserViewRules{ViewerID: viewerID, Photo: allVisible(users), Phone: map[int64]bool{}, LastSeen: allVisible(users)}.Apply(users)
		return
	}
	i.privacy.ViewUsers(ctx, viewerID, users)
}

// allVisible — «правило пускает всех»: без проверяющего фото видно всем (та
// же мягкая деградация, что у прочих опциональных зависимостей).
func allVisible(users []domain.UserReal) map[int64]bool {
	out := make(map[int64]bool, len(users))
	for _, u := range users {
		out[u.ID] = true
	}
	return out
}
