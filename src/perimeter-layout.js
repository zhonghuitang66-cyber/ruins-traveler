/** Pure collision/layout contract, independent of rendering and browser APIs. */
export function perimeterMountainLayout(){
 const placements=[];
 for(let side=0;side<4;side++)for(let i=0;i<6;i++){
  const along=-80+i*32,horizontal=side%2===0;
  placements.push({id:`perimeter-${side}-${i}`,x:horizontal?along:(side===1?95:-95),z:horizontal?(side===0?-95:95):along,width:32,depth:12,height:12+(i%3)*1.4,rotation:horizontal?0:Math.PI/2});
 }
 return placements;
}
export function perimeterMountainWalls(){return perimeterMountainLayout().map(p=>({id:p.id,x:p.x,z:p.z,w:p.rotation?12:32,d:p.rotation?32:12,h:p.height,scenery:true,perimeter:true}))}
