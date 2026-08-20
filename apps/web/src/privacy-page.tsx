const POLICY_LINKS = [
  {
    href: "https://developer.chrome.com/docs/webstore/program-policies/privacy",
    label: "Chrome Web Store Privacy Policies",
  },
  {
    href: "https://developer.chrome.com/docs/webstore/user_data",
    label: "Chrome Web Store User Data Policy",
  },
  {
    href: "https://developer.chrome.com/docs/webstore/program-policies/limited-use/",
    label: "Chrome Web Store Limited Use",
  },
] as const;

export interface PrivacyNotice {
  effectiveDate: string;
  releaseStatus: "pre-release";
}

export const privacyNotice: PrivacyNotice = {
  effectiveDate: "2026-08-13",
  releaseStatus: "pre-release",
};

export function PrivacyPage() {
  return (
    <div className="privacy-page">
      <a className="skip-link" href="#privacy-content">
        跳到隐私说明
      </a>
      <header className="privacy-header">
        <a className="privacy-brand" href="/login">
          <span aria-hidden="true" className="brand-mark" />
          <span>
            <strong>语见</strong>
            <small>Seen &amp; Said</small>
          </span>
        </a>
        <a href="/login">返回登录</a>
      </header>

      <main id="privacy-content">
        <article className="privacy-notice">
          <header className="privacy-title">
            <p className="eyebrow">PUBLIC TRUST · PRE-RELEASE</p>
            <h1>语见 Cloud V1 隐私说明</h1>
            <p className="privacy-status" role="status">
              预发布隐私说明 · 最后更新 {privacyNotice.effectiveDate}
            </p>
            <p>
              语见帮助中文英语学习者理解主动选择的英文，并把用户主动提交的结果连接到同一学习、整理与
              练习闭环。本页说明当前实现事实，不代表产品已经公开发布或通过 Chrome Web Store 审核。
            </p>
          </header>

          <aside className="privacy-callout" aria-labelledby="prerelease-title">
            <h2 id="prerelease-title">正式发布前仍需补齐</h2>
            <p>
              运营主体、联系方式、实际部署区域和备份残留期限仍待真实环境与发布责任人确认。语见不会
              用占位值或猜测数字伪装正式政策；这些事实补齐前不会开放邀请或提交商店。
            </p>
            <p>未成年人适用规则、适用法律和争议处理方式也必须在正式发布前由责任人确认。</p>
          </aside>

          <section aria-labelledby="data-title">
            <h2 id="data-title">我们处理的数据</h2>
            <ul>
              <li>账号资料：邮箱、Google 基础身份、邀请状态、设备标签和安全会话元数据。</li>
              <li>
                学习内容：主动选择的英文与必要上下文、可选来源标题、模型分析、候选、单词、表达、
                句型、标签、练习题、回答、对话、反馈和自评。
              </li>
              <li>
                使用资料：模型与 schema 版本、模型 token 计数、费用、时延、稳定错误码和额度状态。
              </li>
              <li>账号数据导出：用户显式请求时生成的私有、限时完整账号导出对象。</li>
            </ul>
            <p>
              语见不会自动收集 URL、页面标题、完整网页、浏览历史或视频 ID；来源标题只能由用户填写或
              受信的固定来源类型提供。
            </p>
          </section>

          <section aria-labelledby="recipients-title">
            <h2 id="recipients-title">用途与接收方</h2>
            <ul>
              <li>
                语见 API 接收用户主动提交的 Web 分析与练习、StudyCapture 原始学习意图和
                CloudWordCopy 单词副本，用于待分析、待收藏、历史和跨设备学习。
              </li>
              <li>DeepSeek 接收 platform 查询、Web 分析、建议和练习所需的最小英文与固定指令。</li>
              <li>Supabase 与 Vercel 承载身份、数据库、私有导出对象、API 和 Web。</li>
              <li>Google 只用于用户选择的登录；邮件提供商用于验证、恢复和安全通知。</li>
              <li>
                Eudic 与 Shanbay 只在用户显式创建任务时接收最小词条数据；Shanbay 最终提交仍由用户
                点击。
              </li>
            </ul>
            <p>
              Cloud V1 不是端到端加密产品，语见服务器能够读取为提供 Cloud 功能而保存的学习内容。
              运行日志和管理页不提供正文浏览，内容不用于广告、画像、信用判断或出售。
            </p>
          </section>

          <section aria-labelledby="local-secrets-title">
            <h2 id="local-secrets-title">本机秘密与两条模型路径</h2>
            <p>
              BYOK 与欧路凭据只保存在本机 DeviceVault。BYOK 查询从 Extension 直达用户明确选择的
              Provider；BYOK Key 与该次精简结果不会发送给语见。platform 查询由语见 API 调用
              DeepSeek，并计入账号显示的月度额度。
            </p>
            <p>
              StudyCapture 和 CloudWordCopy 是与 BYOK 查询结果分开的云端学习动作，由用户分别选择；
              即使查询模式为 BYOK，也不会把该次精简结果上传为 Web 分析记录。
            </p>
          </section>

          <section aria-labelledby="retention-title">
            <h2 id="retention-title">保留、导出与删除</h2>
            <ul>
              <li>正式分析、学习项、生词和练习保留至用户删除；归档不是删除。</li>
              <li>
                平台插件查询的正文与精简结果最多保留一小时，不进入待整理或分析历史；之后只保留无正文
                用量账本。
              </li>
              <li>用户可以删除符合安全边界的单条记录、导出词表，或请求完整账号数据导出。</li>
              <li>账号删除立即撤销会话，主数据库内容在 24 小时内删除；备份残留期限仍待核验。</li>
              <li>完整账号导出 ready 后 24 小时过期，每个签名下载地址最长 15 分钟。</li>
              <li>Extension 待提交箱最多 20 条、5 MiB、7 天过期，用户可提前清空。</li>
            </ul>
            <p>
              撤回语见数据联网同意后，Extension 停止 platform 查询、StudyCapture、CloudWordCopy 和
              云端外部词典任务，并清除尚未提交的账号绑定正文；既有云端数据仍可浏览、导出或删除，
              本机 BYOK、本机词库和本机外部词典仍可独立使用。
            </p>
          </section>

          <section aria-labelledby="google-title">
            <h2 id="google-title">Google 数据与 Limited Use</h2>
            <p>
              Google 只用于用户主动选择的登录；语见不读取 Google Drive、Gmail、联系人或其他 Google
              产品资料。
            </p>
            <p lang="en">
              The use of information received from Google APIs will adhere to the Chrome Web Store
              User Data Policy, including the Limited Use requirements.
            </p>
            <ul className="privacy-policy-links">
              {POLICY_LINKS.map((link) => (
                <li key={link.href}>
                  <a data-external href={link.href} rel="external noreferrer">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="security-title">
            <h2 id="security-title">安全、费用与政策变化</h2>
            <p>
              传输使用 TLS，Cloud 数据以账号和数据库 RLS 隔离。平台模型使用账号额度；BYOK 与第三方
              费用由用户和对应供应商结算。任何系统都无法保证绝对安全，正式发布前会补充安全联系与
              事故通知方式。
            </p>
            <p>
              实质改变数据种类、触发条件、接收方、用途或保留规则时，语见会先更新本页和商店披露，
              再发布对应版本；不会用静默更新扩大数据用途。
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
