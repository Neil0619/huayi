import { useEffect, useState, type PropsWithChildren } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import type { LearningItemContent } from "@huayi/cloud-contracts";

export const appearances = {
  silver: "流银镜白",
  moon: "去青月白",
  champagne: "香槟晨霜",
  porcelain: "霁蓝瓷光",
};
export function currentAppearance() {
  const value = Taro.getStorageSync<unknown>("seen-said:appearance");
  return typeof value === "string" && value in appearances ? value : "silver";
}
export function Screen({
  title,
  subtitle,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string }>) {
  const [theme, setTheme] = useState(currentAppearance);
  useEffect(() => {
    const change = () => setTheme(currentAppearance());
    Taro.eventCenter.on("seen-said:appearance-changed", change);
    return () => {
      Taro.eventCenter.off("seen-said:appearance-changed", change);
    };
  }, []);
  useDidShow(() => setTheme(currentAppearance()));
  return (
    <View className={`screen theme-${theme}`}>
      <View className="screen-heading">
        <Text className="eyebrow">SEEN & SAID</Text>
        <Text className="title">{title}</Text>
        {subtitle && <Text className="muted">{subtitle}</Text>}
      </View>
      {children}
    </View>
  );
}
export function Card({ title, children }: PropsWithChildren<{ title?: string }>) {
  return (
    <View className="card">
      {title && <Text className="card-title">{title}</Text>}
      {children}
    </View>
  );
}
export function Action({
  children,
  onClick,
  disabled = false,
  secondary = false,
}: PropsWithChildren<{ onClick: () => void; disabled?: boolean; secondary?: boolean }>) {
  return (
    <Button
      className={`action ${secondary ? "secondary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export function Notice({ text }: { text: string }) {
  return text ? (
    <View className="notice" role="alert">
      <Text userSelect>{text}</Text>
    </View>
  ) : null;
}
export function Empty({ text }: { text: string }) {
  return (
    <View className="empty">
      <Text>{text}</Text>
    </View>
  );
}
export function Paragraph({ children }: PropsWithChildren) {
  return (
    <Text className="paragraph" userSelect>
      {children}
    </Text>
  );
}
export function contentLabel(content: LearningItemContent) {
  return content.type === "expression" ? content.text : content.template;
}
export function contentMeaning(content: LearningItemContent) {
  return content.type === "expression" ? content.meaningZh : content.functionZh;
}
export function navigate(page: string, params: Record<string, string> = {}) {
  return Taro.navigateTo({
    url:
      `/pages/${page}/index` +
      (Object.keys(params).length
        ? `?${Object.entries(params)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join("&")}`
        : ""),
  });
}
export function loginPage() {
  if (Taro.getCurrentPages().at(-1)?.route !== "pages/login/index") void navigate("login");
}
export async function confirmAction(title: string, content: string) {
  return (await Taro.showModal({ title, content, confirmText: "确认", cancelText: "取消" }))
    .confirm;
}
