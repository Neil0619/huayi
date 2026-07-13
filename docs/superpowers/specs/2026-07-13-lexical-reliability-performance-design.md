# 词汇结果可靠性与渐进展示设计（v0.4.0）

## 状态

- 日期：2026-07-13
- 目标版本：`0.4.0`
- Wire protocol：`schemaVersion: 2`
- 设计状态：已完成交互确认，待书面规格审阅

## 背景与问题

v0.3.1 在真实 Chrome 使用中出现稳定的词汇失败模式：`sustained`、
`victims`、`accountable` 和 `Four` 的翻译或解释都能先流式显示
`contextualMeaningZh`，随后却以 `INVALID_RESPONSE` 结束；相同版本的句子
翻译和解释可以完成。

流式文本能出现说明英文选区、Content Script、Service Worker、Native
Messaging、Codex App Server 启动和模型首个语义字段都已工作。失败发生在
后续词汇 JSON 的增量解析或最终校验阶段。现有实现把所有该类失败折叠为
同一公共错误，因此截图不能证明某一个具体被拒字段，但代码中存在以下
可确定的契约缺陷：

1. 模型必须重复生成 `sourceText`、`selectionKind` 和 `type`，Host 随后又对前两者
   执行精确相等校验。大小写归一、返回原形或误判选区类型都会废弃整个结果。
2. 公共 Zod 协议把音标、原文例句、原形和构词定义为可选，但传给模型的 JSON
   Schema 要求这些字段全部存在且不得为空。
3. 所有词汇都被强制生成 2–4 个搭配和 3–5 个同义词或相似词。`Four` 等词并
   不存在这么多自然同义词，契约会迫使模型凑数或违反 Schema。
4. Prompt 要求 2–5 个搭配，JSON Schema 却把上限设为 4，文本与机器契约不一致。
5. 词汇结果比句子和段落结果包含更多必填字段、重复原文和数组项，会同时增加
   完整生成时间和失败概率。

首次点击还要串行承担 Native Host 启动、直接 MCP 发现、App Server 启动及
安全初始化。现有 `connectNative()` 端口在第一次分析消息时才建立，因此用户点击
后才开始支付这段无模型的冷启动延迟。

## 目标

- 修复单词和短语翻译/解释的稳定失败。
- 没有自然适用内容时隐藏板块，不伪造音标、构词、搭配、同义词或相似词。
- 把请求元数据和页面原文从模型输出责任中移除，由 Host 使用可信请求组装。
- 在用户思考和移动到操作按钮时隐藏 App Server 冷启动。
- 一次模型调用内逐段展示已完成且已校验的内容。
- 保持最终严格校验、取消、超时、ephemeral thread、只读无网络沙箱及工具禁用边界。
- 保持欧路生词本的并发、凭据、隐私和写入行为不变。
- 为未来失败提供不泄漏文本的阶段级诊断。

## 非目标

- 不更换 `gpt-5.4-mini` 或 `low` reasoning effort。
- 不改为两次模型调用，不增加调用额度。
- 不增加持久缓存、历史、用户设置或性能遥测。
- 不接入第三方词典、云端 API 或新 Chrome 权限。
- 不改变句子和段落的产品内容；只统一其模型元数据组装方式。
- 不在默认测试中访问 OpenAI、真实钥匙串或欧路 API。

## 方案选择

采用“单次结构化调用 + Host 组装 + 选区预热 + 已校验板块渐进展示”。

不采用仅放宽 Schema 的最小修复：它能缓解当前错误，但保留了首次冷启动和
只流式显示一个字段的速度问题。

不采用“快速核心结果 + 第二次详情补全”：它会加倍模型调用、产生两份不一致
结果，并增加取消、超时和额度处理竞态。

不采用持久或跨页词汇缓存：它会扩展当前“不保存查询和分析数据”的隐私
边界，且对含上下文语境义的结果容易过期。

## 总体数据流

```text
有效英文选区
  -> Content Script 立即显示工具条
  -> warmup（无网页文本）
  -> Service Worker -> Native Messaging -> Native Host
  -> MCP 发现 -> App Server initialize/hooks/MCP 安全验证

用户点击翻译/解释
  -> analyze（selection + context + sentenceContext）
  -> 复用已完成或正在进行的预热
  -> 新 ephemeral thread/turn，一次模型调用
  -> 文本增量 + 已校验完整板块
  -> Host 注入请求元数据并执行最终校验
  -> result/error

单词同时：
  -> check-word -> Keychain -> Eudic GET
```

预热、分析和欧路查词是独立请求通道。预热不含任何选区或页面数据；查词不参与
Codex thread，也不得修改分析结果。

## 公共协议 v2

### 版本策略

相关词和搭配的最小数量、结果字段语义及流式事件都发生变化。为了不让旧
Extension/Host 在 `schemaVersion: 1` 下错误接受新语义，全部 Native Messaging
消息升级为 `schemaVersion: 2`。不实现 v1/v2 双协议转换；个人本地版通过同步
升级 Extension 和 Host 完成迁移。

### 分析请求

`AnalyzeRequest` 增加：

```ts
interface AnalyzeRequest {
  type: "analyze";
  schemaVersion: 2;
  requestId: string;
  action: "translate" | "explain";
  selection: string;
  selectionKind: "word" | "phrase" | "sentence" | "paragraph";
  context: string;
  sentenceContext: string | null;
  targetLanguage: "zh-CN";
}
```

`sentenceContext` 是扩展从真实 `Range` 计算的英文完整句：

- 单词和短语尽可能传入精确句子；无法安全提取时为 `null`。
- 句子和段落请求固定为 `null`。
- 长度 1–2,000 字符，要求包含英文且不得含汉字。
- 这不增加新的页面数据类别；该句原本已包含在最多 2,000 字符的 `context`
  中，新字段只为了精确定位。
- 单词的该值可同时作为用户点击添加时的欧路 `context_line`；自动查词仍只发送
  原始单词。

### 预热请求

```ts
interface WarmupRequest {
  type: "warmup";
  schemaVersion: 2;
  requestId: string;
}

interface WarmupReadyEvent {
  type: "warmup-ready";
  schemaVersion: 2;
  requestId: string;
}
```

Warmup 不是分析请求，不包含模型输入，也不允许创建 thread/turn。它只能完成：

- 直接 MCP 名称发现和逐项禁用。
- App Server 进程启动及 `initialize`。
- `hooks/list` 与 `mcpServerStatus/list` 的安全不变量校验。

同一 Host 中的并发 warmup 和 analyze 共享同一个初始化 Promise。不得并发启动多个
App Server。

### 渐进更新

现有长文本增量保留，并与新的完整板块事件共享一个序列：

```ts
interface AnalysisDeltaEvent {
  type: "analysis-delta";
  schemaVersion: 2;
  requestId: string;
  sequence: number;
  section: "contextual-meaning" | "translation" | "main-structure" | "context-role";
  delta: string;
}

type AnalysisSectionPayload =
  | { section: "part-of-speech"; value: PartOfSpeech }
  | { section: "pronunciation"; value: Pronunciation }
  | { section: "base-form"; value: string }
  | { section: "word-formation"; value: string }
  | { section: "core-meanings"; value: CoreMeaning[] }
  | { section: "collocations"; value: Collocation[] }
  | { section: "context-example"; value: ContextExample }
  | { section: "similar-terms"; value: RelatedTerm[] }
  | { section: "synonyms"; value: RelatedTerm[] };

type AnalysisSectionEvent = AnalysisSectionPayload & {
  type: "analysis-section";
  schemaVersion: 2;
  requestId: string;
  sequence: number;
};
```

规则：

- `analysis-delta` 和 `analysis-section` 共用从 0 开始的连续序号。
- 结构化板块只在对应 JSON 值完整结束且字段 Schema 校验成功后发送。
- `null` 和空数组表示板块不适用，Host 不为它们发送 `analysis-section`。
- 不发送原始 JSON、半个对象、半个数组、未校验字段或模型推理文本。
- Service Worker 和 Content Script 对两种事件统一校验序号；缺口、重复、倒序、
  请求类型错配或终态后更新都失败关闭。

`Pronunciation`、`CoreMeaning` 和 `ContextExample` 将成为协议包的公共严格类型，以保证
`analysis-section` 和最终 `AnalysisResult` 使用同一子契约。

### 词汇结果基数

```text
collocations: 0–3
similarTerms: 0–3
synonyms: 0–3
coreMeanings: 1–3
```

`pronunciation`、`contextExample`、`baseForm` 和 `wordFormation` 在最终公共结果中
继续为可选字段。数组保持必填但可为空，使消费端可以统一迭代并隐藏空板块。
同义词和相似词的每个非空项仍必须包含英文、词性和中文义。

## 模型私有输出契约

模型输出不再直接冒充公共 `AnalysisResult`。Host 在 provider 目录中为四类内容定义
私有严格 Schema，它们不通过 `@huayi/protocol` 导出，也不出现在 Native Messaging
上。

词汇翻译内容：

```ts
interface ModelLexicalTranslation {
  contextualMeaningZh: string;
  partOfSpeech: PartOfSpeech;
  pronunciation: { uk: string | null; us: string | null } | null;
  collocations: Collocation[];
  contextExampleTranslationZh: string | null;
  similarTerms: RelatedTerm[];
}
```

词汇解释内容：

```ts
interface ModelLexicalExplanation {
  contextualMeaningZh: string;
  baseForm: string | null;
  wordFormation: string | null;
  coreMeanings: CoreMeaning[];
  collocations: Collocation[];
  synonyms: RelatedTerm[];
}
```

段落翻译私有输出只包含 `translationZh`；句子解释只包含 `mainStructure`、
`keyExpressions`、`translationZh` 和 `contextRole`。四类输出都不再要求模型生成
`sourceText`、`selectionKind` 或 `type`。

为了保持 Structured Outputs 的确定形状，模型 JSON Schema 仍要求列出所有内容键，
但不适用的单值使用 `null`，不适用的列表使用空数组。Host 规范化时：

- `pronunciation === null` 或 `uk`/`us` 全为 `null`：省略音标。
- `baseForm === null` 或 `wordFormation === null`：省略对应字段。
- `contextExampleTranslationZh !== null` 且请求有 `sentenceContext`：用 Host 持有的
  英文原句与模型中译组装 `contextExample`。
- `contextExampleTranslationZh !== null` 但请求无 `sentenceContext`：按模型契约违反处理，
  不允许伪造英文例句。
- 空搭配或相关词数组原样进入公共结果，UI 不渲染空板块。

Host 最后注入：

```ts
{
  sourceText: request.selection,
  selectionKind: request.selectionKind,
  type: resultTypeFor(request),
  ...validatedModelContent,
}
```

组装结果必须再通过公共 `analysisResultSchema`。因为模型已不控制请求元数据，
大小写、复数、过去分词或原形建议不再能改变 `sourceText`。

### Prompt 规则

Prompt 和 JSON Schema 必须使用相同的基数及可空语义：

- 仅输出模型内容 Schema 要求的字段。
- 没有自然适用内容时返回 `null` 或 `[]`，禁止为满足数量而伪造。
- 搭配、相似词和同义词都是 0–3 个，不再出现 2–5 与 2–4 的矛盾。
- 相似词和同义词必须与当前语境义自然相关；无法给出时返回空数组。
- 音标只在合理确信时返回，否则返回 `null`。
- 原形只在它与选中形式不同且有学习价值时返回。
- 构词只在存在可靠、简短的词形分析时返回。
- 英文原句不由模型重复；模型最多返回 Host 提供的 `sentenceContext` 中译。

JSON Schema 的属性顺序以用户视觉优先级排列，但正确性不依赖模型遵守顺序。

### Provider 私有 Schema 依赖决策

Native Host 需要在组装公共结果前对模型内容执行严格运行时校验。为此
`@huayi/native-host` 将把工作区已有的 `zod` 声明为直接生产依赖：

- 用途：provider 私有严格 Schema、字段级渐进校验和最终内容校验。
- 替代方案：手写守卫容易与 JSON Schema 和公共协议漂移；把 provider 私有形状暴露到
  `@huayi/protocol` 会泄漏 provider 细节。
- 安全影响：不引入新库或远程代码；协议包已使用同版本 Zod，Host 打包仍只产生
  自包含 bundle。直接声明用来保证包边界和依赖追踪正确。

## App Server 预热与生命周期

Content Script 在首次进入 `actions` 状态后异步发送 warmup，不等待它才显示
工具条。Service Worker 在当前 Native Messaging 端口生命周期中只主动预热一次：

- 预热完成后不再发送。
- 预热进行时的新选区不重复发送。
- 端口断开后重置状态，下次有效选区可以重新预热。
- 预热失败不改写浮层，也不会立即向未点击的用户显示错误。
- 后续真实 analyze 会重用或重试初始化，并按现有错误码向用户报告结果。

`CodexAppServerClient` 增加只保证 session 初始化的 `warmup(signal)`。它与
`runTurn()` 共用现有 `ensureSession()` 单例化逻辑，但不调用 `thread/start` 或
`turn/start`。

浮层关闭、Escape 或新选区不取消已开始的全局预热，因为它不持有网页文本且可以
服务下一次操作。Native Messaging 输入结束、Host 退出或协议失败仍必须立即清理
App Server。

不增加 heartbeat、alarm、offscreen document 或 `storage` 权限。Chrome 已会在
`runtime.connectNative()` 端口存活时保持 Native Host 进程；实现只使用现有
`nativeMessaging` 权限。

## 增量解析与安全渲染

将现有只提取顶层字符串的有界解析器扩展为“文本增量 + 完整顶层值”解析器：

- 总 assistant JSON 仍限制为 1 MiB UTF-8。
- 顶层键只能出现一次；配置字段重复、容器不匹配或非法转义立即失败。
- 字符串允许按原有字符级增量发送。
- 对象和数组只在关闭定界符已到达后截取该完整 JSON 值，再使用 provider
  私有 Zod 子 Schema 校验。
- 解析器不向 Extension 发送未知顶层字段，但最终严格 Schema 仍拒绝它们，不能通过
  忽略未知字段把非法对象变成成功结果。
- 任何增量解析失败都实际中断分析请求，不再发送后续板块。

Content Script 使用类型化 `preview.sections` 累积更新。渲染顺序固定为：

```text
词汇翻译：原词 -> 语境义 -> 词性 -> 音标 -> 搭配 -> 原文例句 -> 相似词
词汇解释：原词 -> 语境义 -> 原形 -> 构词 -> 核心词义 -> 搭配 -> 同义词
```

事件到达顺序可以不同于视觉顺序；渲染器总是按上述视觉顺序排列已有板块。DOM
更新继续约 40–50 ms 合并，模型文本仅通过 `textContent` 渲染。从部分结果替换为
最终卡片时保留合理滚动位置和焦点。

最终 `result` 仍是唯一完整成功态。若最终校验失败，已安全显示的板块保留为只读
预览，显示“内容未完整生成”和重试，不得把部分结果伪装成成功。

## 错误分类与安全诊断

Host 引入内部校验阶段：

```text
stream-parse
model-json
model-schema
result-assembly
protocol-validation
```

- `stream-parse`、`model-json` 和 `model-schema` 是模型输出无效，公共映射为可重试
  `INVALID_RESPONSE`。
- `result-assembly` 和 `protocol-validation` 代表 Host 自身不可能状态，公共映射为可重试
  `INTERNAL_ERROR`。
- 阶段名可以连同固定字段名写入 stderr，但诊断行必须有长度上限。
- 诊断禁止包含选区、上下文、模型值、原始 JSON、欧路授权、Codex 认证或其他
  环境数据。
- Native Host stdout 继续只允许 Native Messaging 帧。

`null` 和符合基数的空数组是合法业务值。非法词性、错误类型、超大内容、未知
字段和损坏 JSON 仍使整个请求失败；不通过丢弃非法可选字段来伪造成功。

## 浮层、取消和欧路状态

分析主状态保持：

```text
actions -> loading -> streaming -> result
                     |             |
                     `-> error <---`
```

`streaming` 内部同时保存文本增量和已验证结构化板块。生词状态继续与主状态
正交：

- 单词 analyze 成功提交后仍立即并行 `check-word`。
- 查词成功可在渐进显示期间更新右上角状态。
- 查词错误仅把 availability 设为 `unknown`，不拒绝、覆盖或取消分析。
- 显式加词仍只在完整词汇 `result` 上允许，不在部分预览上发起写入。

新选区、关闭、Escape 和分析超时必须定向取消当前 analyze、check-word 或
add-word，并实际调用 `turn/interrupt`。旧请求的迟到文本、板块、生词状态和
终态都被忽略。

预热不属于某一浮层会话，因此浮层关闭不取消它。重试分析时清空旧预览并
创建新 request ID，但复用健康的 App Server session。

## 性能验收

不对受网络、账户额度和模型负载影响的“完整结果毫秒数”设置不诚实的硬阈值。
验收可由实现保证的边界：

- 有效选区后 100 ms 内进入可见工具条状态，预热不阻塞工具条。
- 首次有效选区在同一事件回合后提交 warmup。
- warmup 就绪后的 analyze 不得重新执行 `codex mcp list --json`、启动第二个
  App Server 或再次 initialize。
- analyze 与 warmup 竞态时共享一个初始化任务，不串行重复冷启动。
- Host 收到首个合法模型增量后，Content Script 在下一个 40–50 ms DOM 合并周期内
  显示。
- 每个完整且校验成功的结构化板块不等待最终 `result` 即显示。
- 模型不再输出三个请求元数据字段，不重复英文原句，不生成用于凑数的列表项。
- 欧路自动查词继续与 Codex 分析并行，不得阻塞任何分析更新或终态。

`pnpm smoke:codex` 在真实运行时输出：

```text
cold warmup
click-to-first-delta
click-to-full-result
```

它只输出时长和用例名，不输出模型文本。真实 smoke 仍仅在用户明确允许时执行，
因为它会消耗 ChatGPT/Codex 额度。

## 测试设计

所有行为修改使用 TDD：先写能复现现有症状的失败测试，再做最小实现。

### 协议

- v2 warmup、analyze、文本增量、结构化板块和终态的严格联合。
- `sentenceContext` 的类型、长度、英文/汉字和未知字段校验。
- 词汇列表接受 0 和 3，拒绝 4；核心词义接受 1 和 3，拒绝 0 和 4。
- 可选词汇字段缺省，所有对象仍拒绝未知字段。
- v1 消息在 v2 运行时被明确拒绝，迁移说明与 `docs/protocol.md` 同步。

### 选区与扩展

- 单词、短语、重复文本、嵌套节点和跨节点 Range 的精确 `sentenceContext`。
- 中英混合、无有效句子、超长句子和编辑区域的安全退化。
- 工具条先显示、warmup 后发送，且 warmup 消息不含任何选区字段。
- 单词分析仍先提交 analyze，随后提交独立 check-word。
- 新选区、关闭和 Escape 取消分析/生词请求但不取消全局 warmup。

### App Server 与 provider

- warmup 不发送 `thread/start` 或 `turn/start`，也不触发 fake model turn。
- 并发 warmup 和 analyze 只发现一次 MCP、启动一个进程和初始化一次。
- App Server 失败后下一请求可重启，但不自动重试已开始的模型 turn。
- 私有四类内容 Schema 拒绝元数据字段、未知字段、错误基数和错误可空形状。
- Host 总是从请求注入 `sourceText`、`selectionKind` 和 `type`。
- `sentenceContext` 和中译正确组装例句；无原句时拒绝模型伪造的例句翻译。
- 增量解析覆盖数组/对象跨 chunk、嵌套字符串、转义、Unicode、重复键、超大输出和
  半成品终止。
- 阶段诊断覆盖五类失败，并证明模型文本和伪凭据不进入 stderr。

### 词汇回归

使用 fake App Server 固定覆盖：

- `sustained`：过去分词/形容词，可有原形，无需强制构词。
- `victims`：复数原词必须原样保留，模型可返回 `victim` 作为可选原形。
- `accountable`：翻译和解释都可在不伪造相关词时完成。
- `Four`：`sourceText` 保留大写，词性为 `number`，同义词和构词可为空。

每个用例均覆盖翻译或解释的模型内容校验、Host 组装、渐进更新和最终公共结果。

### 浮层与 E2E

- 词性、音标、原形、构词、核心义、搭配、例句、相似词和同义词逐段显示。
- 空数组或可选字段缺省时不留空标题、分隔或占位。
- 不同事件到达顺序下的固定视觉顺序、滚动保持和合理焦点。
- 失败保留已验证预览并显示“内容未完整生成”，重试清空旧预览。
- 单词渐进显示与生词查询两种竞态：先查到已存在，以及最终结果后才返回查词状态。
- 恶意 HTML、结构字符和提示注入文本全部只作为文本显示或被协议拒绝。
- Manifest 权限数组仍严格等于 `["nativeMessaging"]`。

### 真实验收

默认质量门禁完成后，再单独请求用户允许真实 `pnpm smoke:codex`。真实用例包含
上述四个词汇以及现有句子/段落基线，同时校验无新持久 Codex session。真实
smoke 不访问欧路；欧路真实验收仍为独立手工步骤。

## 安全与隐私不变量

- 所有网页输入、模型增量、完整板块和最终结果都视为不可信。
- 预热请求只包含类型、版本和随机 request ID。
- 分析仍只发送选区、有界语义上下文和位于其中的精确英文句子，不发送 URL、
  标题或浏览历史。
- 不保存预热、查询、增量或结果历史。
- 模型内容只通过 `textContent` 渲染，不使用 `innerHTML`。
- App Server 仍固定内置 `openai`、`gpt-5.4-mini`、`low`、只读无网络沙箱、
  `never` 审批、无工具、无历史和新 ephemeral thread。
- Host 不读取、复制、解析或显示 `~/.codex/auth.json`。
- 欧路自动查词只发送原词；只有用户显式点击加词才发送原词和 `sentenceContext`。
- 不新增 Chrome 权限、远程扩展代码、Cookie 或持久存储。

## 版本、迁移与发布

统一升级：

- 根包：`0.4.0`
- `@huayi/extension`：`0.4.0`
- `@huayi/native-host`：`0.4.0`
- `@huayi/protocol`：`0.4.0`
- Extension Manifest：`0.4.0`
- Native Host `HOST_VERSION`：`0.4.0`
- Wire protocol：`2`

升级步骤：

1. `pnpm install && pnpm build`。
2. 在 `chrome://extensions` 刷新或替换 `apps/extension/dist`。
3. 复制当前扩展 ID，重新执行 `pnpm host:install -- --extension-id <ID>`。
4. 重新加载测试页，验证词汇渐进结果和右上角生词状态。
5. 在明确允许后运行真实 Codex smoke。

重装 Host 不读取、覆盖或删除现有欧路钥匙串项。无需重新配置欧路授权。

协议、Chrome 权限、安全边界、测试方式和安装流程实现时必须同步更新：

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/protocol.md`
- `docs/security.md`
- `docs/testing.md`
- `docs/setup-macos.md`
- 根级和受影响模块的 `AGENTS.md`

## 完成标准

- 报告的四个词汇在 fake App Server 合同、Host 组装、扩展渐进渲染和 E2E 中全部覆盖。
- 大小写、复数和词形建议不能使原始 `sourceText` 校验失败。
- 无自然内容时显示完整可用的核心结果，不渲染空板块。
- 不得因非法可选字段而静默伪造成功。
- 工具条预热不调用模型、不发送网页文本，并能被第一个 analyze 复用。
- 已校验词汇板块可在最终 `result` 前逐段显示。
- 关闭或新选区仍实际终止旧 Codex turn，迟到事件不能改写浮层。
- 诊断能区分校验阶段，且不泄漏任何不可信文本或凭据。
- Manifest 权限仍严格为 `["nativeMessaging"]`。
- 默认测试不访问 OpenAI、钥匙串或欧路。
- 完整质量门禁通过：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

真实 `pnpm smoke:codex` 不属于默认自动门禁，只在用户明确同意后作为发布前的
单独真实验收。
