import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function HelpTip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const suppressFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const close = () => {
    pinned.current = false;
    setOpen(false);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!pinned.current) setOpen(false);
    }, 120);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open) return;
      close();
      suppressFocus.current = true;
      button.current?.focus();
      suppressFocus.current = false;
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !button.current?.contains(event.target) &&
        !tip.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !tip.current || !button.current) return;
    tip.current.showPopover?.();
    const anchor = button.current.getBoundingClientRect();
    tip.current.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - tip.current.offsetWidth - 12))}px`;
    tip.current.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - tip.current.offsetHeight - 12))}px`;
  }, [open]);
  return (
    <span className="help-tip">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => {
          clearTimeout(timer.current);
          setOpen(true);
        }}
        onPointerLeave={leave}
        onFocus={() => {
          if (!suppressFocus.current) setOpen(true);
        }}
        onBlur={leave}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            ref={tip}
            id={id}
            className="help-tip-content"
            role="tooltip"
            popover="manual"
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={leave}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
