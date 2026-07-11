# 架构说明

## 系统边界

```text
网页选区
  -> Content Script（选区、上下文、Shadow DOM 浮层）
  -> MV3 Service Worker（请求路由、取消、Native Messaging）
  -> 本机 Node Host（协议校验、并发与超时）
  -> AnalysisProvider
  -> codex exec --ephemeral
```

依赖方向固定为 `extension -> protocol <- native-host`。共享协议不感知 Chrome、Node 或
Codex；未来的云端模型、其他浏览器和其他操作系统通过各自边界扩展。

## 组件职责

- Content Script：读取英文选区与所在语义块，分类文本，展示和关闭浮层。
- Service Worker：持有请求 ID 与 Native Messaging 连接，不保存页面或模型数据。
- Native Host：读取/写入二进制帧，校验协议，管理最多两个 Codex 子进程。
- Codex Provider：构建不可信数据提示、选择输出 Schema、解析结构化结果。
- Protocol：提供请求、结果、错误、wire event 的唯一公共定义。

## 扩展方式

- 新 provider 实现 `AnalysisProvider`，不得修改扩展 UI 的公共数据结构。
- 新浏览器创建新的 app 并复用 `@huayi/protocol`。
- 新操作系统只增加 installer，实现相同 Native Messaging host 接口。

## 生产依赖决策

`@huayi/protocol` 使用 Zod 对来自网页、扩展、Native Messaging 和模型的对象执行运行时
校验。备选方案是手写类型守卫或仅依赖 TypeScript 静态类型；前者容易在四类结果中产生规则
漂移，后者无法保护运行时边界，因此不采用。Zod 会增加少量打包体积，但其严格对象 Schema
可以拒绝未知字段并缩小不可信数据进入系统的范围；升级时必须审查其变更和依赖树。
