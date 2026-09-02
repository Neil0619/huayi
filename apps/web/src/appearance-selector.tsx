import { useId, type KeyboardEvent } from "react";

import { WEB_APPEARANCES, type WebAppearance } from "./web-appearance.js";

export const appearanceLabels: Readonly<Record<WebAppearance, string>> = {
  champagne: "香槟晨霜",
  moon: "去青月白",
  porcelain: "霁蓝瓷光",
  silver: "流银镜白",
};

function keyboardDestination(key: string, currentIndex: number): number | undefined {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1) % WEB_APPEARANCES.length;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + WEB_APPEARANCES.length) % WEB_APPEARANCES.length;
  }
  if (key === "Home") return 0;
  if (key === "End") return WEB_APPEARANCES.length - 1;
  return undefined;
}

export function AppearanceSelector({
  onChange,
  value,
}: {
  readonly onChange: (appearance: WebAppearance) => void;
  readonly value: WebAppearance;
}) {
  const groupName = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, currentIndex: number) => {
    const destination = keyboardDestination(event.key, currentIndex);
    if (destination === undefined) return;
    event.preventDefault();
    const appearance = WEB_APPEARANCES[destination];
    if (appearance === undefined) return;
    const radios = event.currentTarget
      .closest("fieldset")
      ?.querySelectorAll<HTMLInputElement>("input[type='radio']");
    radios?.[destination]?.focus();
    onChange(appearance);
  };

  return (
    <fieldset className="appearance-selector">
      <legend>外观</legend>
      <div className="appearance-options">
        {WEB_APPEARANCES.map((appearance, index) => {
          const id = `${groupName}-${appearance}`;
          return (
            <label data-appearance-option={appearance} htmlFor={id} key={appearance}>
              <input
                checked={appearance === value}
                id={id}
                name={`${groupName}-appearance`}
                onChange={(event) => {
                  if (event.currentTarget.checked) onChange(appearance);
                }}
                onKeyDown={(event) => handleKeyDown(event, index)}
                tabIndex={appearance === value ? 0 : -1}
                type="radio"
                value={appearance}
              />
              <span>{appearanceLabels[appearance]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
