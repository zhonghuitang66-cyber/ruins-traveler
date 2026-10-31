/** Shared visual and collision placements keep generated furniture out of entrances. */
export function scenePlacements(floors){return floors.flatMap((f,i)=>[
 {id:`arch-${i}`,module:'arch',x:f.x,z:f.z+f.d/2,width:5,height:3.8,depth:1.1},
 {id:`bookcase-${i}`,module:'bookcase',x:f.x-f.w/2+1.6,z:f.z-f.d/2+1.5,width:2.4,height:2.8,depth:1,solid:true},
 {id:`dais-${i}`,module:'dais',x:f.x+5.5,z:f.z-2.5,width:2.3,height:1.8,depth:2.3,solid:true}
])}
