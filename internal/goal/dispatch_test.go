package goal

import "testing"

// TestDispatchSessionID pins the one id a goal's rounds may be written into.
//
// The shell stores the conversation key (no channel); the browser's session is
// `web:<chat>`. Dispatching on the key wrote the rounds into a second session,
// so the reader's own messages vanished from the transcript while the round's
// appeared.
func TestDispatchSessionID(t *testing.T) {
	cases := []struct{ key, channel, want string }{
		{"fa010c9a", "web", "web:fa010c9a"},
		{"fa010c9a", "", "web:fa010c9a"},
		{"web:fa010c9a", "web", "web:fa010c9a"},
		{"web:fa010c9a:v2", "web", "web:fa010c9a:v2"},
		{"  fa010c9a  ", "web", "web:fa010c9a"},
		{"", "web", ""},
	}
	for _, c := range cases {
		if got := DispatchSessionID(c.key, c.channel); got != c.want {
			t.Errorf("DispatchSessionID(%q, %q) = %q, want %q", c.key, c.channel, got, c.want)
		}
	}
}
