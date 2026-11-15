// Runtime setting keys shared by the Agent Types (admin) and Agent Config (user)
// surfaces. Kept out of RuntimeSettingsFields.tsx so that file only exports a
// component (react-refresh requirement).

export type RuntimeSettings = Record<string, string>

export type RuntimeShape = {
  context?: string
  output?: string
  session_binding?: string
}

// applicableRuntimeKeys returns the runtime-setting keys that actually affect a
// definition of the given shape:
//   - session agents (stream + shared): runtime policy + summarizer/title knobs
//   - subagents (output=caller): the tool sandbox knobs
//   - context=recent types (e.g. role_title): the recent-message window
export function applicableRuntimeKeys(shape: RuntimeShape): string[] {
  const isSession = shape.output === 'stream' && shape.session_binding === 'shared'
  const isSubagent = shape.output === 'caller'
  const keys: string[] = []
  if (isSession || isSubagent) {
    keys.push('max_tool_result_chars', 'shell_timeout', 'restrict_to_workspace')
  }
  if (shape.context === 'recent') {
    keys.push('recent_messages')
  }
  if (isSession) {
    keys.push(
      'summarize_token_percent',
      'summarize_message_threshold',
      'title_refresh_messages',
      'memory_recent_days',
    )
  }
  return keys
}
