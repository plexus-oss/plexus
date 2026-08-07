package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func gzipBody(t *testing.T, payload []byte) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return &buf
}

func TestIngestBodyReaderPlain(t *testing.T) {
	r := httptest.NewRequest("POST", "/ingest", strings.NewReader(`{"points":[]}`))
	body, err := ingestBodyReader(r)
	if err != nil {
		t.Fatalf("plain body: %v", err)
	}
	defer body.Close()
	got, _ := io.ReadAll(body)
	if string(got) != `{"points":[]}` {
		t.Fatalf("plain body passthrough mangled: %q", got)
	}
}

func TestIngestBodyReaderGzip(t *testing.T) {
	// The exact shape plexus-python sends for >1KB payloads.
	payload := []byte(`{"source_id":"svc-1","points":[{"class":"metric","metric":"m","value":1,"timestamp":1716201600000}]}`)
	r := httptest.NewRequest("POST", "/ingest", gzipBody(t, payload))
	r.Header.Set("Content-Encoding", "gzip")

	body, err := ingestBodyReader(r)
	if err != nil {
		t.Fatalf("gzip body: %v", err)
	}
	defer body.Close()

	var req ingestRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		t.Fatalf("decode gzip body: %v", err)
	}
	if req.SourceID != "svc-1" || len(req.Points) != 1 {
		t.Fatalf("unexpected decode: %+v", req)
	}
}

func TestIngestBodyReaderGzipCaseInsensitive(t *testing.T) {
	r := httptest.NewRequest("POST", "/ingest", gzipBody(t, []byte(`{}`)))
	r.Header.Set("Content-Encoding", "GZIP")
	body, err := ingestBodyReader(r)
	if err != nil {
		t.Fatalf("GZIP header casing: %v", err)
	}
	body.Close()
}

func TestIngestBodyReaderInvalidGzip(t *testing.T) {
	r := httptest.NewRequest("POST", "/ingest", strings.NewReader("not gzip at all"))
	r.Header.Set("Content-Encoding", "gzip")
	if _, err := ingestBodyReader(r); err == nil {
		t.Fatal("expected error for invalid gzip stream")
	}
}

func TestIngestBodyReaderGzipBombCapped(t *testing.T) {
	// Tiny compressed, huge decompressed: must error, not truncate silently.
	huge := bytes.Repeat([]byte("a"), int(ingestMaxBodyBytes)+1024)
	r := httptest.NewRequest("POST", "/ingest", gzipBody(t, huge))
	r.Header.Set("Content-Encoding", "gzip")

	body, err := ingestBodyReader(r)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer body.Close()

	_, err = io.ReadAll(body)
	if !errors.Is(err, errDecompressedTooLarge) {
		t.Fatalf("expected errDecompressedTooLarge, got %v", err)
	}
}
