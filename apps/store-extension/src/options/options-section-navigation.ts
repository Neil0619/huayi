const SECTION_IDS = ["common", "credentials", "wordbooks", "lexicon"] as const;

type SectionId = (typeof SECTION_IDS)[number];

function navigationButton(id: SectionId): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-settings-nav='${id}']`);
  if (button === null) throw new Error(`Missing Store settings navigation item: ${id}`);
  return button;
}

function sections(id: SectionId): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-settings-section='${id}'], [data-settings-associated='${id}']`,
    ),
  );
}

function sectionAt(index: number): SectionId {
  const section = SECTION_IDS[index];
  if (section === undefined) throw new Error("Invalid Store settings navigation index.");
  return section;
}

export class OptionsSectionNavigation {
  private active: SectionId = "common";

  initialize(): void {
    for (const id of SECTION_IDS) {
      const button = navigationButton(id);
      button.addEventListener("click", () => this.select(id));
      button.addEventListener("keydown", (event) => this.handleKeydown(event, id));
    }
    this.render();
  }

  private handleKeydown(event: KeyboardEvent, current: SectionId): void {
    const currentIndex = SECTION_IDS.indexOf(current);
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? sectionAt((currentIndex + 1) % SECTION_IDS.length)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? sectionAt((currentIndex - 1 + SECTION_IDS.length) % SECTION_IDS.length)
          : event.key === "Home"
            ? sectionAt(0)
            : event.key === "End"
              ? sectionAt(SECTION_IDS.length - 1)
              : null;
    if (target === null) return;
    event.preventDefault();
    this.select(target);
    navigationButton(target).focus();
  }

  private select(id: SectionId): void {
    this.active = id;
    this.render();
  }

  private render(): void {
    for (const id of SECTION_IDS) {
      const selected = id === this.active;
      const button = navigationButton(id);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      for (const section of sections(id)) section.hidden = !selected;
    }
  }
}
