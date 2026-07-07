/* Onboarding Tour page — /repos/:repoId/onboarding.
   Thin "use client" wrapper; all interactive logic lives in
   _components/OnboardingTourView. This follows the same pattern as
   repos/[repoId]/conventions/page.tsx. */
"use client";

import { useParams } from "next/navigation";
import { OnboardingTourView } from "./_components/OnboardingTourView/OnboardingTourView";

export default function OnboardingTourPage() {
  const { repoId } = useParams<{ repoId: string }>();
  return <OnboardingTourView repoId={repoId} />;
}
