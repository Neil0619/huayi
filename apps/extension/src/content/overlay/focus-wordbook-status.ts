export function focusWordbookStatus(shadowRoot: ShadowRoot): void {
  const wordbookButton = shadowRoot.querySelector<HTMLButtonElement>("[data-action='add-word']");
  if (wordbookButton?.disabled === false) {
    wordbookButton.focus();
  } else {
    shadowRoot.querySelector<HTMLElement>(".huayi-wordbook")?.focus();
  }
}
