// Frame-rate independent interpolation for continuously changing UI values.
export function dampNumber(current,target,response,dt){if(!Number.isFinite(target))return current;if(!Number.isFinite(current))return target;if(!Number.isFinite(dt)||dt<=0)return current;return current+(target-current)*(-Math.expm1(-Math.max(0,response)*Math.min(dt,.1)))}
export function dampAngle(current,target,response,dt){return dampNumber(current,current+Math.atan2(Math.sin(target-current),Math.cos(target-current)),response,dt)}
export function dampColor(current,target,response,dt){return current.map((v,i)=>dampNumber(v,target[i],response,dt))}
