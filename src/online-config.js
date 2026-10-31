// Public service origin only. Account credentials remain on each player's device.
export const ONLINE_SERVICE_ORIGIN='https://114.66.36.160:9443/';
// This deployment uses an app-scoped CA. Ordinary browsers keep the offline demo.
export const ONLINE_ENDPOINT=typeof navigator!=='undefined'&&navigator.userAgent.includes('RuinsTravelerAndroid/')?ONLINE_SERVICE_ORIGIN:'';
