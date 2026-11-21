package server

import (
	"net/http"
	"net/http/httptest"
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
