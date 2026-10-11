import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {searchYouTube} from './youtube-search.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/youtube/search'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(await searchYouTube((url.searchParams.get('q')||'').slice(0,100))));}
 if(url.pathname.startsWith('/api/')){res.writeHead(410,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Room data has moved to Firebase.'}));}
 const base=path.join(root,'dist'),requested=path.resolve(base,'.'+decodeURIComponent(url.pathname)),file=requested.startsWith(base+path.sep)&&fs.existsSync(requested)&&fs.statSync(requested).isFile()?requested:path.join(base,'index.html');
 if(!fs.existsSync(file)){res.writeHead(503);return res.end('Run npm run build, or open the development site on port 5173.');}const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm'};const size=fs.statSync(file).size,headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
 if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416);return res.end();}const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):size-1,size-1);if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}else{res.writeHead(200,{...headers,'Content-Length':size});fs.createReadStream(file).pipe(res);}

 }catch{res.writeHead(400);res.end('Invalid request');}});
server.listen(Number(process.env.PORT)||3001,'0.0.0.0',()=>console.log('Velune media server: http://localhost:3001 (rooms use Firebase)'));
