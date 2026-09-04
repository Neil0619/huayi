import type { ReactNode } from "react";
import {
  AccountSettingsNavigation,
  type AccountSettingsSection,
} from "./account-settings-navigation.js";

export function AccountSettingsLayout({
  active,
  children,
  showNavigation = true,
  showOperatorNavigation = false,
}: {
  readonly active: AccountSettingsSection;
  readonly children: ReactNode;
  readonly showNavigation?: boolean;
  readonly showOperatorNavigation?: boolean;
}) {
  return (
    <div className={showNavigation ? "account-settings-layout" : "account-settings-content-only"}>
      {showNavigation && (
        <AccountSettingsNavigation
          active={active}
          showOperatorNavigation={showOperatorNavigation}
        />
      )}
      <div className="account-settings-content">{children}</div>
    </div>
  );
}
