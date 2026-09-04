import type { FormEvent } from "react";

import { HelpTip } from "./help-tip.js";

export function PairingApprovalForm(props: {
  approve: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  cloudUploadConsent: boolean;
  cloudWordCopyMode: "disabled" | "enabled";
  deviceLabel: string;
  extensionQueryModelMode: "byok" | "platform";
  setCloudUploadConsent: (value: boolean) => void;
  setCloudWordCopyMode: (value: "disabled" | "enabled") => void;
  setDeviceLabel: (value: string) => void;
  setExtensionQueryModelMode: (value: "byok" | "platform") => void;
  setStudyCaptureMode: (value: "automatic" | "manual") => void;
  studyCaptureMode: "automatic" | "manual";
}) {
  return (
    <main className="pairing-page" id="main-content">
      <section aria-labelledby="pairing-heading" className="pairing-card auth-card">
        <div className="pairing-brand">
          <span aria-hidden="true" className="brand-mark" />
          语见
        </div>
        <h1 id="pairing-heading">连接语见插件</h1>
        <p className="pairing-intro">确认连接此浏览器中的语见插件。若不是你发起的，请关闭此页。</p>
        <form className="pairing-form" onSubmit={(event) => void props.approve(event)}>
          <div className="pairing-field">
            <div className="pairing-field-label">
              <label htmlFor="device-label">设备名称</label>
              <HelpTip label="设备名称说明">
                给此浏览器起一个方便辨认的名字，可在设备列表中查看。
              </HelpTip>
            </div>
            <input
              autoComplete="off"
              id="device-label"
              maxLength={100}
              name="deviceLabel"
              onChange={(event) => props.setDeviceLabel(event.currentTarget.value)}
              required
              value={props.deviceLabel}
            />
          </div>
          <fieldset className="pairing-preferences">
            <legend>学习偏好</legend>
            <p className="pairing-scope">以下三项适用于此账号的所有已连接插件。</p>
            <div className="pairing-field">
              <label htmlFor="pairing-model">插件查询模型</label>
              <select
                aria-describedby="pairing-model-help"
                id="pairing-model"
                name="extensionQueryModelMode"
                onChange={(event) =>
                  props.setExtensionQueryModelMode(event.currentTarget.value as "byok" | "platform")
                }
                value={props.extensionQueryModelMode}
              >
                <option value="platform">使用语见额度</option>
                <option value="byok">使用自己的模型密钥</option>
              </select>
              <p id="pairing-model-help">
                {props.extensionQueryModelMode === "platform"
                  ? "查询内容经语见发送给模型服务商，并计入账号额度。"
                  : "查询内容直接发送给你选择的模型服务商，费用由服务商收取；密钥留在本机。"}
              </p>
            </div>
            <div className="pairing-field">
              <label htmlFor="pairing-capture">句子与段落收集</label>
              <select
                aria-describedby="pairing-capture-help"
                id="pairing-capture"
                name="studyCaptureMode"
                onChange={(event) =>
                  props.setStudyCaptureMode(event.currentTarget.value as "automatic" | "manual")
                }
                value={props.studyCaptureMode}
              >
                <option value="manual">手动加入待分析</option>
                <option value="automatic">查询后自动加入待分析</option>
              </select>
              <p id="pairing-capture-help">
                {props.studyCaptureMode === "manual"
                  ? "仅在你点击加入时，将所选内容保存到云端待分析。"
                  : "查询句子或段落时，将所选内容自动保存到云端待分析；不会自动开始深度分析。"}
              </p>
            </div>
            <div className="pairing-field">
              <label htmlFor="pairing-words">生词云端保存</label>
              <select
                aria-describedby="pairing-words-help"
                id="pairing-words"
                name="cloudWordCopyMode"
                onChange={(event) =>
                  props.setCloudWordCopyMode(event.currentTarget.value as "disabled" | "enabled")
                }
                value={props.cloudWordCopyMode}
              >
                <option value="enabled">同时保存到云端</option>
                <option value="disabled">仅保存在本机</option>
              </select>
              <p id="pairing-words-help">
                {props.cloudWordCopyMode === "enabled"
                  ? "今后新增的生词、原句和语境释义会保存到云端。"
                  : "今后新增的生词不上传，已有云端生词不受影响。"}
              </p>
            </div>
          </fieldset>
          <details className="pairing-privacy">
            <summary>数据与隐私详情</summary>
            <p>
              使用语见额度查询时，只发送所选英文及必要语境；查询内容和结果最多保留一小时，不会自动加入待分析或分析历史。
            </p>
            <p>
              使用自己的模型密钥时，密钥和该次查询结果不会发送给语见。上方的内容收集、生词保存仍分别按你的选择执行。
            </p>
            <p>
              不会上传页面地址、标题、视频编号或完整页面。<a href="/privacy">查看隐私说明</a>
            </p>
          </details>
          <label className="pairing-consent">
            <input
              checked={props.cloudUploadConsent}
              name="cloudUploadConsent"
              onChange={(event) => props.setCloudUploadConsent(event.currentTarget.checked)}
              required
              type="checkbox"
            />
            <span>我同意连接设备并应用以上偏好</span>
          </label>
          <button className="primary-button" disabled={!props.cloudUploadConsent} type="submit">
            确认连接
          </button>
        </form>
      </section>
    </main>
  );
}
