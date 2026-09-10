import { useEffect, useState } from "react";

export function PairingApprovedPage() {
  const [secondsRemaining, setSecondsRemaining] = useState(3);

  useEffect(() => {
    let remaining = 3;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining === 0) {
        window.clearInterval(timer);
        location.assign("/practice");
        return;
      }
      setSecondsRemaining(remaining);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="configuration-error" id="main-content">
      <span aria-hidden="true" className="brand-mark" />
      <p className="eyebrow">SEEN & SAID</p>
      <h1>设备配对已批准</h1>
      <p aria-atomic="true" role="status">
        扩展设备已批准，{secondsRemaining} 秒后自动进入学习平台。
      </p>
      <a className="primary-button" href="/practice">
        立即进入学习平台
      </a>
    </main>
  );
}
