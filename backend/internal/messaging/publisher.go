package messaging

import (
	"context"
	"encoding/json"
)

// Publisher delivers a pre-encoded WS frame to a user's realtime channel.
// Implementations must be safe for concurrent use and must not block.
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// frame encodes a WS envelope {t, d}. Errors are impossible for the maps we pass,
// so it returns just the bytes (empty on the unreachable error path).
func frame(t string, d any) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d})
	if err != nil {
		return nil
	}
	return b
}
