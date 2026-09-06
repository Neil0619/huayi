export function HostedAcceptanceNotice({
  commit,
  environment = "hosted-acceptance",
}: {
  readonly commit?: string | undefined;
  readonly environment?: "hosted-acceptance" | "production" | undefined;
}) {
  if (commit === undefined || environment !== "hosted-acceptance") return null;
  return (
    <aside className="acceptance-environment-notice" data-deployment-commit={commit} role="status">
      <strong>Hosted 验收 · {commit.slice(0, 7)}</strong>
      <span>真实托管验收环境；当前版本不是正式生产发布。</span>
    </aside>
  );
}
