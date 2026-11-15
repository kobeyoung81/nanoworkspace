// The agent row's copy of the conversation dots: the union of this agent's
// conversations, so an agent whose conversation needs the user is visible from
// the agent list alone — which is the only place a phone can see it while
// looking at another agent.

import { useWorkbench } from '../../workbench/context'
import { agentAttention } from '../../conversations/attention'
import { AttentionDots } from './AttentionDots'

export function AgentAttentionDots({ agentId }: { agentId: string }) {
  const { attention } = useWorkbench()
  const { running, awaiting, unread } = agentAttention(attention, agentId)
  return <AttentionDots running={running} awaiting={awaiting} unread={unread} />
}
