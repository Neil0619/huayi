import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import {
  handleContentSettingsMessage,
  isContentSettingsMessage,
} from "./content-settings-handler.js";

const url =
  "https://app.asbplayer.dev/?video=blob:https://app.asbplayer.dev/12345678-1234-1234-1234-123456789abc&channel=player-session";
const request = { type: "store/asbplayer-settings", messageVersion: STORE_MESSAGE_VERSION };
const settings = {
  globallyEnabled: true,
  sitePolicy: { defaultAction: "allow" as const, rules: [] },
  youtubeMode: "disabled" as const,
  youtubeShortcut: null,
  asbplayerMode: "english" as const,
  asbplayerShortcut: null,
};

describe("asbplayer settings authorization", () => {
  it("authorizes exact local stream players and rejects broader network sources", async () => {
    const stream = `http://127.0.0.1:45678/stream/${"a".repeat(64)}`;
    const sender = (media: string) =>
      `https://app.asbplayer.dev/?video=${encodeURIComponent(media)}&channel=local-player`;
    await expect(
      handleContentSettingsMessage(
        request,
        sender(stream),
        async () => settings,
        async () => "silver",
      ),
    ).resolves.toMatchObject({ type: "store/asbplayer-settings-result", asbplayerMode: "english" });
    for (const invalid of [
      stream.replace("127.0.0.1", "localhost"),
      stream + "?path=secret",
      stream.replace("/stream/", "/file/"),
      stream.replace(":45678", ":80"),
    ]) {
      await expect(
        handleContentSettingsMessage(
          request,
          sender(invalid),
          async () => settings,
          async () => "silver",
        ),
      ).resolves.toBeUndefined();
    }
  });
  it("returns only presentation fields from a validated official playback sender", async () => {
    expect(isContentSettingsMessage(request)).toBe(true);
    await expect(
      handleContentSettingsMessage(
        request,
        url,
        async () => settings,
        async () => "silver",
      ),
    ).resolves.toEqual({
      type: "store/asbplayer-settings-result",
      messageVersion: STORE_MESSAGE_VERSION,
      appearance: "silver",
      asbplayerMode: "english",
      asbplayerShortcut: null,
    });
  });
  it.each([
    undefined,
    "https://app.asbplayer.dev/",
    url.replace("app.asbplayer.dev/?", "app.asbplayer.dev:444/?"),
    url.replace("https://app.asbplayer.dev/?", "https://other.example/?"),
    `${url}&channel=second`,
    url.replace("blob:https://app.asbplayer.dev", "blob:https://other.example"),
    url.replace("/?", "/other?"),
    `${url}#fragment`,
  ])("rejects unsupported playback senders before reading storage", async (sender) => {
    const read = vi.fn(async () => settings);
    await expect(
      handleContentSettingsMessage(request, sender, read, async () => "silver"),
    ).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it("does not disclose settings on an incompatible request or disabled site", async () => {
    const read = vi.fn(async () => settings);
    await expect(
      handleContentSettingsMessage(
        { ...request, messageVersion: 5 },
        url,
        read,
        async () => "silver",
      ),
    ).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    await expect(
      handleContentSettingsMessage(
        request,
        url,
        async () => ({ ...settings, globallyEnabled: false }),
        async () => "silver",
      ),
    ).resolves.toBeUndefined();
  });
});
