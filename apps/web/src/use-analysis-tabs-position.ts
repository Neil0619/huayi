import { useEffect, type RefObject } from "react";

/** Account for the wrapping mobile header and the optional Hosted notice. */
export function useAnalysisTabsPosition(
  container: RefObject<HTMLDivElement | null>,
  visible: boolean,
) {
  useEffect(() => {
    const element = container.current;
    const topbar = document.querySelector<HTMLElement>(".app-shell > .topbar");
    if (!visible || !element || !topbar) return;
    const update = () => {
      const top = Number.parseFloat(getComputedStyle(topbar).top) || 0;
      element.style.setProperty(
        "--analysis-tabs-top",
        `${top + topbar.getBoundingClientRect().height + 8}px`,
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(topbar);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [container, visible]);
}
