/* Route: /multi-agent/configure
   Server-component shell that reads ?prId from the URL (set by the PR-page
   picker's "Configure agents…" link in T3) and passes it to the interactive
   client view. */
import { ConfigureRunView } from "./_components/ConfigureRunView";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConfigureRunPage({ searchParams }: Props) {
  const params = await searchParams;
  const prId = typeof params.prId === "string" ? params.prId : undefined;
  return <ConfigureRunView initialPrId={prId} />;
}
