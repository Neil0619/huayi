export default {
  pages: [
    "pages/today/index",
    "pages/inbox/index",
    "pages/library/index",
    "pages/me/index",
    "pages/login/index",
    "pages/collect/index",
    "pages/analysis/index",
    "pages/item/index",
    "pages/practice/index",
    "pages/history/index",
  ],
  window: {
    navigationBarTitleText: "语见 · Seen & Said",
    navigationBarBackgroundColor: "#f7f8fa",
    navigationBarTextStyle: "black",
    backgroundColor: "#f7f8fa",
  },
  tabBar: {
    color: "#646b78",
    selectedColor: "#3d5685",
    backgroundColor: "#ffffff",
    borderStyle: "white",
    list: [
      { pagePath: "pages/today/index", text: "今日练习" },
      { pagePath: "pages/inbox/index", text: "收集箱" },
      { pagePath: "pages/library/index", text: "学习库" },
      { pagePath: "pages/me/index", text: "我的" },
    ],
  },
  lazyCodeLoading: "requiredComponents",
};
