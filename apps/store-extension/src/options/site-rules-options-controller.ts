import {
  normalizeStoreSiteRule,
  sameStoreSiteRule,
  STORE_SITE_RULE_LIMIT,
  type StoreSettings,
  type StoreSettingsRepository,
  type StoreSiteRule,
} from "@huayi/store-domain";

import { UserFacingError } from "./options-errors.js";

const PAGE_SIZE = 20;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing site management element: ${selector}`);
  return found;
}

interface Dependencies {
  readonly settings: StoreSettingsRepository;
  readonly execute: (operation: () => Promise<void>) => void;
  readonly refresh: () => Promise<void>;
}

export class SiteRulesOptionsController {
  private rules: StoreSiteRule[] = [];
  private page = 0;
  private busy = false;
  private editing: StoreSiteRule | undefined;

  constructor(private readonly dependencies: Dependencies) {}

  bind(): void {
    element("[data-site-rule-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      this.dependencies.execute(async () => {
        let rule: StoreSiteRule;
        try {
          rule = this.formRule();
        } catch {
          throw new UserFacingError(
            "请输入有效域名；IP 和 localhost 仅支持精确匹配，不能关闭公共后缀下的全部网站。",
          );
        }
        const exists = this.rules.some(
          (current) =>
            current.hostname === rule.hostname &&
            current.includeSubdomains === rule.includeSubdomains,
        );
        if (!this.editing && !exists && this.rules.length >= STORE_SITE_RULE_LIMIT) {
          throw new UserFacingError(
            `最多保存 ${STORE_SITE_RULE_LIMIT} 条规则，请先删除不需要的规则。`,
          );
        }
        await this.dependencies.settings.upsertSiteRule(rule, this.editing);
        this.resetForm();
        await this.dependencies.refresh();
      });
    });
    for (const selector of [
      "[data-site-rule-host]",
      "[data-site-rule-scope]",
      "[data-site-rule-action]",
    ]) {
      element(selector).addEventListener("input", () => this.preview());
      element(selector).addEventListener("change", () => this.preview());
    }
    for (const selector of ["[data-site-rule-search]", "[data-site-rule-filter]"]) {
      element(selector).addEventListener("input", () => {
        this.page = 0;
        this.renderList();
      });
    }
    element("[data-site-rule-cancel]").addEventListener("click", () => this.resetForm());
    element("[data-site-rule-prev]").addEventListener("click", () => {
      this.page--;
      this.renderList();
    });
    element("[data-site-rule-next]").addEventListener("click", () => {
      this.page++;
      this.renderList();
    });
    this.preview();
  }

  render(settings: StoreSettings | null, busy: boolean): void {
    this.rules = settings?.sitePolicy.rules ?? [];
    this.busy = busy;
    this.renderList();
  }

  private formRule(): StoreSiteRule {
    return normalizeStoreSiteRule(
      {
        action:
          element<HTMLSelectElement>("[data-site-rule-action]").value === "allow"
            ? "allow"
            : "block",
        hostname: element<HTMLInputElement>("[data-site-rule-host]").value,
        includeSubdomains:
          element<HTMLSelectElement>("[data-site-rule-scope]").value === "subdomains",
      },
      (value) => new URL(value),
    );
  }

  private preview(): void {
    const preview = element("[data-site-rule-preview]");
    try {
      const rule = this.formRule();
      preview.textContent = `${rule.action === "block" ? "关闭" : "单独开启"}：${rule.hostname}${rule.includeSubdomains ? " 及所有子域名" : "（仅此域名）"}`;
    } catch {
      preview.textContent = element<HTMLInputElement>("[data-site-rule-host]").value
        ? "请检查域名与匹配范围。"
        : "";
    }
  }

  private resetForm(): void {
    this.editing = undefined;
    element<HTMLFormElement>("[data-site-rule-form]").reset();
    element("[data-site-rule-save]").textContent = "添加规则";
    element("[data-site-rule-cancel]").hidden = true;
    this.preview();
  }

  private renderList(): void {
    const query = element<HTMLInputElement>("[data-site-rule-search]").value.trim().toLowerCase();
    const filter = element<HTMLSelectElement>("[data-site-rule-filter]").value;
    const rules = this.rules.filter(
      (rule) => rule.hostname.includes(query) && (filter === "all" || rule.action === filter),
    );
    const pages = Math.ceil(rules.length / PAGE_SIZE);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const list = element("[data-site-rules]");
    list.replaceChildren(
      ...rules
        .slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)
        .map((rule) => this.row(rule)),
    );
    if (rules.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = query || filter !== "all" ? "没有匹配的网站规则。" : "还没有网站规则。";
      list.append(empty);
    }
    element("[data-site-rule-count]").textContent =
      `${rules.length} 条${rules.length !== this.rules.length ? ` / 共 ${this.rules.length} 条` : "规则"}`;
    element("[data-site-rule-page]").textContent = `${this.page + 1} / ${Math.max(1, pages)}`;
    element("[data-site-rule-pagination]").hidden = pages <= 1;
    element<HTMLButtonElement>("[data-site-rule-prev]").disabled = this.busy || this.page === 0;
    element<HTMLButtonElement>("[data-site-rule-next]").disabled =
      this.busy || this.page + 1 >= pages;
  }

  private row(rule: StoreSiteRule): HTMLLIElement {
    const row = document.createElement("li");
    row.dataset.siteRuleRow = "";
    const copy = document.createElement("div");
    const host = document.createElement("strong");
    host.textContent = rule.hostname;
    const scope = document.createElement("span");
    scope.className = "site-rule-scope";
    scope.textContent = `${rule.action === "block" ? "关闭" : "单独开启"} · ${rule.includeSubdomains ? "包含所有子域名" : "仅此域名"}`;
    copy.append(host, scope);
    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.siteRuleEdit = "";
    edit.textContent = "修改";
    edit.disabled = this.busy;
    edit.addEventListener("click", () => {
      this.editing = rule;
      element<HTMLInputElement>("[data-site-rule-host]").value = rule.hostname;
      element<HTMLSelectElement>("[data-site-rule-scope]").value = rule.includeSubdomains
        ? "subdomains"
        : "exact";
      element<HTMLSelectElement>("[data-site-rule-action]").value = rule.action;
      element("[data-site-rule-save]").textContent = "保存修改";
      element("[data-site-rule-cancel]").hidden = false;
      this.preview();
      element("[data-site-rule-host]").focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.siteRuleDelete = "";
    remove.textContent = "删除规则";
    remove.disabled = this.busy;
    remove.addEventListener("click", () =>
      this.dependencies.execute(async () => {
        await this.dependencies.settings.removeSiteRule(rule);
        if (this.editing && sameStoreSiteRule(this.editing, rule)) this.resetForm();
        await this.dependencies.refresh();
      }),
    );
    actions.append(edit, remove);
    row.append(copy, actions);
    return row;
  }
}
