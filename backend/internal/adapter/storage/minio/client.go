// Package minio wraps the MinIO SDK: bucket setup and presigned URLs.
package minio

import (
	"context"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

type Client struct {
	mc     *minio.Client
	bucket string
}

// Connect dials MinIO and returns a client bound to a bucket.
func Connect(endpoint, accessKey, secretKey, bucket string, useSSL bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &Client{mc: mc, bucket: bucket}, nil
}

func (c *Client) Bucket() string { return c.bucket }

// EnsureBucket creates the bucket if it does not already exist.
func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{})
	}
	return nil
}

// PresignedPut returns a URL the client can PUT bytes to directly.
func (c *Client) PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedPutObject(ctx, c.bucket, objectKey, expiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PresignedGet returns a URL the client can GET (Range-capable) directly.
func (c *Client) PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, objectKey, expiry, url.Values{})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PutObject streams up to size bytes from r into objectKey.
func (c *Client) PutObject(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) error {
	_, err := c.mc.PutObject(ctx, c.bucket, objectKey, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// GetObject opens objectKey for streaming reads (the returned reader is Range/Seek
// capable) and returns its size/content-type via a Stat round-trip.
func (c *Client) GetObject(ctx context.Context, objectKey string) (io.ReadSeekCloser, usecasemedia.ObjectInfo, error) {
	obj, err := c.mc.GetObject(ctx, c.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, usecasemedia.ObjectInfo{}, err
	}
	st, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, usecasemedia.ObjectInfo{}, err
	}
	return obj, usecasemedia.ObjectInfo{Size: st.Size, ContentType: st.ContentType, ModTime: st.LastModified}, nil
}
