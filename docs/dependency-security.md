# 依赖安全维护

开发环境使用 pnpm 10.34.5；Node 支持 22.13+（22 LTS）或 24+，macOS CI 使用 24，
Windows SEA 构建继续要求 26+。`packageManager` 是项目唯一 pnpm pin。
升级后运行 `pnpm install --frozen-lockfile`，不要把旧 node_modules 的测试结果当作新锁文件证据。

## 检查入口

- `pnpm audit:all`：完整锁文件审计，包含开发工具，中危及以上失败。
- `pnpm audit:prod`：单独保留生产依赖视图，中危及以上失败。
- `pnpm audit:toolchain`：核对实际执行的 pnpm 版本、安装锁元数据，以及每条依赖从父包
  真实解析到的包名/版本；补丁同时校验文件哈希及其在实际包上的反向适用性，防止同版本
  未打补丁的安装副本蒙混过关。再查询这些实际版本和 pnpm 自身的公告。平台可选包缺席单独计数，
  缺失必需依赖、版本漂移、网络错误和无效审计响应都失败。
- `pnpm audit:security`：顺序执行上述检查，已接入 macOS/Windows 验证脚本。

完整锁文件仍覆盖其他平台的可选包，实际安装检查只覆盖当前机器能解析的模块。
不扫描 npm 缓存中未使用的包，也不把这些检查扩大为 Node 二进制、浏览器、托管平台或
已经部署制品的安全背书。公告数字与实际可利用性分别判断；没有配置公告忽略列表。

## Taro 4.2.1 补丁

当前稳定版的模板及构建依赖有无修复原包，因此在固定消费者维护 pnpm 补丁。
版本覆盖、新增依赖和移除的旧依赖统一保存在 `pnpm-workspace.yaml`，补丁纳入锁文件哈希。

| 补丁                       | 保留的行为与修复边界                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| download-git-repo 3.0.2    | 保留回调、Git ref 和 ZIP/TAR 模板；使用原生 fetch、维护中的 ESM 解压器及无 shell 的 Git 参数数组，替代 download/decompress/git-clone 旧链 |
| Taro CLI 4.2.1             | latest-version 9 通过动态 import 接入，保留异步更新查询                                                                                   |
| webpack5 runner 4.2.1      | XML 压缩改用异步 html-minifier-terser，调用链等待结果；WDS 5 使用 server 选项并转换旧 https/http2 配置，默认 loopback + Host 校验         |
| miniprogram-simulate 1.6.2 | Node 消费者迁移到 PostCSS 8 插件和 LESS 4，保留同步局部导入与原算术语义，禁用输入 CSS 的外部 previous source map                          |

相关安全版本包括 PostCSS 8.5.28、WDS 5.2.6、esbuild 0.25.12、adm-zip 0.6.1、
serialize-javascript 7.1.1、Vitest/coverage-v8 4.1.11、qs 6.16.0、js-yaml 4.3.2、glob 10.5.0。
版本是本次验证候选，并不保证未来没有新公告。

Taro 的模拟器包还分发一个独立 `window.simulate` 浏览器 bundle；当前 Node 入口和 Taro
预渲染的 `src/api` 不加载该文件，仓库也没有导入它。本次不维护这个未使用的历史 bundle；
如果以后引入浏览器模拟器，必须重新审计并替换该产物，不能引用当前 Node 验证作为证明。

升级 Taro 时应重新审查并尽量移除这些补丁，不能跨版本默默套用。
模板归档仅保留普通文件和可验证的内部链接；链接目标含父目录段、绝对路径或驱动器前缀时
拒绝整次解压。这也会拒绝原本可能安全的父目录相对链接，模板需改用普通文件或无父目录段的内部链接。
原始模板来源、下载凭据和真实模型不用于测试；安全夹具只访问本机临时目录和 loopback。
`scripts/taro-dependency-security-*.test.mjs`、`scripts/taro-h5-dev-server.test.mjs` 和
`scripts/dependency-security.test.mjs` 覆盖真实消费者、正常输出、归档越界、CSS 外部读取、
开发服务器启动、Host 拒绝与热更新。它们随 `pnpm test:scripts` 执行。

## 测试工具迁移

Vitest 与 coverage-v8 固定同一版本。Vitest 4 移除了 `coverage.all`，已有显式 include
仍同时覆盖已执行和未执行文件，四项 85% 阈值保持不变。
迁移依据：[Vitest 4 官方说明](https://v4.vitest.dev/guide/migration)、
[WDS 5 官方迁移说明](https://github.com/webpack/webpack-dev-server/blob/main/migration-v5.md)。

任何共享工具升级都分别记录两平台证据。构建成功不等于安装验收，未发布的修复也不等于
既有线上包已经更新；提交、推送、部署与真实产品安装仍需要对应任务授权。
