import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { storeYouTubeFixture } from "./store-youtube-package-fixture.ts";

export const learning = "[data-huayi-store-asbplayer]";
export const english = "[data-huayi-asbplayer-english]";
export const overlay = "[data-huayi-store-overlay]";
export const cues = [
  { originalStart: 0, originalEnd: 1500, start: 0, end: 1500, track: 0, text: "Learning matters." },
  {
    originalStart: 1500,
    originalEnd: 3000,
    start: 1500,
    end: 3000,
    track: 0,
    text: "Practice helps.",
  },
  {
    originalStart: 0,
    originalEnd: 3000,
    start: 0,
    end: 3000,
    track: 1,
    text: "学习很重要，练习有帮助。",
  },
];

// Offline reproduction of the M0-observed public document structure and private messages.
// No extension API is mocked: both registered content worlds and the Worker are real bundles.
const playerHtml = `<!doctype html><html><head><style>
body{margin:0;background:#222;color:white}.asbplayer-token-container{position:relative;width:100%;height:540px}
video{width:100%;height:100%;object-fit:contain}.asbplayer-subtitles{position:absolute;bottom:24px;left:35%}
.controls{position:absolute;top:0;left:0;z-index:20}
</style></head><body><div class="asbplayer-token-container"><video preload="auto" muted loop playsinline></video>
<div class="asbplayer-subtitles">Original fixture subtitles</div><div class="controls"><button id="play">Play</button><button id="fullscreen" aria-label="Toggle Fullscreen">Fullscreen</button></div></div>
<script>
const video=document.querySelector('video');video.src=new URL(location.href).searchParams.get('video');
let toggles=0;video.onclick=()=>{document.body.dataset.toggles=String(++toggles);video.paused?video.play():video.pause()};
document.querySelector('#play').onclick=()=>video.play();
document.querySelector('#fullscreen').onclick=()=>document.querySelector('.asbplayer-token-container').requestFullscreen();
const channel=new BroadcastChannel(new URL(location.href).searchParams.get('channel'));
channel.postMessage({command:'playModes',playModes:[1]});
channel.postMessage({command:'subtitles',value:${JSON.stringify(cues)}});
channel.postMessage({command:'offset',value:0});
document.body.dataset.fixture='ready';
</script></body></html>`;

function deepseekResponse(request: string): string {
  const parsed = JSON.parse(request) as { messages: { role: string; content: string }[] };
  const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
  const example = system.split("EXAMPLE_JSON_OUTPUT\n")[1]?.split("\n")[0];
  if (!example) throw new Error("Missing bounded model fixture shape.");
  const text = example.replaceAll("example", "Learning");
  const chunk = (content: string | null, role: string | null, finish: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content, role, reasoning_content: null }, finish_reason: finish, index: 0, logprobs: null }], created: 1, id: "offline", model: "deepseek-flash", object: "chat.completion.chunk" })}\n\n`;
  return (
    chunk("", "assistant", null) +
    chunk(text, null, null) +
    chunk(null, null, "stop") +
    "data: [DONE]\n\n"
  );
}

export async function createAsbplayerPackageFixture(live = false) {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-asbplayer-store-"));
  const extension = resolve("apps/store-extension/dist-release");
  let context: BrowserContext | undefined;
  const requests: string[] = [];
  try {
    context = await chromium.launchPersistentContext(directory, {
      channel: "chromium",
      headless: !live,
      viewport: { width: 1100, height: 820 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      ignoreDefaultArgs: ["--disable-extensions"],
    });
    context.setDefaultTimeout(8000);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "chrome-extension:") await route.continue();
      else if (url.origin === "https://app.asbplayer.dev") {
        if (live) {
          await route.continue();
          return;
        }
        await route.fulfill({
          contentType: "text/html",
          body: url.searchParams.has("video")
            ? playerHtml
            : '<!doctype html><body><h1>Offline asbplayer fixture</h1><button id="popup">Pop out</button></body>',
        });
      } else if (url.href === "https://api.deepseek.com/chat/completions") {
        const body = route.request().postData() ?? "";
        requests.push(body);
        await route.fulfill({ contentType: "text/event-stream", body: deepseekResponse(body) });
      } else if (url.origin === "https://example.test") {
        await route.fulfill({
          contentType: "text/html",
          body: "<body><p>Reading opens doors.</p></body>",
        });
      } else if (!live && url.origin === "https://www.youtube.com") {
        await route.fulfill({
          contentType: url.pathname === "/api/timedtext" ? "application/json" : "text/html",
          body:
            url.pathname === "/api/timedtext"
              ? JSON.stringify({
                  events: [
                    {
                      tStartMs: 0,
                      dDurationMs: 3000,
                      segs: [
                        {
                          utf8: url.searchParams.has("tlang")
                            ? "学习很重要。"
                            : "Learning matters.",
                        },
                      ],
                    },
                  ],
                })
              : storeYouTubeFixture,
        });
      } else await route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).hostname;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.locator('[data-settings-nav="credentials"]').click();
    await options.locator("[data-provider]").selectOption("deepseek");
    await options.locator('[data-credential-input="deepseek-api-key"]').fill("offline-fixture-key");
    await options.locator('[data-credential-save="deepseek-api-key"]').click();
    await expect(options.locator('[data-credential-status="deepseek-api-key"]')).toHaveText(
      "已配置",
    );
    await options.locator("[data-grant-consent]").click();
    const page = await context.newPage();
    await page.goto("https://app.asbplayer.dev/");
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 270;
      const painter = canvas.getContext("2d");
      if (!painter) throw new Error("Canvas unavailable");
      painter.fillStyle = "#244050";
      painter.fillRect(0, 0, 480, 270);
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const recorded = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      const repaint = setInterval(() => painter.fillRect(0, 0, 480, 270), 100);
      await new Promise((resolve) => setTimeout(resolve, 3100));
      recorder.stop();
      await recorded;
      clearInterval(repaint);
      stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    if (live) {
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles([
          { name: "fixture.webm", mimeType: "video/webm", buffer: Buffer.from(bytes) },
          {
            name: "en.srt",
            mimeType: "text/plain",
            buffer: Buffer.from(
              "1\n00:00:00,000 --> 00:00:01,500\nLearning matters.\n\n2\n00:00:01,500 --> 00:00:03,000\nPractice helps.\n",
            ),
          },
          {
            name: "zh.srt",
            mimeType: "text/plain",
            buffer: Buffer.from("1\n00:00:00,000 --> 00:00:03,000\n学习很重要，练习有帮助。\n"),
          },
        ]);
    } else
      await page.evaluate((bytes) => {
        const media = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "video/webm" }),
        );
        const channel = crypto.randomUUID();
        const frame = document.createElement("iframe");
        frame.id = "player";
        frame.style.cssText = "width:100%;height:560px;border:0";
        frame.dataset.channel = channel;
        frame.allowFullscreen = true;
        frame.src = `/?video=${encodeURIComponent(media)}&channel=${channel}`;
        document.body.append(frame);
        document
          .querySelector("#popup")
          ?.addEventListener("click", () =>
            window.open(frame.src, "fixture-player", "width=1000,height=700"),
          );
      }, bytes);
    const frame = page.frameLocator(live ? "iframe" : "#player");
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    return {
      context,
      page,
      options,
      frame,
      requests,
      mediaBytes: bytes,
      async close() {
        await context?.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function broadcast(page: Page, data: object): Promise<void> {
  await page.evaluate((payload) => {
    const channel = document.querySelector<HTMLIFrameElement>("#player")?.dataset.channel;
    if (!channel) throw new Error("Fixture missing");
    const sender = new BroadcastChannel(channel);
    sender.postMessage(payload);
    sender.close();
  }, data);
}
