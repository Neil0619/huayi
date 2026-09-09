import { useState, useSyncExternalStore } from "react";
import Taro, { useDidHide } from "@tarojs/taro";
import { Input, Text, View } from "@tarojs/components";
import { passwordLoginRequestSchema } from "@huayi/cloud-contracts";
import { Action, Card, Notice, Paragraph, Screen } from "../../components/ui";
import { useAction } from "../../components/hooks";
import { session } from "../../services/session";
import { apiOrigin } from "../../services/http";
import { MiniError } from "../../services/errors";

export default function Login() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const action = useAction();
  const [link, setLink] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useDidHide(() => setPassword(""));
  const credentials = passwordLoginRequestSchema.safeParse({ email, password });
  const done = () => Taro.switchTab({ url: "/pages/today/index" });
  const login = () =>
    action.run(async () => {
      setPassword("");
      apiOrigin();
      if (typeof Taro.requirePrivacyAuthorize === "function") await Taro.requirePrivacyAuthorize();
      await session.login();
      if (session.getSnapshot().account) await done();
    });
  const loginAndLink = () =>
    action.run(async () => {
      if (!credentials.success) throw new MiniError("invalid_request");
      setPassword("");
      try {
        await session.loginAndLink(credentials.data);
      } catch (error) {
        if (error instanceof MiniError && error.code === "authentication_required")
          throw new MiniError("account_link_unavailable");
        if (
          error instanceof MiniError &&
          ["rate_limited", "operation_in_progress"].includes(error.code)
        )
          throw error;
        throw new MiniError("account_link_unknown");
      }
      await done();
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
      <Notice text={action.error} />
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
                使用已有语见账号的邮箱和登录密码。登录并关联后，当前微信将共用该账号的学习数据与额度。
              </Paragraph>
              <Text>语见账号邮箱</Text>
              <Input
                className="input"
                value={email}
                maxlength={320}
                disabled={action.busy}
                placeholder="输入语见账号邮箱"
                onInput={(event) => setEmail(event.detail.value)}
              />
              <Text>语见登录密码</Text>
              <Input
                className="input"
                password
                value={password}
                maxlength={256}
                disabled={action.busy}
                placeholder="输入该账号的登录密码"
                onInput={(event) => setPassword(event.detail.value)}
              />
              <Paragraph>
                点击“登录并关联”即确认关联到上方账号。仅使用 Google
                登录的账号，请先在网页设置中添加密码登录方式。
              </Paragraph>
              <Action
                disabled={action.busy || !credentials.success}
                onClick={() => void loginAndLink()}
              >
                {action.busy ? "正在登录并关联…" : "登录并关联"}
              </Action>
              <Action secondary disabled={action.busy} onClick={() => void login()}>
                重新微信登录
              </Action>
              <Action
                secondary
                disabled={action.busy}
                onClick={() => {
                  setLink(false);
                  setPassword("");
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
