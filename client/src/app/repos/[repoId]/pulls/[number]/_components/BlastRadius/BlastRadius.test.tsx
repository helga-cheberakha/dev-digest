import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusView } from "./BlastRadius";

afterEach(cleanup);

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }],
      endpoints_affected: ["GET /public/data"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol · 1 downstream caller · 1 endpoint affected.",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("A3 BlastRadiusView (smoke)", () => {
  it("renders the tree with downstream caller + endpoint", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    // first node is open by default → caller + endpoint visible
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
    expect(screen.getByText("GET /public/data")).toBeInTheDocument();
  });

  it("switches to the graph view", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    fireEvent.click(screen.getByText("graph"));
    expect(screen.getByLabelText("Blast radius graph")).toBeInTheDocument();
  });

  it("graphs later symbols when the first downstream entry has no callers", () => {
    const blast: BlastRadius = {
      changed_symbols: [
        { name: "orphan", file: "src/a.ts", kind: "function" },
        { name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" },
      ],
      downstream: [
        { symbol: "orphan", callers: [], endpoints_affected: [], crons_affected: [] },
        {
          symbol: "rateLimit",
          callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }],
          endpoints_affected: ["GET /public/data"],
          crons_affected: [],
        },
      ],
      summary: "2 symbol(s) changed · 1 caller(s) · 1 endpoint(s) affected.",
    };
    renderWithIntl(<BlastRadiusView blast={blast} />);
    fireEvent.click(screen.getByText("graph"));
    expect(screen.getByLabelText("Blast radius graph")).toBeInTheDocument();
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    expect(screen.getByText("handler")).toBeInTheDocument();
    expect(screen.getByText("GET /public/data")).toBeInTheDocument();
    // symbol with nothing downstream is omitted; empty state must not show
    expect(screen.queryByText("orphan()")).not.toBeInTheDocument();
    expect(screen.queryByText("No downstream impact to graph.")).not.toBeInTheDocument();
  });

  it("renders the empty summary when nothing changed", () => {
    renderWithIntl(
      <BlastRadiusView
        blast={{ changed_symbols: [], downstream: [], summary: "No top-level symbols changed." }}
      />,
    );
    expect(screen.getByText("No top-level symbols changed.")).toBeInTheDocument();
  });
});
