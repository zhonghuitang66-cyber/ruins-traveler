/** Fixed-base visual deformation; advance even while an enemy is culled. dt=0 freezes it. */
export function advanceEnemyHitFeedback(remaining,dt,base=1){
 const time=Math.max(0,Math.min(.14,Number.isFinite(remaining)?remaining:0)-Math.max(0,Number.isFinite(dt)?dt:0));
 const phase=time>.09?(time-.09)/.05:time>0?-Math.sin(time/.09*Math.PI)*.35:0;
 return {remaining:time,x:base*(1+.22*phase),y:base*(1-.22*phase),z:base*(1+.22*phase)};
}
