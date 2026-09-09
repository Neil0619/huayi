import { PublicSiteShell } from "./public-site-shell.js";

export function GuidePage() {
  return (
    <PublicSiteShell page="guide">
      <header className="site-guide-heading">
        <p className="site-eyebrow">GETTING STARTED</p>
        <h1>从一句英文，开始使用语见。</h1>
        <p className="site-lead">
          先把想学的内容留下，再慢慢变成自己的表达。这份指南帮你找到适合自己的入口。
        </p>
        <a className="site-text-link" href="/#try-it">
          先看一个学习示例 <span aria-hidden="true">→</span>
        </a>
      </header>
      <div className="site-guide-layout">
        <nav className="site-guide-nav" aria-label="使用帮助目录">
          <a href="#first-practice">完成第一次学习</a>
          <a href="#wechat">微信开通与关联</a>
          <a href="#browser">网页与浏览器插件</a>
          <a href="#your-data">草稿与数据</a>
          <a href="#questions">常见问题</a>
        </nav>
        <div className="site-guide-content">
          <section id="first-practice">
            <p className="site-eyebrow">01 / FIRST STEPS</p>
            <h2>完成第一次学习</h2>
            <ol className="site-guide-steps">
              <li>
                <h3>留下一段原文</h3>
                <p>粘贴你在文章、视频或生活中遇见的英文，保存到收集箱。保存原文不会调用模型。</p>
              </li>
              <li>
                <h3>读懂，再选择要留下的内容</h3>
                <p>主动发起分析，查看原文解释，把想学的表达、句型或生词整理到学习库。</p>
              </li>
              <li>
                <h3>写一句，或者聊几轮</h3>
                <p>
                  从今日练习开始，用自己的场景造句，也可以围绕学习项目进行情境对话。查看反馈后，给自己的掌握情况做一次评价。
                </p>
              </li>
              <li>
                <h3>下次回来继续</h3>
                <p>语见会保留学习记录与练习安排。你可以在学习库和练习历史里回看，再练一次。</p>
              </li>
            </ol>
          </section>
          <section id="wechat">
            <p className="site-eyebrow">02 / WECHAT</p>
            <h2>微信账号可以独立使用</h2>
            <p>小程序体验版准备中。开放后，这里会提供经过确认的小程序入口。</p>
            <div className="site-guide-callout">
              <h3>第一次使用语见</h3>
              <p>
                微信登录后选择“直接开始使用”，即可开通独立账号，不要求先注册网页账号、填写邮箱或手机号。
              </p>
            </div>
            <h3>已经有网页学习记录</h3>
            <p>
              在首次开通时选择“关联已有语见账号”，输入语见账号的邮箱和登录密码，点击“登录并关联”。
              关联成功后，小程序直接使用原账号的学习数据和额度。
            </p>
            <p>
              关联后两端共用学习数据与额度。首版不合并两个独立账号的记录；如果想沿用网页数据，请在直接开通之前选择关联。
            </p>
            <p>
              登录中断或关联结果未确认时，重新微信登录即可恢复。你也可以返回开通方式，改选独立使用。
            </p>
          </section>
          <section id="browser">
            <p className="site-eyebrow">03 / WEB & BROWSER</p>
            <h2>坐下来整理，阅读时收集</h2>
            <h3>网页版</h3>
            <p>
              网页版适合集中阅读分析、编辑学习库、练习与回看记录。当前供本人及受邀朋友使用，已有账号可以从登录入口进入。
            </p>
            <a className="site-button site-button-secondary" href="/login">
              进入网页版 <span aria-hidden="true">↗</span>
            </a>
            <h3>浏览器插件</h3>
            <p>
              插件让你在阅读网页时理解选中的英文，并把想学习的原文带回收集箱。安装入口准备中，取得适用于你设备的安装方式后再使用。
            </p>
            <p>插件使用网页上的设备配对入口；小程序在首次开通时登录已有语见账号完成关联。</p>
          </section>
          <section id="your-data">
            <p className="site-eyebrow">04 / YOUR WORDS, YOUR DATA</p>
            <h2>输入值得被好好保留</h2>
            <p>
              小程序原文与练习草稿按账号保存在当前设备。网络中断时先保留输入、回读原任务状态；已提交的任务可以在回来后继续查看。
            </p>
            <p>
              原文或练习答案超长时会保留全文，并提示缩短后再提交。归档让内容退出常用列表，恢复后还可以继续使用。
            </p>
            <p>
              你可以在网页账号数据设置或小程序“我的”导出学习数据、申请注销，也可以在小程序“我的”清除本机草稿。关联账号共用数据，注销也会影响另一端；操作前请先核对页面提示。
            </p>
            <a className="site-text-link" href="/privacy">
              阅读完整隐私说明 <span aria-hidden="true">→</span>
            </a>
          </section>
          <section id="questions">
            <p className="site-eyebrow">05 / A FEW ANSWERS</p>
            <h2>你可能还想知道</h2>
            <details className="site-faq">
              <summary>官网示例会使用我的模型额度吗？</summary>
              <p>不会。官网演示使用内置内容，不登录、不调用模型，也不会把数据发送到学习服务。</p>
            </details>
            <details className="site-faq">
              <summary>分析和练习反馈什么时候使用模型？</summary>
              <p>
                当你主动请求分析、生成练习或获取反馈时，会使用模型服务并计入账号额度。保存原文和浏览已有记录不触发新的模型生成。
              </p>
            </details>
            <details className="site-faq">
              <summary>遇到问题，怎样联系维护者？</summary>
              <p>
                请联系 <a href="mailto:niu0619@gmail.com">Neil</a>
                ，说明出现问题的页面和操作。涉及账号或数据的问题，也可以通过隐私说明中的联系方式反馈。
              </p>
            </details>
          </section>
        </div>
      </div>
    </PublicSiteShell>
  );
}
