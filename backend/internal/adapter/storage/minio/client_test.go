package minio

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	tcminio "github.com/testcontainers/testcontainers-go/modules/minio"
)

// newTestClient boots a throwaway MinIO container, connects a Client to a fresh
// "media" bucket, and returns it. It skips the test (not fails) when Docker is
// unavailable so the suite degrades gracefully on machines without Docker.
func newTestClient(t *testing.T) *Client {
	t.Helper()
	ctx := context.Background()
	container, err := tcminio.Run(ctx, "minio/minio:latest")
	if err != nil {
		t.Skipf("cannot start minio container (is Docker running?): %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	endpoint, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("connstr: %v", err)
	}
	c, err := Connect(endpoint, container.Username, container.Password, "media", false)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := c.EnsureBucket(ctx); err != nil {
		t.Fatalf("ensure bucket: %v", err)
	}
	return c
}

func TestClient_PresignedRoundTrip(t *testing.T) {
	ctx := context.Background()
	c := newTestClient(t)

	// Upload via presigned PUT.
	putURL, err := c.PresignedPut(ctx, "obj1", time.Minute)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	body := []byte("hello media")
	req, _ := http.NewRequest(http.MethodPut, putURL, bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("put upload: %v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()

	// Download via presigned GET.
	getURL, err := c.PresignedGet(ctx, "obj1", time.Minute)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	resp, err = http.Get(getURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("get download: %v status=%v", err, resp.StatusCode)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	if !bytes.Equal(got, body) {
		t.Fatalf("round-trip mismatch: %q", got)
	}

	// Range request returns 206 Partial Content.
	rreq, _ := http.NewRequest(http.MethodGet, getURL, nil)
	rreq.Header.Set("Range", "bytes=0-4")
	rresp, err := http.DefaultClient.Do(rreq)
	if err != nil || rresp.StatusCode != http.StatusPartialContent {
		t.Fatalf("range request: %v status=%v", err, rresp.StatusCode)
	}
	rresp.Body.Close()
}

func TestClient_PutGetObject(t *testing.T) {
	c := newTestClient(t)
	ctx := context.Background()
	key := "7/streamtest"
	payload := []byte("hello media bytes")
	if err := c.PutObject(ctx, key, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
		t.Fatalf("put: %v", err)
	}
	rc, info, err := c.GetObject(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer rc.Close()
	if info.Size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", info.Size, len(payload))
	}
	got, _ := io.ReadAll(rc)
	if string(got) != string(payload) {
		t.Fatalf("body = %q, want %q", got, payload)
	}
}
