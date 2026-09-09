import type { PropsWithChildren } from "react";
import { useDidHide, useDidShow } from "@tarojs/taro";
import { taskLifecycle } from "./services/task-lifecycle";
import "./app.css";

export default function App({ children }: PropsWithChildren) {
  useDidHide(() => taskLifecycle.hide());
  useDidShow(() => taskLifecycle.show());
  return children;
}
