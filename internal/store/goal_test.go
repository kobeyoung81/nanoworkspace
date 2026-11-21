package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
)

// testStore opens a throwaway database and applies the manifests.
//
// Like nanoartifacts' store tests, this is skipped unless the URI is exported:
// the unit suite must run without a database, and the integration run gets one
// by setting NANOSEC_WORKSPACE_MONGO_URI.
func testStore(t *testing.T) *Store {
	t.Helper()
	uri := os.Getenv("NANOSEC_WORKSPACE_MONGO_URI")
	if uri == "" {
		t.Skip("NANOSEC_WORKSPACE_MONGO_URI not set")
	}
	u, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse uri: %v", err)
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	u.Path = "/workspace_test_" + hex.EncodeToString(b[:])

	st, err := Open(context.Background(), u.String())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DB().Drop(context.Background())
		_ = st.Close(context.Background())
	})
	manifests, err := manifestsForTest()
	if err != nil {
		t.Fatalf("manifests: %v", err)
	}
	if _, err := st.Migrate(manifests); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}

func newGoal(userID, id string) *Goal {
	return &Goal{
		ID:         id,
		UserID:     userID,
		AgentID:    "architect-83540114",
		Channel:    "web",
		ChatID:     "chat-1",
		SessionKey: "web:chat-1",
		Origin:     "manual",
		Title:      "migrate auth",
		Condition:  "no OldToken left",
		Constraints: []string{
			"do not change public signatures",
		},
		Mode:      "build",
		Status:    goal.Draft,
		MaxRounds: 40,
	}
}

// TestCreate_GetAndDuplicate covers the create/read pair and the uniqueness the
// short id depends on.
func TestCreate_GetAndDuplicate(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	g := newGoal("u1", "g_1")
	if err := st.Create(ctx, g); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := st.Get(ctx, "u1", "g_1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Condition != g.Condition || got.Status != goal.Draft {
		t.Errorf("round trip lost fields: %+v", got)
	}

	if err := st.Create(ctx, newGoal("u1", "g_1")); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate create = %v, want ErrDuplicate", err)
	}
	// Another user may reuse the short id: uniqueness is per user.
	if err := st.Create(ctx, newGoal("u2", "g_1")); err != nil {
		t.Fatalf("second user create: %v", err)
	}

	// A goal belonging to someone else is missing, not forbidden.
	if _, err := st.Get(ctx, "u2", "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown goal = %v, want ErrNotFound", err)
	}
}

// TestClaimRound_SecondClaimLoses is the idempotency the scheduler relies on:
// the same round can only be dispatched once while the claim is live, and
// becomes claimable again when it expires.
func TestClaimRound_SecondClaimLoses(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	g := newGoal("u1", "g_1")
	g.Status = goal.Running
	g.Round = 3
	if err := st.Create(ctx, g); err != nil {
		t.Fatalf("create: %v", err)
	}

	now := time.Now().UTC()
	ok, err := st.ClaimRound(ctx, "u1", "g_1", 3, now, time.Minute)
	if err != nil || !ok {
		t.Fatalf("first claim = %v, %v; want true", ok, err)
	}
	ok, err = st.ClaimRound(ctx, "u1", "g_1", 3, now.Add(time.Second), time.Minute)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if ok {
		t.Fatal("a live claim must not be taken twice")
	}
	// A stale claim is taken over: the first dispatcher died.
	ok, err = st.ClaimRound(ctx, "u1", "g_1", 3, now.Add(2*time.Minute), time.Minute)
	if err != nil || !ok {
		t.Fatalf("expired claim = %v, %v; want true", ok, err)
	}
	// Another round is a different claim.
	ok, err = st.ClaimRound(ctx, "u1", "g_1", 4, now, time.Minute)
	if err != nil {
		t.Fatalf("wrong-round claim: %v", err)
	}
	if ok {
		t.Fatal("round 4 must not be claimable while the goal is at round 3")
	}
}

// TestSetStatus_GuardsTheTable pins that the store refuses what the state
// machine refuses, and that a lost race is reported as a conflict.
func TestSetStatus_GuardsTheTable(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	g := newGoal("u1", "g_1")
	g.Status = goal.Running
	if err := st.Create(ctx, g); err != nil {
		t.Fatalf("create: %v", err)
	}

	err := st.SetStatus(ctx, "u1", "g_1", []goal.Status{goal.Running}, goal.Paused, goal.PauseUser, "user paused", time.Now().UTC())
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	got, _ := st.Get(ctx, "u1", "g_1")
	if got.Status != goal.Paused || got.NextRoundAt != nil {
		t.Fatalf("pause did not stop the schedule: %+v", got)
	}

	// The same transition again no longer matches: the goal is paused, not
	// running, so the caller sees a conflict rather than a silent no-op.
	err = st.SetStatus(ctx, "u1", "g_1", []goal.Status{goal.Running}, goal.Cancelling, "", "", time.Now().UTC())
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale transition = %v, want ErrConflict", err)
	}
	// An edge the table does not contain is refused before the database.
	err = st.SetStatus(ctx, "u1", "g_1", []goal.Status{goal.Paused}, goal.Achieved, "", "", time.Now().UTC())
	if !errors.Is(err, goal.ErrIllegalTransition) {
		t.Fatalf("paused → achieved = %v, want ErrIllegalTransition", err)
	}
	// A pause without a reason is refused as well.
	err = st.SetStatus(ctx, "u1", "g_1", []goal.Status{goal.Paused}, goal.Paused, "", "", time.Now().UTC())
	if !errors.Is(err, goal.ErrPauseReason) {
		t.Fatalf("pause without a reason = %v, want ErrPauseReason", err)
	}
}

// TestAppendRound_KeepsTheSummaryAndClearsTheClaim covers the write that ends a
// round: the summary is stored, and the claim is released in the same write.
func TestAppendRound_KeepsTheSummaryAndClearsTheClaim(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	g := newGoal("u1", "g_1")
	g.Status = goal.Running
	g.Round = 1
	if err := st.Create(ctx, g); err != nil {
		t.Fatalf("create: %v", err)
	}
	now := time.Now().UTC()
	if ok, err := st.ClaimRound(ctx, "u1", "g_1", 1, now, time.Minute); err != nil || !ok {
		t.Fatalf("claim: %v", err)
	}
	err := st.AppendRound(ctx, "u1", "g_1",
		Round{N: 1, Verdict: "not_yet", Files: 2, At: now},
		"not_yet", "four call sites left", now)
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	got, _ := st.Get(ctx, "u1", "g_1")
	if len(got.Rounds) != 1 || got.Rounds[0].Verdict != "not_yet" {
		t.Fatalf("round summary missing: %+v", got.Rounds)
	}
	if got.LastVerdict != "not_yet" || got.LastReason != "four call sites left" {
		t.Errorf("verdict not recorded: %+v", got)
	}
	if got.ClaimedAt != nil {
		t.Error("the claim must be released by the same write")
	}
}

// TestListByUser_NewestFirst covers the panel's first page.
func TestListByUser_NewestFirst(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	for _, id := range []string{"g_1", "g_2"} {
		if err := st.Create(ctx, newGoal("u1", id)); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	if err := st.Create(ctx, newGoal("u2", "g_9")); err != nil {
		t.Fatalf("create other user: %v", err)
	}

	goals, err := st.ListByUser(ctx, "u1", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(goals) != 2 {
		t.Fatalf("listed %d goals for u1, want 2", len(goals))
	}
	if goals[0].ID != "g_2" {
		t.Errorf("newest first: got %s first", goals[0].ID)
	}
}
