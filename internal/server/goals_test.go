package server

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// TestGoalSurfaceNeedsAStore keeps the service honest before the database is
// attached: the endpoints answer 503 rather than panicking.
func TestGoalSurfaceNeedsAStore(t *testing.T) {
	s := &Server{}
	mux := http.NewServeMux()
	s.registerGoalRoutes(mux, "/api/v1/workspace")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace/goals", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// TestInternalTokenComparison covers the constant-time helper's two failure
// modes: an empty configured token never matches, and neither does an empty
// presented one.
func TestInternalTokenComparison(t *testing.T) {
	if internalTokenMatches("", "") {
		t.Error("two empty tokens must not match")
	}
	if internalTokenMatches("abc", "") {
		t.Error("an unconfigured token must not match anything")
	}
	if internalTokenMatches("", "abc") {
		t.Error("an empty presentation must not match")
	}
	if !internalTokenMatches("abc", "abc") {
		t.Error("equal tokens must match")
	}
	if internalTokenMatches("abd", "abc") {
		t.Error("different tokens must not match")
	}
}

// TestSessionKeyFilter is the root-cause fix for "a brand-new conversation shows
// another goal's progress": an empty key must mean "nothing", not "everything".
func TestSessionKeyFilter(t *testing.T) {
	cases := []struct {
		name string
		q    url.Values
		key  string
		mode int
	}{
		{"no parameter lists all", url.Values{}, "", listAllGoals},
		{"empty value lists none", url.Values{"session_key": {""}}, "", listNoGoals},
		{"blank value lists none", url.Values{"session_key": {"   "}}, "", listNoGoals},
		{"a key lists that session", url.Values{"session_key": {"web:abc"}}, "web:abc", listOneSession},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key, mode := sessionKeyFilter(tc.q)
			if key != tc.key || mode != tc.mode {
				t.Fatalf("sessionKeyFilter(%v) = %q/%d, want %q/%d", tc.q, key, mode, tc.key, tc.mode)
			}
		})
	}
}
