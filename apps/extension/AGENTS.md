# Extension Instructions

- Build only a Manifest V3 extension.
- Content scripts own DOM selection and overlay rendering. Only the service worker may use
  Native Messaging.
- Version 0.3 permissions are limited to `nativeMessaging` and content-script matches for normal
  `http` and `https` pages. Any new permission requires `docs/security.md` and regression-test
  updates.
- Use native DOM and Shadow DOM. Do not add React or another UI framework.
- Render model content with `textContent`; never insert it with `innerHTML`.
- Do not collect or persist page URLs, titles, query history, or analytics.
- Selected text and paragraph context are each limited to 2,000 characters.
- Words, phrases, and single sentences support translate and explain. Paragraphs support only
  translate.
- Track analysis, automatic word-status lookup, and explicit add as separate request lanes. A new
  selection closes all lanes; explicit add replaces only the lookup lane.
- All overlay transitions go through `overlay-state.ts`; do not add scattered state flags.
- Extend visual values through tokens in `styles.ts`.
- The overlay must support Escape-to-close, visible keyboard focus, viewport clamping, narrow
  layouts, and internal scrolling.
- Extension code may import only `@huayi/protocol`, browser APIs, and files inside this package.
