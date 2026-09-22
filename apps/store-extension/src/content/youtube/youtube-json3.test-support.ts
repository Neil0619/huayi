// Structural ASR sample: synthetic timings/text, no copied captions or request identifiers.
export const asrJson3Fixture = {
  events: [
    { dDurationMs: 4_000, id: 1, tStartMs: 0, wpWinPosId: 1, wsWinStyleId: 1 },
    {
      dDurationMs: 1_000,
      segs: [{ acAsrConf: 0, utf8: "Hello." }],
      tStartMs: 0,
      wWinId: 1,
    },
    { aAppend: 1, dDurationMs: 1_000, segs: [{ utf8: "Test." }], tStartMs: 1_000, wWinId: 1 },
  ],
};
