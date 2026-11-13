package server

// The workspace is a gate: it verifies the caller, decides whether this agent is
// theirs (or whether their role may look anyway), and puts the request on the
// container's tunnel. These tests pin exactly that, end to end over HTTP with a
// fake portal and a fake tunnel endpoint.

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/agents"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
	"github.com/golang-jwt/jwt/v5"
)

const testKID = "test-key"

func mintToken(t *testing.T, key *rsa.PrivateKey, sub, role string) string {
	t.Helper()
	claims := jwt.MapClaims{"sub": sub, "role": role, "exp": time.Now().Add(time.Hour).Unix()}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = testKID
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

// testServer wires the handler with a JWKS server, a portal that knows one
// agent, and one tunnel endpoint.
func testServer(t *testing.T, tunnelStatus int, tunnelBody string) (*httptest.Server, *rsa.PrivateKey, *[]nanoprotocol.TunnelRequest) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": testKID,
			"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
		}}})
	}))
	t.Cleanup(jwks.Close)

	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/internal/v1/agents/agent-1" {
			_, _ = w.Write([]byte(`{"agent":{"id":"agent-1","user_id":"alice"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(portal.Close)

	var seen []nanoprotocol.TunnelRequest
	tunnelSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tunnelStatus == http.StatusNotFound {
			http.NotFound(w, r)
			return
		}
		var req nanoprotocol.TunnelRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		seen = append(seen, req)
		_ = json.NewEncoder(w).Encode(nanoprotocol.TunnelResponse{
			RequestID: req.RequestID, Status: tunnelStatus, Body: []byte(tunnelBody),
		})
	}))
	t.Cleanup(tunnelSrv.Close)

	s := New(":0", auth.NewValidator(jwks.URL), agents.New(portal.URL, "token"), tunnel.New(tunnelSrv.URL, "", "token"), "")
	web := httptest.NewServer(s.srv.Handler)
	t.Cleanup(web.Close)
	return web, key, &seen
}

func do(t *testing.T, srv *httptest.Server, method, path, token string, body string) *http.Response {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, srv.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "text/plain")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestRequiresAToken(t *testing.T) {
	srv, _, _ := testServer(t, http.StatusOK, `{}`)
	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1", "", "").StatusCode; got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1", "garbage", "").StatusCode; got != http.StatusUnauthorized {
		t.Fatalf("garbage token: status = %d, want 401", got)
	}
}

func TestOwnerReadsTheirFiles(t *testing.T) {
	srv, key, seen := testServer(t, http.StatusOK, `{"entries":[]}`)
	token := mintToken(t, key, "alice", auth.RoleUser)

	resp := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1?path=notes", token, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if len(*seen) != 1 {
		t.Fatalf("the request never reached the tunnel: %+v", *seen)
	}
	req := (*seen)[0]
	if req.Method != http.MethodGet || req.Path != "/api/v1/files/agent-1?path=notes" {
		t.Fatalf("the forwarded request is wrong: %+v", req)
	}
}

func TestAnotherUserIsRefused(t *testing.T) {
	srv, key, seen := testServer(t, http.StatusOK, `{}`)
	token := mintToken(t, key, "bob", auth.RoleUser)

	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1", token, "").StatusCode; got != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", got)
	}
	if len(*seen) != 0 {
		t.Fatal("a refused request still reached the container")
	}
}

// TestManagerMayReadButNotWrite pins the portal's rule: Operations may inspect
// another user's workspace, but writes belong to the owner.
func TestManagerMayReadButNotWrite(t *testing.T) {
	srv, key, _ := testServer(t, http.StatusOK, `{}`)
	support := mintToken(t, key, "support-1", auth.RoleSupport)

	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1", support, "").StatusCode; got != http.StatusOK {
		t.Fatalf("read: status = %d, want 200", got)
	}
	if got := do(t, srv, http.MethodPut, "/api/user/v1/files/agent-1/content?path=x", support, "data").StatusCode; got != http.StatusForbidden {
		t.Fatalf("write: status = %d, want 403", got)
	}
}

func TestGitPathIsForwardedVerbatim(t *testing.T) {
	srv, key, seen := testServer(t, http.StatusOK, `{}`)
	token := mintToken(t, key, "alice", auth.RoleUser)

	resp := do(t, srv, http.MethodGet, "/api/user/v1/git/agent-1/status?path=repo", token, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	req := (*seen)[0]
	if req.Path != "/api/v1/git/agent-1/status?path=repo" {
		t.Fatalf("git path = %q", req.Path)
	}
}

func TestUnknownAgentIs404(t *testing.T) {
	srv, key, _ := testServer(t, http.StatusOK, `{}`)
	token := mintToken(t, key, "alice", auth.RoleUser)

	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-404", token, "").StatusCode; got != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", got)
	}
}

// TestOfflineContainerIs502: both endpoints answered "not here", so the caller
// gets the same failure the old bus path produced rather than a hang.
func TestOfflineContainerIs502(t *testing.T) {
	srv, key, _ := testServer(t, http.StatusNotFound, "")
	token := mintToken(t, key, "alice", auth.RoleUser)

	if got := do(t, srv, http.MethodGet, "/api/user/v1/files/agent-1", token, "").StatusCode; got != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", got)
	}
}

func TestUploadLimitIsEnforced(t *testing.T) {
	srv, key, seen := testServer(t, http.StatusOK, `{}`)
	token := mintToken(t, key, "alice", auth.RoleUser)

	big := strings.Repeat("x", maxFileBytes+1)
	if got := do(t, srv, http.MethodPut, "/api/user/v1/files/agent-1/content?path=big", token, big).StatusCode; got != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", got)
	}
	if len(*seen) != 0 {
		t.Fatal("an oversized upload reached the container")
	}
}

// TestCanonicalWorkspacePrefixServesTheSameSurface: /api/v1/workspace/… is the
// target-state prefix, where the path names the module that owns it. The
// historical /api/user/v1/… stays as an alias, and both put the same request on
// the container's tunnel.
func TestCanonicalWorkspacePrefixServesTheSameSurface(t *testing.T) {
	srv, key, seen := testServer(t, http.StatusOK, `{"entries":[]}`)
	token := mintToken(t, key, "alice", auth.RoleUser)

	if got := do(t, srv, http.MethodGet, "/api/v1/workspace/files/agent-1?path=notes", token, "").StatusCode; got != http.StatusOK {
		t.Fatalf("files: status = %d, want 200", got)
	}
	if got := do(t, srv, http.MethodGet, "/api/v1/workspace/git/agent-1/status?path=repo", token, "").StatusCode; got != http.StatusOK {
		t.Fatalf("git: status = %d, want 200", got)
	}
	if len(*seen) != 2 {
		t.Fatalf("requests that reached the tunnel = %d, want 2", len(*seen))
	}
	if got := (*seen)[0].Path; got != "/api/v1/files/agent-1?path=notes" {
		t.Fatalf("forwarded path = %q", got)
	}
	if got := (*seen)[1].Path; got != "/api/v1/git/agent-1/status?path=repo" {
		t.Fatalf("git path = %q", got)
	}
	if got := do(t, srv, http.MethodGet, "/api/v1/workspace/files/agent-1", "", "").StatusCode; got != http.StatusUnauthorized {
		t.Fatalf("canonical prefix without a token: status = %d, want 401", got)
	}
}
