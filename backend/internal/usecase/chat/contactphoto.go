package chat

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// suggestPhotoAction is the JSON stored in the text of a "suggested a profile
// photo" service message (mirrors tweb messageActionSuggestProfilePhoto: the
// action + suggested photo url travel as data). The client renders the pill,
// the photo preview (media_id) and the recipient-only "Set Photo" button.
type suggestPhotoAction struct {
	Action   string `json:"action"` // always "suggest_photo"
	ActorID  int64  `json:"actor_id"`
	Actor    string `json:"actor"`
	PhotoURL string `json:"photo_url"`
	Accepted bool   `json:"accepted,omitempty"`
}

// SuggestProfilePhoto posts a service message into the private chat between
// fromUserID and toUserID offering a new profile photo. The suggested photo
// rides on the message's media_id (preview) and photoURL is kept in the action
// JSON so the recipient can accept it later. Mirrors Telegram
// photos.uploadContactProfilePhoto with suggest=true.
func (i *Interactor) SuggestProfilePhoto(ctx context.Context, fromUserID, toUserID, mediaID int64, photoURL string) (domain.Message, error) {
	if fromUserID == toUserID {
		return domain.Message{}, domain.ErrInvalid
	}
	chatID, err := i.CreatePrivateChat(ctx, fromUserID, toUserID)
	if err != nil {
		return domain.Message{}, err
	}
	actor := i.userCard(ctx, fromUserID)
	payload, _ := json.Marshal(suggestPhotoAction{
		Action:   "suggest_photo",
		ActorID:  fromUserID,
		Actor:    actor.DisplayName,
		PhotoURL: photoURL,
	})
	mid := mediaID
	return i.Send(ctx, SendInput{
		ChatID:   chatID,
		SenderID: fromUserID,
		Type:     "service",
		Text:     string(payload),
		MediaID:  &mid,
	})
}

// AcceptProfilePhotoSuggestion accepts a "suggested a profile photo" service
// message: the suggested photo is added to the accepting user's own gallery
// (promoted to current avatar) and the service message is flagged accepted so
// every device stops showing the "Set Photo" button. Only the recipient (not
// the suggester) may accept, and only once.
func (i *Interactor) AcceptProfilePhotoSuggestion(ctx context.Context, userID, msgID int64) error {
	if i.profilePics == nil {
		return domain.ErrNotFound // profile-photo gallery not wired
	}
	m, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if m.Type != "service" || m.Deleted {
		return domain.ErrNotFound
	}
	var act suggestPhotoAction
	if err := json.Unmarshal([]byte(m.Text), &act); err != nil || act.Action != "suggest_photo" {
		return domain.ErrNotFound
	}
	if act.Accepted {
		return domain.ErrConflict // already accepted
	}
	// Only the recipient of the suggestion may accept it.
	if m.SenderID == userID {
		return domain.ErrForbidden
	}
	ok, err := i.chats.IsMember(ctx, m.ChatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	if act.PhotoURL == "" {
		return domain.ErrInvalid
	}
	if _, err := i.profilePics.AddProfilePhoto(ctx, userID, act.PhotoURL, ""); err != nil {
		return err
	}

	// Flag the service message accepted and fan out an edit so the button hides
	// on every device. The recipient is not the author, so this bypasses the
	// author-only EditMessage and updates the text directly.
	act.Accepted = true
	updated, _ := json.Marshal(act)
	var members []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		msg, e := i.msgs.UpdateText(ctx, msgID, string(updated), nil)
		if e != nil {
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, m.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		p, e := json.Marshal(editUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", p); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		fresh, e := i.msgs.GetByID(ctx, msgID)
		if e == nil {
			f := frame("edit_message", editUpdatePayload(fresh))
			for _, uid := range members {
				_ = i.publisher.PublishToUser(ctx, uid, f)
			}
		}
	}
	return nil
}
