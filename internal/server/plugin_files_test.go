package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The module's front end is served, not listed, and only its fingerprinted assets
// are cached. It is also the one surface that answers without a token: a script tag
// cannot carry one, and the page's own data calls do.
func TestPluginFilesServesTheBundle(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"plugin.json":       `{"plugin":"workspace"}`,
		"remoteEntry.js":    "export {}",
		"assets/index-1.js": "console.log(1)",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	s := &Server{}
	mux := http.NewServeMux()
	s.registerUIRoutes(mux, dir)

	cases := []struct {
		path       string
		status     int
		cacheMatch string
	}{
		{"/plugins/workspace/plugin.json", http.StatusOK, "no-cache"},
		{"/plugins/workspace/remoteEntry.js", http.StatusOK, "no-cache"},
		{"/plugins/workspace/assets/index-1.js", http.StatusOK, "immutable"},
		{"/plugins/workspace/", http.StatusNotFound, ""},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.status {
			t.Errorf("%s: status = %d, want %d", tc.path, rec.Code, tc.status)
			continue
		}
		if tc.cacheMatch != "" && !strings.Contains(rec.Header().Get("Cache-Control"), tc.cacheMatch) {
			t.Errorf("%s: Cache-Control = %q, want %q", tc.path, rec.Header().Get("Cache-Control"), tc.cacheMatch)
		}
	}
}

// The front end answers without a token; the API below it does not.
func TestUIIsPublicButTheAPIIsNot(t *testing.T) {
	if !isPublicPath("/plugins/workspace/remoteEntry.js") {
		t.Fatal("the front end must be public: the shell's loader has no token")
	}
	if isPublicPath("/api/v1/workspace/files/a1") {
		t.Fatal("the API must keep requiring a token")
	}
}
