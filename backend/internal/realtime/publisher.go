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

// DeviceChannel is the Redis control channel for a device (close-on-revoke).
func DeviceChannel(deviceID int64) string { return fmt.Sprintf("device:%d", deviceID) }

// NotifyRevoked publishes a close signal on the device's control channel so the
// WS hub can drop that device's live socket. Implements auth.RevocationNotifier.
func (p *RedisPublisher) NotifyRevoked(ctx context.Context, deviceID int64) error {
	return p.rdb.Publish(ctx, DeviceChannel(deviceID), "close").Err()
}
