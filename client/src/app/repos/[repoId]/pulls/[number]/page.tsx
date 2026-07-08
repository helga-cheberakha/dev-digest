/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + Lethal-Trifecta surfacing + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Smart Diff viewer (grouped files, finding markers, split nudge) in Files tab
   - Intent layer (in/out-of-scope chips)
   Mount points preserved for A3 (PR Brief) and A4 (Conformance link).
   Tab/drawer state lives in query (?tab, ?finding, ?compose, ?trace). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "../../../../../components/RepoNotFound";
import ComposeReviewDrawer from "./_components/ComposeReviewDrawer";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import WhyTimelineDrawer from "./_components/WhyTimelineDrawer";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import { ConformanceTab } from "./_components/ConformanceTab";
import { BlastTab } from "./_components/BlastTab";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, usePrIntent, useSmartDiff, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);
  const { data: intent } = usePrIntent(prId);
  const { data: smartDiff } = useSmartDiff(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const focusFindingId = search.get("finding");
  // AC-14 deep-link: `?file`/`?line` mirror the `?finding` pattern above —
  // a Brief review-focus/risk `file_ref` click switches to the Files tab and
  // sets both in ONE router.replace (see setParams/onOpenFile below) to
  // avoid the double-navigation `navigateToFinding` already guards against
  // (client/INSIGHTS.md 2026-06-25).
  const focusFilePath = search.get("file");
  const focusFileLineParam = search.get("line");
  const focusFile = React.useMemo(() => {
    if (!focusFilePath) return undefined;
    const parsed = focusFileLineParam != null ? Number(focusFileLineParam) : undefined;
    const line = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return { path: focusFilePath, line };
  }, [focusFilePath, focusFileLineParam]);
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);
  // Atomically set multiple params to avoid stale-closure overwrites.
  const setParams = (pairs: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(pairs)) {
      if (v == null) sp.delete(k); else sp.set(k, v);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  // AC-14: a Review-Focus/Risk `file_ref` click (Overview tab) switches to
  // Files changed and sets `?file`/`?line` in the SAME router.replace as the
  // tab switch (setParams), then DiffTab scrolls to + highlights it.
  const onOpenFile = (ref: { path: string; line?: number }) => {
    setParams({ tab: "diff", file: ref.path, line: ref.line != null ? String(ref.line) : null });
  };

  // Drawer state from query (?compose, ?trace=runId, ?why=file:line) — deep-linkable.
  const composeOpen = search.get("compose") != null;
  const traceRunId = search.get("trace");
  const whyParam = search.get("why");
  const whyLocation = React.useMemo(() => {
    if (!whyParam) return null;
    const i = whyParam.lastIndexOf(":");
    if (i < 0) return null;
    const file = whyParam.slice(0, i);
    const line = Number(whyParam.slice(i + 1));
    return file && Number.isFinite(line) ? { file, line } : null;
  }, [whyParam]);

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onComposeOpen={() => setParam("compose", "1")}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            prBody={pr.body}
            onOpenFile={onOpenFile}
            onGoToBlast={() => setTab("blast")}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            focusFindingId={focusFindingId}
            onFocusFinding={(id) => setParam("finding", id)}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its trace/logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            smartDiff={smartDiff}
            allFindings={allFindings}
            onNavigateToFinding={(id) => setParams({ tab: "findings", finding: id })}
            canComment={pr.status === "open"}
            focusFile={focusFile}
          />
        )}

        {tab === "conformance" && (
          <ConformanceTab prId={prId} prNumber={pr.number} />
        )}

        {tab === "blast" && (
          <BlastTab
            prId={prId}
            repoId={repoId}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
          />
        )}
      </div>

      {/* Drawers (deep-linkable via query params) */}
      {prId && composeOpen && (
        <ComposeReviewDrawer
          prId={prId}
          onClose={() => setParam("compose", null)}
          onPosted={() => refetch()}
        />
      )}
      {prId && traceRunId && (
        <RunTraceDrawer runId={traceRunId} prNumber={pr.number} onClose={() => setParam("trace", null)} />
      )}
      {prId && (
        <WhyTimelineDrawer prId={prId} location={whyLocation} onClose={() => setParam("why", null)} />
      )}
    </AppShell>
  );
}
