import type { Page } from "@playwright/test";

/**
 * A stand-in for YouTube's IFrame Player API so tests don't depend on YouTube.
 * It keeps a clock that advances at the chosen playback rate.
 */
const SCRIPT = `
(function(){
  // Like the real API, a player's methods only exist once it is ready.
  function Player(el, opts){
    var self=this; this.opts=opts; this.t=0; this.rate=1; this.state=-1; this.startPerf=0; this.vol=100;
    var box=document.createElement('div'); box.setAttribute('data-fake-youtube', opts.videoId); box.textContent='Video '+opts.videoId; el.replaceWith(box);
    setTimeout(function(){ Object.assign(self, Ready); opts.events && opts.events.onReady && opts.events.onReady({target:self}); }, 300);
  }
  Player.prototype.destroy=function(){};
  var Ready={};
  Ready.now=function(){ return this.state===1 ? this.t + (performance.now()-this.startPerf)/1000*this.rate : this.t; };
  Ready.playVideo=function(){ this.t=this.now(); this.startPerf=performance.now(); this.state=1; var s=this; setTimeout(function(){ s.opts.events.onStateChange({data:1,target:s}); },0); };
  Ready.pauseVideo=function(){ this.t=this.now(); this.state=2; var s=this; setTimeout(function(){ s.opts.events.onStateChange({data:2,target:s}); },0); };
  Ready.seekTo=function(x){ this.t=x; this.startPerf=performance.now(); };
  Ready.getCurrentTime=function(){ return Math.min(this.now(), 180); };
  Ready.getDuration=function(){ return 180; };
  Ready.getPlayerState=function(){ return this.state; };
  Ready.setPlaybackRate=function(r){ this.t=this.now(); this.startPerf=performance.now(); this.rate=Math.round(r*4)/4; };
  Ready.getPlaybackRate=function(){ return this.rate; };
  Ready.getAvailablePlaybackRates=function(){ return [0.25,0.5,0.75,1,1.25,1.5,1.75,2]; };
  Ready.setVolume=function(v){ this.vol=v; };
  Ready.getVideoData=function(){ return {title:'Test video'}; };
  window.YT={Player:Player};
  setTimeout(function(){ window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); },0);
})();`;

export async function fakeYouTube(page: Page) {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ body: SCRIPT, contentType: "application/javascript" }));
}
