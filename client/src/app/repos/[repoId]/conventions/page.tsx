"use client";

import { useParams } from "next/navigation";
import { ConventionsView } from "./_components/ConventionsView/ConventionsView";

export default function ConventionsPage() {
  const { repoId } = useParams<{ repoId: string }>();
  return <ConventionsView repoId={repoId} />;
}
