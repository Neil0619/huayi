export function LocalAcceptanceNotice({ mode }: { readonly mode?: "simulated" | undefined }) {
  if (mode !== "simulated") return null;
  return (
    <aside className="acceptance-environment-notice" role="status">
      <strong>本机验收 · 模拟模型</strong>
      <span>结果不是 DeepSeek，只消耗本机测试额度，不产生外部费用。</span>
    </aside>
  );
}
