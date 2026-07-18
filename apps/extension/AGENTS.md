# Extension Instructions

- Build only a Manifest V3 extension.
- Content scripts own DOM selection and overlay rendering. Only the service worker may use
  Native Messaging.
- Version 0.10 permissions are limited to exactly `nativeMessaging` and content-script matches for
  normal `http` and `https` pages. Any new permission requires `docs/security.md` and
  regression-test updates.
- The Extension uses wire v5 only and must be refreshed together with a v0.10.0 Native Host; v4
  messages are incompatible and must be rejected.
- Warmup requests contain only type, schema version, and request ID. Never add selection,
  context, sentence, URL, or other page data to warmup.
- Use native DOM and Shadow DOM. Do not add React or another UI framework.
- Render model content with `textContent`; never insert it with `innerHTML`.
- Do not collect or persist page URLs, titles, query history, or analytics.
- Selected text and paragraph context are each limited to 2,000 characters.
- Words, phrases, and single sentences support translate and explain. Paragraphs support only
  translate.
- Track analysis, automatic word-status lookup, and explicit add as separate request lanes. A new
  selection closes all lanes; explicit add replaces only the lookup lane.
- Treat deltas and typed sections as non-terminal previews. Only `result` is complete success;
  preserve a safe preview on terminal failure and hide absent or empty lexical sections without
  placeholders or fabricated values.
- Render word translation as pronunciation, contextual sense, grouped common meanings, common
  phrases, and confusable words. Render word explanation as contextual analysis, word form,
  reliable formation, usage notes, and synonym comparisons. Do not restore word examples or a
  separate part-of-speech row.
- Batch streaming updates with `requestAnimationFrame` and render at most once per frame. Drain
  pending updates before terminal result/error handling, and clear stale batches on close or a
  new selection.
- Patch stable nodes keyed by `data-huayi-section`; append cumulative array items in place and do
  not replace the whole result body. New-node animation must be about 120 ms, run once, and honor
  `prefers-reduced-motion`.
- All overlay transitions go through `overlay-state.ts`; do not add scattered state flags.
- Extend visual values through tokens in `styles.ts`.
- Keep result cards as one white surface: word source and pronunciation form the lexical header,
  contextual meaning uses the only emphasized fill, and repeated meanings use unboxed rows.
- Keep visible wordbook labels compact (`生词`, `添加中`, `已加入`) while preserving complete
  accessible labels. Loading and word streaming reserve stable body height to limit layout jumps.
- The overlay must support Escape-to-close, visible keyboard focus, viewport clamping, narrow
  layouts, and internal scrolling.
- Extension code may import only `@huayi/protocol`, browser APIs, and files inside this package.
