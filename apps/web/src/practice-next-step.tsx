import type { usePracticeNavigation } from "./use-practice-navigation.js";

export function PracticeNextStep({
  state,
  busy,
}: {
  readonly state: ReturnType<typeof usePracticeNavigation>;
  readonly busy: boolean;
}) {
  return (
    <div className="practice-next-step">
      <p>自评已保存，排期已更新。</p>
      {state.nextPractice.state === "loading" && <p role="status">正在检查待练内容…</p>}
      {state.nextPractice.state === "error" && (
        <div role="status">
          <p>暂时无法检查待练内容，你的自评和反馈已保存。</p>
          <button disabled={busy} onClick={() => void state.refreshNext()} type="button">
            重新检查待练内容
          </button>
        </div>
      )}
      {state.nextPractice.state === "ready" &&
        (state.nextPractice.item ? (
          <button
            data-next-practice
            disabled={busy}
            onClick={() => void state.next()}
            type="button"
          >
            练习下一项
          </button>
        ) : (
          <section className="practice-complete" role="status">
            <h4>今天没有待练习内容</h4>
            <p>本次作答和自评已保存，可以稍后再来复习。</p>
            <button disabled={busy} onClick={() => void state.control("end")} type="button">
              返回今日总览
            </button>
            <a href="/library">去学习库选择其他内容</a>
          </section>
        ))}
    </div>
  );
}
