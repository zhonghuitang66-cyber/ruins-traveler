// Keep combat timing independent of display refresh rate. A stalled frame may
// advance at most 50ms; background/menu time is discarded instead of caught up.
export function createSimulationClock(update,{step=1/60,maxFrame=.05}={}){
 if(typeof update!=='function'||!Number.isFinite(step)||step<=0||!Number.isFinite(maxFrame)||maxFrame<step)throw new TypeError('Invalid simulation clock');
 let remainder=0;
 return {
  reset(){remainder=0},
  advance(elapsed,active=true){
   if(!active){remainder=0;return 0}
   if(!Number.isFinite(elapsed)||elapsed<=0)return 0;
   remainder+=Math.min(elapsed,maxFrame);
   let count=0;
   while(remainder+1e-10>=step){remainder=Math.max(0,remainder-step);count++;if(update(step)===false){remainder=0;break}}
   return count;
  }
 };
}
