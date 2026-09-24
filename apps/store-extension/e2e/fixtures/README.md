# asbplayer synthetic test media

`asbplayer-learning.webm` is a 3.2-second, 480×270, 10 fps, silent VP8 video of a solid
`#244050` background. It contains no user media or subtitles and is not a shipped extension asset.

Generated with FFmpeg 6.1.1:

```sh
ffmpeg -hide_banner -loglevel error -nostdin -n -f lavfi -i "color=c=0x244050:s=480x270:r=10:d=3.2" -an -c:v libvpx -b:v 80k -pix_fmt yuv420p -map_metadata -1 -fflags +bitexact -flags:v +bitexact asbplayer-learning.webm
```

SHA-256: `174ff812a30c898e4f80e2baa10357b4a7490bf3270c837223af2386fb9cd8cf`.

The browser fixture loads these bytes and exercises actual media decoding, events and playback.
It does not require a working canvas encoder or await a runtime `MediaRecorder` stop event.
The recording-stall regression deliberately prevents that event and still requires decoded frames
and progressing playback. Existing learning, pause, fullscreen and BFCache assertions remain intact.
