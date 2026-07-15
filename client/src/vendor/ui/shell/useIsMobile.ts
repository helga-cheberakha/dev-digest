import React from "react";

const MOBILE_BREAKPOINT = 880;

/** True when the viewport is narrower than the sidebar-collapse breakpoint.
    SSR-safe: defaults to false (desktop layout) until mounted, then syncs to
    the real viewport via matchMedia. */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}
