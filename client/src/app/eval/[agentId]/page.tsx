/* Route: /eval/:agentId — per-agent Eval Dashboard drill-down. Thin client
   wrapper reading the dynamic segment; all interactivity lives in
   _components/AgentEvalDetailView. */
"use client";

import { useParams } from "next/navigation";
import { AgentEvalDetailView } from "./_components/AgentEvalDetailView";

export default function AgentEvalDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <AgentEvalDetailView agentId={agentId} />;
}
