// The rows this page shows.
//
// The agents belong to the portal (`GET /api/user/v1/me/agents`); the bytes belong
// to the agent container and are reached through the workspace API. This module
// renders the first and routes the second, so the types live here.

export type AgentSummary = {
  id: string
  user_id: string
  display_name: string
  model: string
  status: string
  tools: string[]
}
