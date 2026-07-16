import React from "react";
import type { ShellContext, Crumb } from "./types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useIsMobile } from "./useIsMobile";

export function AppFrame({
  ctx,
  crumb,
  children,
}: {
  ctx: ShellContext;
  crumb?: Crumb[];
  children?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // Auto-close the mobile nav after a route change — activeKey is derived
  // from the pathname (see useShellContext), so it changes on every navigation.
  const prevActiveKey = React.useRef(ctx.activeKey);
  React.useEffect(() => {
    if (prevActiveKey.current !== ctx.activeKey) {
      prevActiveKey.current = ctx.activeKey;
      setMobileNavOpen(false);
    }
  }, [ctx.activeKey]);

  // Below the breakpoint, the sidebar never occupies layout space — it's an
  // off-canvas overlay toggled by the Topbar's hamburger button, else a fixed
  // 264px sidebar (Sidebar.tsx) would leave ~2/3 of a phone viewport unusable
  // on every single page (confirmed identically broken pre-fix).
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        minHeight: "100vh",
        background: "var(--bg-primary)",
        alignItems: "stretch",
      }}
    >
      {isMobile ? (
        <>
          {mobileNavOpen && (
            <div
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 49 }}
            />
          )}
          <div
            style={{
              position: "fixed",
              top: 0,
              bottom: 0,
              left: 0,
              zIndex: 50,
              transform: mobileNavOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform .2s ease",
            }}
          >
            <Sidebar ctx={ctx} />
          </div>
        </>
      ) : (
        <Sidebar ctx={ctx} />
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar
          ctx={ctx}
          crumb={crumb}
          isMobile={isMobile}
          onOpenMobileNav={isMobile ? () => setMobileNavOpen(true) : undefined}
        />
        <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
