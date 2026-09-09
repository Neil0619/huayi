import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Input, Text, View } from "@tarojs/components";
import {
  accountDataRightsHttpRoutes,
  accountDataExportJobResourceSchema,
  accountDeletionResponseSchema,
} from "@huayi/cloud-contracts";
import { useAction, useResource } from "../../components/hooks";
import {
  Action,
  Card,
  Notice,
  Paragraph,
  Screen,
  appearances,
  confirmAction,
  currentAppearance,
  navigate,
} from "../../components/ui";
import { learningApi, route, write } from "../../services/api";
import { session } from "../../services/session";
import { localStore } from "../../services/storage";
import { downloadData } from "../../services/download";

export default function Me() {
  const resource = useResource(async () => ({
    preferences: await learningApi.preferences(),
    quota: await learningApi.quota(),
    export: await learningApi.currentExport(),
    jobs: await learningApi.wordbookJobs(),
  }));
  const action = useAction();
  const [goal, setGoal] = useState("");
  const [appearance, setAppearance] = useState(currentAppearance);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (resource.data) setGoal(String(resource.data.preferences.dailyGoal));
  }, [resource.data]);
  const account = session.getSnapshot().account;
  const data = resource.data;
  const exportJob = data?.export.job;
  return (
    <Screen title="我的" subtitle="按自己的节奏，慢慢积累。">
      <Notice text={resource.error || action.error || notice} />
      <Card title={account?.email ?? "微信学习账号"}>
        <Text className="pill">
          {account?.linkedToWeb ? "已关联网页 · 数据与额度共用" : "独立微信账号"}
        </Text>
        <Paragraph>
          {account?.linkedToWeb
            ? "两端使用同一份学习数据。"
            : "当前账号独立使用，首版不迁移或合并学习记录。"}
        </Paragraph>
      </Card>
      {data && (
        <>
          <Card title="今日目标">
            <Input
              className="input"
              type="number"
              value={goal}
              maxlength={3}
              onInput={(event) => setGoal(event.detail.value)}
            />
            <Text className="muted">每天 1—100 项，北京时间换日。</Text>
            <Action
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await learningApi.setPreferences({
                    dailyGoal: Number(goal),
                    expectedRevision: data.preferences.revision,
                    timezone: "Asia/Shanghai",
                  });
                  setNotice("学习目标已更新。");
                  await resource.reload();
                })
              }
            >
              保存目标
            </Action>
          </Card>
          <Card title="本月额度">
            <Text className="metric">{Math.round(data.quota.percentUsed)}%</Text>
            <Paragraph>
              已用 ${(data.quota.usedMicroUsd / 1_000_000).toFixed(3)} / $
              {(data.quota.limitMicroUsd / 1_000_000).toFixed(2)}
            </Paragraph>
            <Paragraph>剩余可用 ${(data.quota.availableMicroUsd / 1_000_000).toFixed(3)}</Paragraph>
            <Text className="muted">额度按服务端的 UTC 月周期重置，与网页共用。</Text>
          </Card>
        </>
      )}
      <Card title="外观">
        <View className="row">
          {Object.entries(appearances).map(([key, label]) => (
            <Action
              key={key}
              secondary={appearance !== key}
              onClick={() => {
                Taro.setStorageSync("seen-said:appearance", key);
                setAppearance(key);
                Taro.eventCenter.trigger("seen-said:appearance-changed");
              }}
            >
              {label}
            </Action>
          ))}
        </View>
        <Text className="muted">仅保存在当前设备。</Text>
      </Card>
      <Card title="隐私与数据">
        <Paragraph>
          账号仅使用微信身份识别，不收集手机号或头像。原文与学习记录保存在语见服务端；主动分析和练习反馈会使用模型服务。
        </Paragraph>
        <Action
          secondary
          onClick={() =>
            void action.run(async () => {
              Taro.openPrivacyContract();
            })
          }
        >
          查看微信隐私保护指引
        </Action>
        <Action secondary onClick={() => void action.run(() => downloadData())}>
          导出生词表
        </Action>
        <Action
          secondary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await learningApi.export();
              setNotice("导出任务已创建，可稍后刷新查看。文件就绪后需再次微信验证才能下载。");
              await resource.reload();
            })
          }
        >
          导出全部学习数据
        </Action>
        {exportJob && (
          <>
            <Paragraph>
              数据导出：
              {
                {
                  pending: "等待处理",
                  running: "处理中",
                  ready: "文件已就绪",
                  failed: "处理失败，可重试",
                  expired: "文件已过期",
                }[exportJob.state]
              }
            </Paragraph>
            {exportJob.state === "ready" && (
              <Action
                disabled={action.busy}
                onClick={() => void action.run(() => downloadData(exportJob.id))}
              >
                验证微信身份并下载
              </Action>
            )}
            {exportJob.state === "failed" && (
              <Action
                secondary
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await write(
                      route(accountDataRightsHttpRoutes.retryExport, exportJob.id),
                      accountDataExportJobResourceSchema,
                      { expectedRevision: exportJob.revision },
                      "POST",
                      exportJob.revision,
                    );
                    await resource.reload();
                  })
                }
              >
                重试导出
              </Action>
            )}
          </>
        )}
        <Action
          secondary
          onClick={() =>
            void action.run(async () => {
              if (
                await confirmAction(
                  "清除本机草稿",
                  "只清除当前账号在本机尚未提交的输入，服务器学习数据保留。",
                )
              ) {
                localStore.clearDrafts();
                setNotice("本机草稿已清除。");
              }
            })
          }
        >
          清除本机草稿
        </Action>
      </Card>
      {data && (
        <Card title="词书任务状态">
          <Paragraph>欧路、扇贝自动同步由桌面插件执行。你也可以先导出生词表。</Paragraph>
          {data.jobs.items.map((job) => (
            <Paragraph key={job.id}>
              {job.target === "eudic" ? "欧路" : "扇贝"} ·{" "}
              {
                {
                  pending: "等待插件执行",
                  active: "执行中",
                  completed: "已完成",
                  failed: "执行失败",
                  cancelled: "已取消",
                  "source-limit-reached": "达到导入上限",
                }[job.state]
              }
            </Paragraph>
          ))}
          {!data.jobs.items.length && <Text className="muted">暂无词书同步任务。</Text>}
        </Card>
      )}
      <Action secondary onClick={() => void navigate("history")}>
        学习记录
      </Action>
      <Action secondary onClick={() => void resource.reload()}>
        刷新额度与任务状态
      </Action>
      <Action
        secondary
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            if (await confirmAction("退出登录", "将撤销当前小程序会话。")) {
              await session.logout();
              await Taro.reLaunch({ url: "/pages/login/index" });
            }
          })
        }
      >
        退出登录
      </Action>
      <Action
        secondary
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            if (
              !(await confirmAction(
                "注销语见账号",
                account?.linkedToWeb
                  ? "这会删除网页和小程序共用的全部学习数据，无法恢复。请先导出数据。"
                  : "这会删除当前微信账号的全部学习数据，无法恢复。请先导出数据。",
              ))
            )
              return;
            await session.reauthenticate();
            if (!(await confirmAction("最后确认", "确认永久注销此账号并删除全部学习数据？")))
              return;
            await write(accountDataRightsHttpRoutes.deleteAccount, accountDeletionResponseSchema, {
              confirmation: "delete-account",
            });
            localStore.clear();
            session.clear();
            await Taro.reLaunch({ url: "/pages/login/index" });
          })
        }
      >
        注销账号
      </Action>
    </Screen>
  );
}
