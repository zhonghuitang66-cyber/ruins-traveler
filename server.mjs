import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.glb':'model/gltf-binary','.json':'application/json'};
http.createServer(async(req,res)=>{
 try{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!p.startsWith(root+path.sep)&&p!==root)throw Error('invalid');const file=p===root?path.join(root,'index.html'):p;const buf=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(buf)}catch{res.writeHead(404);res.end('Not found')}
}).listen(4173,'0.0.0.0',()=>console.log('Autumn Ruins http://localhost:4173'));
