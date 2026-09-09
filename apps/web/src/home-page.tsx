import { useState } from "react";
import { PublicSiteShell } from "./public-site-shell.js";

const exampleSteps = [
  {
    label: "01 收集",
    eyebrow: "从真实阅读开始",
    title: "留住一句，让你停下来的英文。",
    description: "读文章、看视频时，遇到想学的表达，连同原文一起留下。",
    phrase: "Make time for what matters.",
    note: "给重要的事，留一点时间。",
  },
  {
    label: "02 看懂",
    eyebrow: "让表达带着语境",
    title: "读懂它，也知道什么时候用。",
    description: "把原文里的表达、句型与生词整理出来。看清意思，也理解它在这句话里的作用。",
    phrase: "make time for…",
    note: "为值得的事留出时间；说说你愿意把时间留给谁、留给什么。",
  },
  {
    label: "03 用出来",
    eyebrow: "写下一句自己的话",
    title: "从看懂，到亲自说一遍。",
    description: "用自己的生活造句，或围绕收藏的内容练习情境对话，再回来看反馈与进步。",
    phrase: "I make time for reading every evening.",
    note: "我的句子：每天晚上，我都会留一点时间读书。",
  },
] as const;

function LearningExample() {
  const [step, setStep] = useState(0);
  const selected = exampleSteps[step] ?? exampleSteps[0];
  return (
    <section className="site-example" id="try-it" aria-labelledby="example-heading">
      <div className="site-section-heading">
        <div>
          <p className="site-eyebrow">A SMALL LEARNING LOOP</p>
          <h2 id="example-heading">一句英文，可以走得更远。</h2>
        </div>
        <p>点一点，体验语见的学习过程。</p>
      </div>
      <div className="site-example-steps" role="group" aria-label="切换学习示例步骤">
        {exampleSteps.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={step === index}
            onClick={() => setStep(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="site-example-body" aria-live="polite" aria-atomic="true">
        <div>
          <p className="site-eyebrow">{selected.eyebrow}</p>
          <h3>{selected.title}</h3>
          <p>{selected.description}</p>
        </div>
        <div className="site-example-note">
          <span className="site-note-label">SEEN → SAID</span>
          <blockquote lang="en">{selected.phrase}</blockquote>
          <p>{selected.note}</p>
        </div>
      </div>
      <p className="site-example-caption">内置示例 · 切换示例不会调用模型或发送你的数据。</p>
    </section>
  );
}

export function HomePage() {
  return (
    <PublicSiteShell page="home">
      <section className="site-hero" aria-labelledby="home-heading">
        <div className="site-hero-copy">
          <p className="site-eyebrow">从你每天遇见的英文开始</p>
          <h1 id="home-heading">
            把看见的英文，<span>变成你会说的话。</span>
          </h1>
          <p className="site-slogan" lang="en">
            Turn what you see into what you can say.
          </p>
          <p className="site-lead">
            收集一句触动你的英文，读懂里面的表达，再用自己的句子把它留下。语见陪你把阅读中的小小发现，慢慢变成自己的语言。
          </p>
          <div className="site-actions">
            <a className="site-button" href="#try-it">
              看看怎么学 <span aria-hidden="true">↓</span>
            </a>
            <a className="site-text-link" href="/guide">
              从这里开始 <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className="site-quiet">随手收集 · 按自己的节奏练习</p>
        </div>
        <div className="site-hero-scene" aria-label="从阅读原文到自己的句子的学习示意">
          <div className="site-scene-orbit" aria-hidden="true" />
          <div className="site-source-note">
            <span className="site-note-label">今天读到的一句</span>
            <p lang="en">
              Make time for
              <br />
              <mark>what matters.</mark>
            </p>
            <small>把值得留下的话，放进收集箱。</small>
          </div>
          <span className="site-scene-connector" aria-hidden="true">
            ↓
          </span>
          <div className="site-practice-note">
            <span className="site-note-label">我的一次练习</span>
            <p lang="en">
              I make time for
              <br />
              <strong>reading every evening.</strong>
            </p>
            <span className="site-scene-caption">从原文出发，用自己的生活作答。</span>
          </div>
          <p className="site-scene-footnote">看见 · 理解 · 表达</p>
        </div>
      </section>
      <LearningExample />
      <section className="site-entry-section" id="entry-points" aria-labelledby="entries-heading">
        <div className="site-section-heading">
          <div>
            <p className="site-eyebrow">WHERE LEARNING HAPPENS</p>
            <h2 id="entries-heading">在顺手的地方，继续学习。</h2>
          </div>
          <p>阅读时收集，坐下来整理，空闲时练习。</p>
        </div>
        <article className="site-entry">
          <span className="site-entry-number" aria-hidden="true">
            01
          </span>
          <div>
            <h3>网页学习工作台</h3>
            <p>集中整理收集箱、表达、句型和生词，完成造句与情境对话，回看练习记录。</p>
          </div>
          <a className="site-button site-button-secondary" href="/login">
            进入网页版 <span aria-hidden="true">↗</span>
          </a>
        </article>
        <article className="site-entry">
          <span className="site-entry-number" aria-hidden="true">
            02
          </span>
          <div>
            <h3>微信小程序</h3>
            <p>
              在手机上粘贴原文、整理收藏、完成今日练习。微信账号可以独立使用，也可以在首次开通时关联已有网页账号。
            </p>
          </div>
          <div className="site-entry-status">
            <strong>小程序体验版准备中</strong>
            <a href="/guide#wechat">
              了解开通方式 <span aria-hidden="true">→</span>
            </a>
          </div>
        </article>
        <article className="site-entry">
          <span className="site-entry-number" aria-hidden="true">
            03
          </span>
          <div>
            <h3>浏览器插件</h3>
            <p>在阅读网页时理解选中的英文，把值得学习的原文带回语见，继续整理和练习。</p>
          </div>
          <div className="site-entry-status">
            <strong>插件安装入口准备中</strong>
            <a href="/guide#browser">
              了解使用场景 <span aria-hidden="true">→</span>
            </a>
          </div>
        </article>
      </section>
      <section className="site-closing" aria-labelledby="closing-heading">
        <p className="site-eyebrow">A LITTLE, OFTEN</p>
        <h2 id="closing-heading">
          今天遇见的，
          <br />
          明天也许就能说出来。
        </h2>
        <p>不必一次学很多。从一句想记住的英文开始。</p>
        <a className="site-button" href="/guide">
          开始了解语见 <span aria-hidden="true">→</span>
        </a>
      </section>
    </PublicSiteShell>
  );
}
