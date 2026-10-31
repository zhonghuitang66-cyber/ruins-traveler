/** Keep the menu inside the visible area, including when a mobile keyboard opens. */
export function bindMenuViewport(menu,host=globalThis.window){
 if(!menu||!host)return ()=>{};
 let frame=null;
 const measure=()=>{const viewport=host.visualViewport,height=Math.max(1,Math.round(Math.min(host.innerHeight,viewport?.height??host.innerHeight))),top=Math.max(0,Math.round(viewport?.offsetTop||0));menu.style.setProperty('--menu-viewport-height',height+'px');menu.style.setProperty('--menu-viewport-top',top+'px');menu.dataset.compactViewport=String(height<300)};
 const schedule=()=>{if(frame===null)frame=host.requestAnimationFrame(()=>{frame=null;measure()})};
 host.addEventListener('resize',schedule);host.addEventListener('orientationchange',schedule);host.visualViewport?.addEventListener('resize',schedule);host.visualViewport?.addEventListener('scroll',schedule);measure();
 return ()=>{host.removeEventListener('resize',schedule);host.removeEventListener('orientationchange',schedule);host.visualViewport?.removeEventListener('resize',schedule);host.visualViewport?.removeEventListener('scroll',schedule);if(frame!==null)host.cancelAnimationFrame(frame)};
}
