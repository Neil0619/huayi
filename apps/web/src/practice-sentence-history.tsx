import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeSession, PracticeTeachingDetail } from "@huayi/cloud-contracts";
import type { WebPracticeTeaching } from "./practice-teaching-api.js";
import { practiceTeachingMatches } from "./practice-session-state.js";
import { PracticeAttemptsReview } from "./practice-teaching-feedback.js";

export function PracticeSentenceHistory({
  session,
  api,
  onReload,
}: {
  readonly session: PracticeSession;
  readonly api?: WebPracticeTeaching | undefined;
  readonly onReload?: (() => void) | undefined;
}) {
  const [detail, setDetail] = useState<PracticeTeachingDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const read = useCallback(async () => {
    if (!api) return;
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await api.get(session.id);
      if (ticket !== generation.current) return;
      if (!practiceTeachingMatches(next, session)) throw new Error("History snapshot changed.");
      setDetail(next);
    } catch {
      if (ticket === generation.current)
        setError("教学信息暂时未能读取，下面保留已保存的文字记录。");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [api, session]);
  useEffect(() => {
    setDetail(null);
    void read();
    return () => {
      generation.current += 1;
    };
  }, [read]);
  const teaching = detail && practiceTeachingMatches(detail, session) ? detail.teaching : null;
  return (
    <section>
      <h3>句子作答与反馈</h3>
      {loading && <p role="status">正在读取教学信息…</p>}
      {error && (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => (onReload ? onReload() : void read())}
          >
            重新读取练习详情
          </button>
        </div>
      )}
      <PracticeAttemptsReview session={session} teaching={teaching} expanded />
    </section>
  );
}
