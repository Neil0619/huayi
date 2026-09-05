let nextHelpId = 0;

export function bindPageHelp(root: ParentNode): () => void {
  const disposers: (() => void)[] = [];
  for (const note of root.querySelectorAll<HTMLElement>("[data-help-note]")) {
    if (note.dataset.helpBound === "true") continue;
    note.dataset.helpBound = "true";
    const wrapper = document.createElement("span");
    wrapper.className = "help-tip";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.helpToggle = "";
    button.textContent = "?";
    button.setAttribute("aria-label", note.dataset.helpNote ?? "查看说明");
    button.setAttribute("aria-expanded", "false");
    note.id = `page-help-${++nextHelpId}`;
    button.setAttribute("aria-controls", note.id);
    button.setAttribute("aria-describedby", note.id);
    note.className = "help-content";
    note.setAttribute("role", "tooltip");
    note.setAttribute("popover", "manual");
    note.hidden = true;
    const heading =
      note.closest(".field")?.querySelector("span") ??
      note.previousElementSibling?.querySelector("h2, h3") ??
      note.previousElementSibling;
    if (heading?.matches("h2, h3, span")) heading.append(wrapper);
    else note.before(wrapper);
    wrapper.append(button, note);
    let pinned = false;
    let suppressFocus = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      clearTimeout(timer);
      pinned = false;
      if (!note.hidden) note.hidePopover?.();
      note.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      clearTimeout(timer);
      if (suppressFocus) return;
      note.hidden = false;
      note.showPopover?.();
      button.setAttribute("aria-expanded", "true");
      const anchor = button.getBoundingClientRect();
      const box = note.getBoundingClientRect();
      note.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
      note.style.top = `${Math.max(8, anchor.bottom + box.height + 8 > window.innerHeight ? anchor.top - box.height - 6 : anchor.bottom + 6)}px`;
    };
    const leave = () => {
      if (!pinned && document.activeElement !== button) timer = setTimeout(close, 120);
    };
    const click = (event: Event) => {
      event.preventDefault();
      if (pinned) close();
      else {
        pinned = true;
        open();
      }
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !wrapper.contains(event.target)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || note.hidden) return;
      event.preventDefault();
      close();
      suppressFocus = true;
      button.focus();
      suppressFocus = false;
    };
    button.addEventListener("click", click);
    button.addEventListener("pointerenter", open);
    button.addEventListener("pointerleave", leave);
    button.addEventListener("focus", open);
    button.addEventListener("blur", leave);
    note.addEventListener("pointerenter", open);
    note.addEventListener("pointerleave", leave);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", close);
    disposers.push(() => {
      close();
      button.removeEventListener("click", click);
      button.removeEventListener("pointerenter", open);
      button.removeEventListener("pointerleave", leave);
      button.removeEventListener("focus", open);
      button.removeEventListener("blur", leave);
      note.removeEventListener("pointerenter", open);
      note.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", close);
    });
  }
  return () => disposers.forEach((dispose) => dispose());
}
