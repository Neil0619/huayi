export const storeYouTubeFixture = `<!doctype html><html><head><style>
body{margin:0;background:#222}.html5-video-player{position:relative;width:1000px;height:600px;margin:12px}
video{width:100%;height:100%}.ytp-caption-window-container{position:absolute;bottom:90px;left:40%;color:white}
.ytp-right-controls{position:absolute;bottom:0;right:0;height:45px}
</style></head><body><div id="movie_player" class="html5-video-player"><video preload="auto" muted loop></video>
<div class="ytp-caption-window-container"><span class="ytp-caption-segment">Learning matters.</span></div>
<div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true">CC</button></div></div>
<script>
const player=document.querySelector('#movie_player');
let track={languageCode:'en',vssId:'.en'},loaded=true;
player.getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),isLiveContent:false},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',vssId:'.en'}]}}});
player.getOption=()=>track;player.getOptions=()=>loaded?['captions']:[];player.isSubtitlesOn=()=>true;
player.unloadModule=()=>{loaded=false};player.loadModule=()=>{loaded=true};
player.setOption=(_,__,value)=>{track=value;const url=new URL('/api/timedtext',location.origin);url.searchParams.set('v',new URL(location.href).searchParams.get('v'));url.searchParams.set('lang','en');url.searchParams.set('fmt','json3');if(value.translationLanguage)url.searchParams.set('tlang','zh-Hans');void fetch(url)};
</script></body></html>`;
