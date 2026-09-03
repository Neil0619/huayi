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
  return (
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
  );
}
