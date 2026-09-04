import { useEffect, useState } from "react";

export type AccountSettingsSection = "account" | "data" | "devices";

const items = [
  { href: "/settings/account", label: "账号与用量", section: "account" },
  { href: "/settings/devices", label: "扩展设备", section: "devices" },
  { href: "/settings/data", label: "数据与账号", section: "data" },
] as const;

export function AccountSettingsNavigation({
  active,
  showOperatorNavigation = false,
}: {
  readonly active: AccountSettingsSection;
  readonly showOperatorNavigation?: boolean | undefined;
}) {
  const [open, setOpen] = useState(
    () => typeof matchMedia !== "function" || !matchMedia("(max-width: 48rem)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 48rem)");
    const update = () => setOpen(!media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <details
      className="account-settings-disclosure"
      open={open}
      onToggle={(event) => {
        if (typeof matchMedia === "function" && matchMedia("(max-width: 48rem)").matches)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>设置 · {items.find((item) => item.section === active)?.label}</summary>
      <nav aria-label="账号设置" className="account-settings-nav">
        {items.map((item) => (
          <a
            aria-current={active === item.section ? "page" : undefined}
            href={item.href}
            key={item.section}
          >
            {item.label}
          </a>
        ))}
        {showOperatorNavigation && <a href="/admin">运营控制台</a>}
      </nav>
    </details>
  );
}
