import { createHash } from "node:crypto";

const styles = `
:root{color-scheme:light;--ink:#26334f;--muted:#506080;--action:#334c81;--border:rgba(126,145,180,.34)}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(ellipse at 85% 10%,#dfe7f7,transparent 60%),linear-gradient(135deg,#fafbfd,#e9edf5);min-height:100vh}
.auth-page{display:grid;min-height:100vh;min-height:100dvh;place-items:center;padding:64px 16px}
.auth-card{width:min(100%,480px);padding:clamp(28px,5vw,48px);border:1px solid rgba(255,255,255,.95);border-radius:42px;background:linear-gradient(135deg,rgba(255,255,255,.85),rgba(235,241,251,.65));box-shadow:0 24px 48px rgba(50,65,95,.18),inset 0 1px 1px #fff;backdrop-filter:blur(24px) saturate(118%)}
.brand-mark{display:grid;place-items:center;width:44px;height:44px;border:1px solid #fff;border-radius:18px;background:rgba(255,255,255,.65);box-shadow:0 10px 24px rgba(62,78,105,.12)}
.brand-mark::after{content:"";width:12px;height:17px;transform:rotate(45deg);border:1.5px solid var(--action);border-radius:5px}
.eyebrow{margin:8px 0;color:#647daa;font-size:11px;font-weight:850;letter-spacing:.14em}
h1{margin:0 0 20px;font-size:clamp(28px,7vw,36px);line-height:1.2;letter-spacing:-.035em}
.auth-intro,.field-help{color:var(--muted)}
.auth-intro{margin:0 0 24px}.field-help{margin:0;font-size:14px}
form{display:grid;gap:10px}label{font-weight:650;margin-top:6px}
input,button,.primary-button{font:inherit;border:1px solid var(--border);border-radius:18px;min-height:48px}
input{width:100%;padding:10px 14px;color:var(--ink);background:rgba(255,255,255,.65)}
input[name=token]{font-size:24px;letter-spacing:.2em}
button,.primary-button{display:flex;align-items:center;justify-content:center;width:100%;padding:11px 16px;margin-top:10px;text-align:center;color:#fff;background:var(--action);font-weight:700;box-shadow:0 12px 24px rgba(52,73,111,.18);cursor:pointer}
button:hover,.primary-button:hover{background:#283e6d}
:focus-visible{outline:3px solid #7189b4;outline-offset:4px}
.alert{padding:14px 16px;margin:0 0 20px;border-radius:18px;color:#a42d33;background:#fff4f4;border:1px solid #f3dce0}
.auth-footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px;font-size:14px}
.auth-footer a{color:var(--ink);text-decoration:none;border:1px solid var(--border);border-radius:20px;padding:6px 12px}
.auth-footer a:hover{text-decoration:underline;background:rgba(255,255,255,.6)}
@media(max-width:420px){.auth-page{padding-block:32px}.auth-card{border-radius:32px}}
`;
const styleHash = createHash("sha256").update(styles).digest("base64");

export function authConfirmationCsp(webOrigin: string): string {
  return `default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self' ${new URL(webOrigin).origin}; base-uri 'none'; frame-ancestors 'none'`;
}

export function escapeAuthHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Body is trusted server markup; every request-derived value must be escaped by the caller.
export function renderAuthConfirmationPage(options: {
  body: string;
  introduction: string;
  title: string;
  webOrigin: string;
}): string {
  const webOrigin = escapeAuthHtml(new URL(options.webOrigin).origin);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAuthHtml(options.title)} · 语见</title>
<style>${styles}</style>
</head>
<body>
<main class="auth-page">
<section class="auth-card" aria-labelledby="auth-heading">
<span class="brand-mark" aria-hidden="true"></span>
<p class="eyebrow">SEEN &amp; SAID</p>
<h1 id="auth-heading">${escapeAuthHtml(options.title)}</h1>
<p class="auth-intro">${escapeAuthHtml(options.introduction)}</p>
${options.body}
<nav class="auth-footer" aria-label="账号辅助链接">
<a href="${webOrigin}/login">返回登录</a>
<a href="${webOrigin}/privacy">隐私说明</a>
</nav>
</section>
</main>
</body>
</html>`;
}
