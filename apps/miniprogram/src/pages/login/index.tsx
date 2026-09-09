import { useState, useSyncExternalStore } from "react";
import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { miniProgramBindingStatusSchema, miniProgramRoutes } from "@huayi/cloud-contracts";
import { Action, Card, Notice, Paragraph, Screen } from "../../components/ui";
import { useAction } from "../../components/hooks";
import { session } from "../../services/session";
import { apiOrigin, rawRequest } from "../../services/http";

export default function Login() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const action = useAction();
  const [link, setLink] = useState(false);
  const [notice, setNotice] = useState("");
  const done = () => Taro.switchTab({ url: "/pages/today/index" });
  const login = () =>
    action.run(async () => {
      apiOrigin();
      if (typeof Taro.requirePrivacyAuthorize === "function") await Taro.requirePrivacyAuthorize();
      await session.login();
      setNotice("");
      if (session.getSnapshot().account) await done();
    });
  return (
    <Screen title="把看见的，变成会说的。" subtitle="语见 · Seen & Said">
      <Card title="随手收集，每天练一点">
        <Paragraph>收集值得记住的英文，用讲解读懂它，再用自己的句子把它留下。</Paragraph>
        <View className="row">
          <Text className="pill">原文分析</Text>
          <Text className="pill">表达与句型</Text>
          <Text className="pill">日常练习</Text>
        </View>
      </Card>
      <Notice text={action.error || notice} />
      {!state.onboarding ? (
        <>
          <Card title="隐私说明">
            <Paragraph>
              微信登录用于识别你的账号。原文、学习记录保存在语见服务端；仅在你主动分析或获取练习反馈时发送给模型服务。未提交的草稿和外观保存在当前设备。
            </Paragraph>
            <Paragraph>
              你可以在“我的”导出学习数据、清除设备草稿或注销账号。不要求邮箱或手机号。
            </Paragraph>
          </Card>
          <Action disabled={action.busy} onClick={() => void login()}>
            {action.busy ? "正在登录…" : "同意隐私说明并微信登录"}
          </Action>
        </>
      ) : (
        <Card title={link ? "关联已有语见账号" : "选择开通方式"}>
          {!link ? (
            <>
              <Paragraph>
                直接使用会创建独立微信账号。若你已有网页学习记录，请先关联；首版不合并两个独立账号。
              </Paragraph>
              <Action
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await session.finish("independent");
                    await done();
                  })
                }
              >
                直接开始使用
              </Action>
              <Action secondary disabled={action.busy} onClick={() => setLink(true)}>
                关联已有语见账号
              </Action>
              <Action secondary disabled={action.busy} onClick={() => void login()}>
                重新微信登录
              </Action>
            </>
          ) : (
            <>
              <Paragraph>
                在已登录语见网页的“账号与额度 →
                微信小程序关联”中输入下方绑定码，完成近期身份验证并确认。
              </Paragraph>
              <Text className="code" userSelect>
                {state.onboarding.bindingCode}
              </Text>
              <Text className="muted">
                此码 10 分钟内有效，仅用于本次开通。请勿使用插件配对入口。
              </Text>
              <Action
                secondary
                onClick={() =>
                  void action.run(() =>
                    Taro.setClipboardData({ data: state.onboarding?.bindingCode ?? "" }),
                  )
                }
              >
                复制绑定码
              </Action>
              <Action
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = miniProgramBindingStatusSchema.parse(
                      await rawRequest(miniProgramRoutes.bindingStatus, {
                        method: "POST",
                        data: { ticket: state.onboarding?.ticket },
                      }),
                    );
                    if (result.status === "approved") {
                      await session.finish("linked");
                      await done();
                    } else
                      setNotice(
                        result.status === "expired"
                          ? "绑定码已过期，请重新微信登录。"
                          : "尚未收到网页确认，请在网页完成关联。",
                      );
                  })
                }
              >
                我已在网页确认
              </Action>
              <Action secondary disabled={action.busy} onClick={() => void login()}>
                重新获取绑定码
              </Action>
              <Action
                secondary
                disabled={action.busy}
                onClick={() => {
                  setLink(false);
                  setNotice("");
                  action.setError("");
                }}
              >
                返回选择开通方式
              </Action>
            </>
          )}
        </Card>
      )}
    </Screen>
  );
}
