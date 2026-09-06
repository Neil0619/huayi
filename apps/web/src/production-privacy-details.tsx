export const productionPrivacyNotice = {
  effectiveDate: "2026-09-06",
  maintainer: "Neil",
  contact: "niu0619@gmail.com",
  backupRetention:
    "当前使用 Supabase Free，未启用时间点恢复，也未建立语见自行保存的离线备份。供应商的灾难恢复副本按其数据处理协议管理；账号删除不等于终止托管合同。语见不承诺供应商全部备份副本的固定清除天数，也不提供这些副本的逐账号恢复。",
} as const;

export function ProductionPrivacyContact() {
  return (
    <a href={`mailto:${productionPrivacyNotice.contact}`}>{productionPrivacyNotice.contact}</a>
  );
}

export function ProductionPrivacyDetails() {
  return (
    <aside className="privacy-callout" aria-labelledby="production-privacy-title">
      <h2 id="production-privacy-title">维护者与服务范围</h2>
      <p>
        本服务由 {productionPrivacyNotice.maintainer} 维护，供本人及受邀朋友进行非商业英语学习。
        隐私、账号删除和安全问题请联系 <ProductionPrivacyContact />。 正式站为
        app.seen-said.cn；测试站使用独立账号和数据。本扩展通过手动加载使用，尚未发布到 Chrome Web
        Store。
      </p>
      <p>
        数据库、身份服务和私有导出存储部署于 Supabase 新加坡区域，API 运行于 Vercel 新加坡区域。 Web
        静态资源通过 Vercel 全球网络分发。系统邮件由 Resend 发送，发件域选择东京区域；
        邮件还会经过收件人的邮件服务。平台模型由 DeepSeek 处理，第三方服务可能涉及跨境传输。
      </p>
      <p>
        本服务不面向儿童。未成年人如需使用，请先由监护人联系维护者。隐私请求与争议可先通过上述
        邮箱联系；本说明不限制适用法律赋予你的权利，也不限制向有权机构寻求处理。
      </p>
      <p>
        供应商说明：
        <a
          href="https://supabase.com/legal/customer-resources/data-processing-addendum"
          rel="external noreferrer"
        >
          Supabase 数据处理协议
        </a>
        、
        <a href="https://supabase.com/docs/guides/platform/backups" rel="external noreferrer">
          备份规则
        </a>
        、
        <a href="https://vercel.com/legal/privacy-policy" rel="external noreferrer">
          Vercel 隐私政策
        </a>
        、
        <a href="https://resend.com/legal/privacy-policy" rel="external noreferrer">
          Resend 隐私政策
        </a>
        、
        <a
          href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html"
          rel="external noreferrer"
        >
          DeepSeek 隐私政策
        </a>
        。
      </p>
    </aside>
  );
}
