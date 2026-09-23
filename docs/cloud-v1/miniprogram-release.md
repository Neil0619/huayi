# 语见小程序发布准备

更新日期：2026-09-23。范围：shared（小程序与本地发布工具），本机执行；iOS/Android 真机与微信审核平台尚待验证。首版保留 `1.0.0`，与 Classic `0.13.0`、Store 本轮商店版本 `1.0.2` 分别维护。

## 当前证据与阻断

- 用户已确认备案完成。当前 `apps/miniprogram/dist` 仍是游客 AppID、空 API 的离线包，不能作为上传包。
- 历史 AppID 为 `wx3744b8eeaed83383`；最终 AppID、后台版本、账号主体、合法域名、隐私声明、服务类目与审核状态必须在当前微信后台核对。电脑工具访问后台触发网址安全限制，本次未完成后台回读，不能绕过限制。
- 正式 API 项目 `prj_NePC3jZHC6UBARQjRzImNcAmbrdu` 只读环境元数据缺少 `HUAYI_WECHAT_APP_ID` 和 `HUAYI_WECHAT_APP_SECRET`，**正式微信登录未配置，是上线阻断项**。根任务已核对正式健康与隐私页 200、线上 SHA `063e4dd`、部署 `dpl_2bpXkKoXciLB8ybsG9auA6E6oeCj`。200 不证明微信认证或全部业务流程可用。本地证据：[正式就绪检查](../../artifacts/store-resubmission-20260923/production-readiness.json)。
- 2026-09-09 验收候选 `49cff1d` 已包含 0031，已有账号登录及 `daily-queue` 返回 200；当时绕过合法域名校验，仅作验收环境历史证据。不得因此重放已应用迁移，也不能视为正式域名通过。
- 2026-09-22 依赖修复 39 文件与本次初始工作区一致，当次依赖审计 0 告警；首次 17 项告警不是当前结论。最终候选仍需当前依赖审计与完整门禁。

## 显式本地发布构建

先核对目标，再以非秘密环境变量提供以下四个值。这里不预填正式 API 入口，不自行选择目标：

```sh
export HUAYI_MINIPROGRAM_APP_ID='<后台确认的真实AppID>'
export HUAYI_MINIPROGRAM_API_ORIGIN='<确认的正式HTTPS origin>'
export HUAYI_MINIPROGRAM_RELEASE_VERSION='1.0.0'
export HUAYI_MINIPROGRAM_RELEASE_SHA='<当前候选完整40位HEAD SHA>'
pnpm --filter @huayi/miniprogram build:release
pnpm --filter @huayi/miniprogram audit:release
```

命令复用共享依赖和现有 Taro weapp 构建，输出独立 `apps/miniprogram/dist-release`；普通 `build` 仍输出 `dist` 并允许游客模式。发布变量不含 AppSecret，脚本不读取服务端秘密、不安装依赖、不访问微信/API/模型、不上传或部署。不要同时运行另一个会改写共享依赖产物的构建。

发布配置拒绝缺失值、游客 AppID、非 HTTPS origin、用户名/密码/端口/路径/尾斜线、明显测试或验收域名、与小程序包不符的版本，以及与 HEAD 不符的完整 SHA。正式 origin 的语法检查不证明域名备案、证书、微信后台授权或可访问性。

构建先记录有关源码、共享依赖、构建配置与锁文件摘要，完成后回读确认输入未变化。产物审计检查：

1. AppID 和发布身份相符，`project.config.json` 的 `urlCheck` 严格为 `true`，私有项目配置不得关闭校验。
2. 实际模块报告含 React 18.3.1，拒绝其他 React 版本、测试/测试支撑模块；核心登录和练习页面存在。
3. 已编译 JS 包含明确 API origin；包内不包含测试文件、环境文件、私钥或明显服务端凭证模式。启发式检查不替代秘密管理和人工复核。
4. 回执保存所有产物 SHA-256 与模块报告摘要；`audit:release` 再次检查配置、源码及每个产物，任何变更要求重建。

本地无秘密回执为 `artifacts/miniprogram-release/receipt.json`，模块清单为同目录 `bundle-report.json`；两者和 `dist-release` 均被 Git 忽略。构建中的编译或审计失败写入 `failed`；单独 `audit:release` 是只读回读，失败返回非零并保留原构建回执，旧回执不能充当本次回读通过的证据。并发锁只限制该发布入口；意外退出遗留 `.lock` 时，确认没有发布构建进程后再手动清理。

回执记录 HEAD 和当前输入快照，也明确列出相关未提交改动。存在未提交改动时，产物属于该工作区快照，**不能声称是干净 SHA 的构建**。正式发布应冻结完整候选并重建、回读最终回执；本地 `passed` 只代表构建和产物审计，不等于全部质量门禁、体验验收或发布完成。

## 后续验收与交付顺序

1. 人工在微信后台核对账号身份和待上传版本；确认备案、正式 API HTTPS 可达，request 与 downloadFile 合法域名一致。保留 `urlCheck: true`，关闭工具和真机所有“不校验合法域名”绕过。
2. 按独立明确授权，将对应 AppID/AppSecret 配置到正确正式 API 的服务端秘密配置；客户端只能使用公开 AppID。配置/部署后重新验证正式微信登录，不能以健康 200 替代。
3. 只读核对目标已有 0029、0030、0031 及后续迁移链、身份与必要 worker 状态。迁移、Cron、模型调用、真实邮件、费用或生产配置修改均不由本地发布构建授权。
4. 冻结最终候选，执行准确候选的双平台 CI、全量测试、类型/lint/格式、覆盖率、依赖审计及相关平台门禁。Hosted 快速迭代豁免不适用于小程序正式交付；历史绿灯不能替代最终候选。
5. 在 iOS/Android 真机验证首次开通、已有账号密码关联及错误/过期恢复、数据与额度一致、认证下载、纯微信/关联账号注销、权限拒绝；检查键盘、安全区、粘贴、断网、后台和重启恢复。真实模型与付费操作须另行授权，保存原文不得触发模型。
6. 获得明确上传授权后，将核验过的 `dist-release` 导入开发者工具，再次检查本机私有设置未覆盖合法域名校验，填写确认的 `1.0.0` 和更新说明，上传并设置体验成员。体验验收、提审和最终发布分别留存平台回读证据。

本地发布命令本身不提交、推送、部署或上传，也不宣称正式目标已经就绪。
