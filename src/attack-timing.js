// Approximate game cues for current four-stage contact poses, not exact surface/contact collision times.
export const ATTACK_RELEASE_PHASE=Object.freeze({swordsman:.5,paladin:.5,archer:.5});
export function attackTiming(role,duration){
 if(!Object.hasOwn(ATTACK_RELEASE_PHASE,role)||!Number.isFinite(duration)||duration<=0)return null;
 return {duration,impactDelay:duration*ATTACK_RELEASE_PHASE[role]};
}
