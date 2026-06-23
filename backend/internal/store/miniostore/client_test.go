package miniostore

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	tcminio "github.com/testcontainers/testcontainers-go/modules/minio"
)

func TestClient_PresignedRoundTrip(t *testing.T) {
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
