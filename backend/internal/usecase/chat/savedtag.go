package chat

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// savedTagTitleMax — предел длины имени тега (tweb InputField maxLength:12).
const savedTagTitleMax = 12

// SavedTags returns the caller's saved reaction tags (reaction + optional name +
// tagged-message count), most used first. Empty when the saved chat doesn't exist
// yet or the tags store isn't wired.
func (i *Interactor) SavedTags(ctx context.Context, userID int64) ([]domain.SavedTag, error) {
	if i.savedTags == nil {
		return []domain.SavedTag{}, nil
	}
	chatID, err := i.chats.FindSaved(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return []domain.SavedTag{}, nil
		}
		return nil, err
	}
	return i.savedTags.ListWithCounts(ctx, userID, chatID)
}

// SetSavedTagName sets (or, with an empty title, clears) the display name of a
// saved reaction tag (Telegram updateSavedReactionTag). The reaction is the same
// opaque string used for reactions (emoji or custom-emoji id).
func (i *Interactor) SetSavedTagName(ctx context.Context, userID int64, reaction, title string) error {
	if reaction == "" || len(reaction) > maxEmojiLen || !utf8.ValidString(reaction) {
		return domain.ErrBadReaction
	}
	if !utf8.ValidString(title) {
		return domain.ErrInvalid
	}
	if utf8.RuneCountInString(title) > savedTagTitleMax {
		return domain.ErrTooLong
	}
	if i.savedTags == nil {
		return domain.ErrForbidden
	}
	return i.savedTags.SetTitle(ctx, userID, reaction, title)
}
