export const backfillReviewStyles = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 420px; max-width: calc(100vw - 32px); color: #183e35; font: 14px/1.5 system-ui, sans-serif; }
* { box-sizing: border-box; }
aside { background: #f9fcfa; border: 1px solid #b7cec5; border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 40px #102c3433; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; background: #173f35; color: white; flex-shrink: 0; }
h2 { font: inherit; font-weight: 700; margin: 0; }
button, input { font: inherit; }
button { cursor: pointer; border: 1px solid #bdd3ca; background: white; color: #183e35;
  border-radius: 7px; min-height: 36px; padding: 6px 11px; }
button:hover:not(:disabled) { background: #e4f2ec; }
button:disabled { cursor: default; opacity: .5; }
button:focus-visible, input:focus-visible { outline: 3px solid #249776; outline-offset: 2px; }
header button { font-size: 13px; min-height: 30px; padding: 3px 9px; }
p { margin: 0; overflow-wrap: anywhere; }
.notice { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #dce8e2; }
.review { display: flex; flex-direction: column; min-height: 0; }
[hidden] { display: none !important; }
.summary { padding: 12px 16px 6px; font-weight: 600; }
.toolbar, .pagination { display: flex; gap: 8px; padding: 8px 16px; flex-shrink: 0; }
.explanation, .row-progress { font-size: 12px; color: #536e64; margin-bottom: 6px; }
.explanation:empty, .row-progress:empty { display: none; }
.danger { color: #9b352b; }
.toolbar { flex-wrap: wrap; }
.primary { background: #176c55; color: white; border-color: #176c55; }
.primary:hover:not(:disabled) { background: #115541; }
.list { overflow-y: auto; overscroll-behavior: contain; padding: 0 16px; min-height: 0;
  max-height: min(48dvh, 430px); }
.row { padding: 14px 0; border-top: 1px solid #dce8e2; }
label { display: block; font-weight: 600; overflow-wrap: anywhere; }
input { display: block; width: 100%; margin: 7px 0 8px; padding: 7px 9px;
  min-width: 0; border: 1px solid #adc9bd; border-radius: 6px; color: #183e35; background: white; }
.row-actions { display: flex; gap: 8px; flex-wrap: wrap; }
details { margin: 8px 0 12px; font-size: 13px; }
summary { cursor: pointer; color: #42685a; }
details p { margin-top: 6px; }
.help { padding: 6px 16px 12px; font-size: 12px; color: #536e64; }
.error { padding: 0 16px 12px; color: #9b352b; font-size: 13px; }
.error:empty { display: none; }
@media (max-height: 540px) { .list { max-height: 26dvh; } .notice, .help { font-size: 12px; padding: 6px 12px; } }
`;
