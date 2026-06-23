// Package realtime bridges the messaging service to Redis pub/sub for
// cross-replica delivery.
package realtime

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// UserChannel is the Redis pub/sub channel for a user's realtime frames.
func UserChannel(userID int64) string { return fmt.Sprintf("user:%d", userID) }

// RedisPublisher publishes frames to per-user Redis channels.
type RedisPublisher struct{ rdb *redis.Client }

func NewRedisPublisher(rdb *redis.Client) *RedisPublisher { return &RedisPublisher{rdb: rdb} }

func (p *RedisPublisher) PublishToUser(ctx context.Context, userID int64, frame []byte) error {
	return p.rdb.Publish(ctx, UserChannel(userID), frame).Err()
}
