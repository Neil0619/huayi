export function WechatBindingPanel({ email }: { email: string }) {
  return (
    <section
      className="account-summary-card wechat-binding-card"
      aria-labelledby="wechat-binding-heading"
    >
      <h2 id="wechat-binding-heading">微信小程序关联</h2>
      <p>
        在小程序首次开通时选择“关联已有语见账号”，使用 {email}
        和语见登录密码，点击“登录并关联”即可。关联后，共用当前账号的学习数据与额度。
      </p>
      <p>已关联成功的账号，下次直接微信登录即可，无需在网页重复验证。</p>
      <p>
        此功能用于首次开通，不合并两个已有账号。仅使用 Google
        登录的账号，可先在上方添加密码登录方式。
      </p>
    </section>
  );
}
