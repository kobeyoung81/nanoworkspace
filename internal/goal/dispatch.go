package goal

import "strings"

// DispatchSessionID is the session a goal's rounds are written into.
//
// The shell hands the workspace the conversation *key* — `conversationKeyOf`
// strips the channel, so a conversation the browser knows as `web:<chat>` is
// stored as `<chat>`. Dispatching on that key opened a second session beside the
// one the reader is looking at: the round's transcript landed in `<chat>`, the
// reader's turns in `web:<chat>`, and the pane followed the completion's
// session id to the round's row — which is why the conversation's earlier
// messages disappeared and the round's own content showed up on its own.
//
// A key that already carries a channel (`web:<chat>`, or a session id with a
// version) is used as it is: those were created by a caller that knows the
// platform's id shape.
func DispatchSessionID(sessionKey, channel string) string {
	key := strings.TrimSpace(sessionKey)
	if key == "" {
		return key
	}
	if strings.Contains(key, ":") {
		return key
	}
	if channel == "" {
		channel = "web"
	}
	return channel + ":" + key
}
