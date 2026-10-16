package chat

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Облачные черновики (Telegram messages.saveDraft/getAllDrafts/clearAllDrafts):
// один на тройку (чат, тред, пользователь) — порт ключа tweb
// appDraftsManager.ts:88-90 (`peerId_threadId`); пустой текст без reply =
// удаление; изменения рассылаются на устройства владельца кадром
// updateDraftMessage{peer, top_msg_id?, draft} (draft_update), чтобы
// вкладки/устройства держали один и тот же черновик.

// DraftInput — messages.saveDraft в форме TL: текст и reply_to
// (inputReplyToMessage{reply_to_msg_id, top_msg_id?}). Числа — НОМЕРА в чате.
type DraftInput struct {
	Message  string
	Entities domain.MessageEntities
	// ReplyToMsgID — reply_to.reply_to_msg_id: ответ ИЛИ адрес треда (см.
	// draftThread).
	ReplyToMsgID *int64
	// TopMsgID — reply_to.top_msg_id: тред, внутри которого ответ.
	TopMsgID *int64
	// WebPage — no_webpage, invert_media, media:inputMediaWebPage: решение о
	// превью ссылки (tweb appDraftsManager.ts:281-291). Хранится в форме
	// domain.WebPageInput.ForDraft: ссылка без пробелов по краям, только флаги
	// inputMediaWebPage, чужой конструктор media снят — остальное как
	// прислали: tweb сравнивает черновик целиком (draftsAreEqual).
	WebPage domain.WebPageInput
}

// maxDraftWebPageURLRunes — предел ссылки media черновика. У tweb и TL своего
// предела нет; ссылка превью берётся из текста черновика, поэтому её предел —
// предел самого текста.
const maxDraftWebPageURLRunes = domain.MaxMessageRunes

// SaveDraft сохраняет (или снимает — при пустом тексте без ответа) черновик
// треда. Тред выводится из reply_to так же, как его туда кладёт tweb
// (appDraftsManager.ts:296-303), — см. draftThread.
func (i *Interactor) SaveDraft(ctx context.Context, userID, chatID int64, in DraftInput) (*domain.Draft, error) {
	if i.drafts == nil {
		return nil, domain.ErrNotFound
	}
	if utf8.RuneCountInString(in.Message) > domain.MaxMessageRunes {
		return nil, domain.ErrTooLong
	}
	root, top, replyToID, err := i.draftThread(ctx, userID, chatID, in.ReplyToMsgID, in.TopMsgID)
	if err != nil {
		return nil, err
	}
	if in.Message == "" && replyToID == nil {
		if err := i.deleteDraft(ctx, userID, chatID, root); err != nil {
			return nil, err
		}
		return nil, nil
	}
	d, err := i.drafts.Upsert(ctx, userID, domain.Draft{
		ChatID: chatID, ThreadRootID: root, TopMsgID: top, Text: in.Message,
		Entities: domain.SanitizeEntities(in.Entities), ReplyToID: replyToID,
		WebPage: in.WebPage.ForDraft(maxDraftWebPageURLRunes),
	})
	if err != nil {
		return nil, err
	}
	i.publishDraft(ctx, userID, chatID, d.TopMsgID, &d)
	return &d, nil
}

// draftThread — тред черновика (ключ строки корня, 0 — без треда / General),
// он же номером снаружи (top_msg_id: General в форуме — 1, без треда — 0) и
// ответ, оставшийся после его вывода. TL у messages.saveDraft треда не несёт
// (layer.d.ts:20048-20060), tweb кладёт его в reply_to (appDraftsManager.ts:
// 296-303): без ответа reply_to_msg_id = тред, с ответом top_msg_id = тред.
// Правило (спецификация Ф-5 п. 3, В-7):
//  1. есть top_msg_id — тред = он, ответ = reply_to_msg_id. Форма
//     {R, top: R} — не ответ, а адрес треда R (как у отправки,
//     ThreadReplyTo) и решается правилом 2;
//  2. иначе reply_to_msg_id — адрес треда, если это General (1) или корень
//     темы в форуме либо зеркало поста канала в любой группе: ответа на
//     зеркало в самой группе не бывает (В-7);
//  3. иначе — черновик чата (в форуме — General) с ответом.
//
// Доступ — как у readDiscussion (discussionThread): участник; не участник —
// только тред комментариев обсуждения, которое он читает. В форуме тред не
// тема и не зеркало — domain.ErrTopicIDInvalid.
func (i *Interactor) draftThread(ctx context.Context, userID, chatID int64, replyTo, top *int64) (int64, int64, *int64, error) {
	forum := i.groups != nil && i.isForum(ctx, chatID)
	if top != nil && replyTo != nil && *top == *replyTo {
		top = nil // {R, top: R} — адрес треда R (правило 2)
	}
	number, reply := int64(0), replyTo
	// replyFound — ответ уже прочитан правилом 2 (nil — не читали): строку
	// одного номера горячий путь набора не читает дважды.
	var replyFound *bool
	switch {
	case top != nil && *top != 0:
		number = *top
	case replyTo != nil:
		addr, found, err := i.isDraftThreadAddress(ctx, chatID, forum, *replyTo)
		if err != nil {
			return 0, 0, nil, err
		}
		if addr {
			number, reply = *replyTo, nil
		} else {
			replyFound = &found
		}
	}
	reply, err := i.draftReply(ctx, chatID, reply, replyFound)
	if err != nil {
		return 0, 0, nil, err
	}
	if number == 0 {
		ok, err := i.chats.IsMember(ctx, chatID, userID)
		if err != nil {
			return 0, 0, nil, err
		}
		if !ok {
			return 0, 0, nil, domain.ErrNotFound
		}
		if forum {
			number = domain.GeneralTopicID // у форума черновика чата нет: это General
		}
		return 0, number, reply, nil
	}
	th, err := i.discussionThread(ctx, chatID, number, userID)
	if err != nil {
		return 0, 0, nil, err
	}
	return th.stateRoot, number, reply, nil
}

// draftReply — ответ черновика: reply_to_msg_id — НОМЕР сообщения в этом же
// чате (у черновика чужого пира нет: reply_to_peer_id в draftMessage не
// производится). Валидируется мягко: нет такого номера — черновик без ответа.
// found — уже известно, есть ли номер (nil — прочитать).
func (i *Interactor) draftReply(ctx context.Context, chatID int64, reply *int64, found *bool) (*int64, error) {
	if reply == nil {
		return nil, nil
	}
	if found != nil {
		if !*found {
			return nil, nil
		}
		return reply, nil
	}
	_, err := i.messageBySeq(ctx, chatID, *reply)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return nil, nil
	case err != nil:
		return nil, err
	}
	return reply, nil
}

// isDraftThreadAddress — номер n без top_msg_id адресует тред, а не ответ
// (правило 2 draftThread): в форуме General и корень темы, в любой группе —
// зеркало поста канала. found — сообщение с этим номером есть (одно чтение
// строки на оба вопроса).
func (i *Interactor) isDraftThreadAddress(ctx context.Context, chatID int64, forum bool, n int64) (addr, found bool, err error) {
	if forum && n == domain.GeneralTopicID {
		return true, true, nil
	}
	m, err := i.messageBySeq(ctx, chatID, n)
	if errors.Is(err, domain.ErrNotFound) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if m.IsDiscussionMirror {
		return true, true, nil
	}
	if forum && i.topics != nil {
		_, err := i.topics.ByRoot(ctx, chatID, m.ID)
		if err == nil {
			return true, true, nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return false, true, err
		}
	}
	return false, true, nil
}

// isMirror — сообщение rootID — зеркало поста канала в группе обсуждения.
func (i *Interactor) isMirror(ctx context.Context, rootID int64) (bool, error) {
	msgs, err := i.msgs.GetByIDs(ctx, []int64{rootID})
	if err != nil {
		return false, err
	}
	return len(msgs) == 1 && msgs[0].IsDiscussionMirror, nil
}

// MyDrafts — все черновики пользователя, и тредов тоже (getAllDrafts,
// загрузка при старте клиента).
func (i *Interactor) MyDrafts(ctx context.Context, userID int64) ([]domain.Draft, error) {
	if i.drafts == nil {
		return nil, nil
	}
	return i.drafts.ListByUser(ctx, userID)
}

// ClearAllDrafts удаляет все черновики пользователя («Удалить все черновики»
// в конфиденциальности, Telegram messages.clearAllDrafts): кадр — на каждый
// тред.
func (i *Interactor) ClearAllDrafts(ctx context.Context, userID int64) error {
	if i.drafts == nil {
		return nil
	}
	gone, err := i.drafts.DeleteAllByUser(ctx, userID)
	if err != nil {
		return err
	}
	for _, d := range gone {
		i.publishDraft(ctx, userID, d.ChatID, d.TopMsgID, nil)
	}
	return nil
}

// clearDraftAfterSend — отправка снимает черновик СВОЕГО треда (best-effort,
// после коммита сообщения): у tweb отправка с clear_draft снимает черновик
// по ключу треда (appMessagesManager.ts:2637-2642), а ответ сервера несёт
// updateDraftMessage этого треда (:2803-2808, 4175-4181). threadRoot — ключ
// строки корня (как SendInput.ThreadRootID), replyTo — ответ отправки.
func (i *Interactor) clearDraftAfterSend(ctx context.Context, userID, chatID int64, threadRoot, replyTo *int64) {
	if i.drafts == nil {
		return
	}
	_ = i.deleteDraft(ctx, userID, chatID, i.sentDraftThread(ctx, chatID, threadRoot, replyTo))
}

// sentDraftThread — ключ черновика, который снимает отправленное сообщение:
// тот же, что дал бы draftThread черновику, собранному в этом треде. В форуме
// — корень треда (тема или зеркало; General — 0); вне форума — зеркало поста;
// тред обычной группы ключом становится только с ответом (правило 1: tweb
// шлёт top_msg_id лишь вместе с ответом), без ответа его черновик — черновик
// чата (правило 3). Сообщение без треда с ответом на зеркало снимает черновик
// треда комментариев: такой черновик правило 2 кладёт на ключ зеркала (В-7).
func (i *Interactor) sentDraftThread(ctx context.Context, chatID int64, threadRoot, replyTo *int64) int64 {
	if threadRoot == nil || *threadRoot <= 0 {
		if replyTo == nil {
			return 0
		}
		rootID, err := i.msgs.IDBySeq(ctx, chatID, *replyTo)
		if err != nil {
			return 0
		}
		if mirror, err := i.isMirror(ctx, rootID); err == nil && mirror {
			return rootID
		}
		return 0
	}
	root := *threadRoot
	if i.groups != nil && i.isForum(ctx, chatID) {
		return root
	}
	if mirror, err := i.isMirror(ctx, root); err == nil && mirror {
		return root
	}
	if replyTo != nil {
		return root
	}
	return 0
}

func (i *Interactor) deleteDraft(ctx context.Context, userID, chatID, threadRoot int64) error {
	top, deleted, err := i.drafts.Delete(ctx, chatID, userID, threadRoot)
	if err != nil {
		return err
	}
	if deleted {
		i.publishDraft(ctx, userID, chatID, top, nil)
	}
	return nil
}

// publishDraft логирует и шлёт draft_update на все устройства владельца (d nil —
// черновик снят): запись в апдейт-лог даёт плотный курсор, так что смена
// черновика доезжает и через getDifference. topMsgID — тред черновика
// номером (0 — черновик чата).
func (i *Interactor) publishDraft(ctx context.Context, userID, chatID, topMsgID int64, d *domain.Draft) {
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "draft_update",
		func(peer domain.PeerID) map[string]any { return draftPayload(peer, topMsgID, d) })
}
