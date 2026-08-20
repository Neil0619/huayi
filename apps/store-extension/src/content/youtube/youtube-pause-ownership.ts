export const SELECTION_PAUSE = 0;
export const TEMPORARY_PAUSE = 1;
export type YouTubePauseOwnership = readonly [
  generation: number,
  player: HTMLElement,
  video: HTMLVideoElement,
  videoId: string,
];
