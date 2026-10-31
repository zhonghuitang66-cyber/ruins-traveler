import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export class ApiError extends Error{constructor(status,code){super(code);this.status=status;this.code=code}}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function username(value){if(typeof value!=='string')throw new ApiError(400,'INVALID_USERNAME');const name=value.normalize('NFKC');if(!/^[\p{L}\p{N}_-]{2,16}$/u.test(name)||[...name].length>16)throw new ApiError(400,'INVALID_USERNAME');return name}
export function wealth(value){if(typeof value==='string'&&/^(0|[1-9]\d{0,15})$/.test(value))value=Number(value);if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ApiError(400,'INVALID_WEALTH');return value}
export function createStore({path=':memory:',now=Date.now,cacheMs=600000}={}){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, wealth INTEGER NOT NULL DEFAULT 0 CHECK(wealth>=0 AND wealth<=9007199254740991), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT; CREATE INDEX IF NOT EXISTS users_wealth ON users(wealth DESC, created_at ASC, id ASC);`);
 const byDevice=db.prepare('SELECT id FROM users WHERE device_hash=?'),byName=db.prepare('SELECT id FROM users WHERE username_key=?'),byToken=db.prepare('SELECT id,username,wealth,created_at,updated_at FROM users WHERE token_hash=?');
 const insert=db.prepare('INSERT INTO users(id,device_hash,username,username_key,token_hash,wealth,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)'),update=db.prepare('UPDATE users SET wealth=?,updated_at=? WHERE id=?'),rank=db.prepare('SELECT id,username,wealth FROM users ORDER BY wealth DESC,created_at ASC,id ASC LIMIT 100');let cached=null;
 const publicProfile=row=>({id:row.id,username:row.username,wealth:row.wealth,createdAt:row.created_at,updatedAt:row.updated_at});
 function authenticate(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ApiError(401,'UNAUTHORIZED');const row=byToken.get(hash(token));if(!row)throw new ApiError(401,'UNAUTHORIZED');return publicProfile(row)}
 function register({deviceId,username:name}={}){name=username(name);if(typeof deviceId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(deviceId))throw new ApiError(400,'INVALID_DEVICE_ID');const deviceHash=hash(deviceId),nameKey=name.toLowerCase(),token=randomBytes(32).toString('base64url'),id=randomUUID(),time=now();
  db.exec('BEGIN IMMEDIATE');try{if(byDevice.get(deviceHash))throw new ApiError(409,'DEVICE_ALREADY_REGISTERED');if(byName.get(nameKey))throw new ApiError(409,'USERNAME_TAKEN');insert.run(id,deviceHash,name,nameKey,hash(token),time,time);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}return {token,profile:authenticate(token)};
 }
 function setWealth(token,value){const profile=authenticate(token),amount=wealth(value);update.run(amount,now(),profile.id);return authenticate(token)}
 function leaderboard(){const time=now();if(!cached||time>=cached.cachedUntil)cached={rows:rank.all().map((row,index)=>({...row,rank:index+1})),updatedAt:time,cachedUntil:time+cacheMs};return structuredClone(cached)}
 return {register,authenticate,setWealth,leaderboard,close:()=>db.close()};
}
