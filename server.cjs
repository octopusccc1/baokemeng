const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const GameData=require('./shared/game-data.js');
const {createPresence}=require('./presence.cjs');
const scrypt=promisify(crypto.scrypt);
const SESSION_AGE=30*24*60*60*1000;

function createGameServer({dataDir=path.join(__dirname,'data')}={}) {
  const playersDir=path.join(dataDir,'players'); fs.mkdirSync(playersDir,{recursive:true});
  const players=new Map(),names=new Map(),sessions=new Map();
  const presence=createPresence({sessionValid:hash=>sessions.get(hash)?.expiresAt>Date.now(),worldFile:path.join(dataDir,'world.json')});
  const cookieHash=token=>crypto.createHash('sha256').update(token).digest('hex');
  function writePlayer(player){
    const file=path.join(playersDir,`${player.id}.json`),temporary=`${file}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify(player,null,2),'utf8');fs.renameSync(temporary,file);
  }
  for(const file of fs.readdirSync(playersDir)){
    if(!/^[0-9a-f-]{36}\.json$/.test(file))continue;
    const player=JSON.parse(fs.readFileSync(path.join(playersDir,file),'utf8'));
    if(player.id!==file.slice(0,-5))throw new Error(`存档文件身份不一致：${file}`);
    players.set(player.id,player);names.set(player.nameKey,player.id);
    for(const session of player.sessions||[])if(session.expiresAt>Date.now())sessions.set(session.hash,{playerId:player.id,expiresAt:session.expiresAt});
  }
  function json(res,status,data,headers={}){
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));
  }
  function fail(status,message){const error=new Error(message);error.status=status;return error;}
  async function body(req,limit=32768){
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size<=limit)chunks.push(chunk);else chunks.length=0;}
    if(size>limit)throw fail(413,'请求内容太大');
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'请求内容不是有效数据');}
  }
  function sessionToken(req){return (req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('wilds_session='))?.slice('wilds_session='.length)||'';}
  function authenticated(req){
    const token=sessionToken(req),session=token&&sessions.get(cookieHash(token));
    if(!session||session.expiresAt<=Date.now())return null;return players.get(session.playerId)||null;
  }
  function cookie(token,age=SESSION_AGE){return `wilds_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(age/1000)}`;}
  function publicPlayer(player){return {id:player.id,username:player.username};}
  function payload(player){return {user:publicPlayer(player),save:player.save,revision:player.revision,updatedAt:player.updatedAt};}
  function issueSession(player){
    const token=crypto.randomBytes(32).toString('hex'),hash=cookieHash(token),expiresAt=Date.now()+SESSION_AGE;
    const old=player.sessions||[];
    player.sessions=[...old.filter(s=>s.expiresAt>Date.now()),{hash,expiresAt}].slice(-10);writePlayer(player);
    for(const session of old)if(!player.sessions.some(s=>s.hash===session.hash)){sessions.delete(session.hash);presence.revoke(session.hash);}
    sessions.set(hash,{playerId:player.id,expiresAt});return token;
  }
  function credentials(input){
    if(!input||typeof input.username!=='string'||typeof input.password!=='string')throw fail(400,'请输入昵称和密码');
    const username=input.username.normalize('NFKC').trim();
    if(!/^[\p{L}\p{N}_-]{2,20}$/u.test(username))throw fail(400,'昵称需为 2–20 个中文、字母、数字、下划线或短横线');
    if(input.password.length<6||input.password.length>72)throw fail(400,'密码长度需为 6–72 位');
    return {username,nameKey:username.toLowerCase(),password:input.password};
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw fail(403,'请从游戏服务器网页操作');
        if(req.method==='GET'&&url.pathname==='/api/server-info'){
          const port=server.address()?.port;
          const addresses=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>`http://${i.address}:${port}/`);
          return json(res,200,{addresses});
        }
        if(req.method==='POST'&&(url.pathname==='/api/register'||url.pathname==='/api/login')){
          const input=credentials(await body(req,4096));let player=players.get(names.get(input.nameKey));
          if(url.pathname==='/api/register'){
            if(player)throw fail(409,'这个昵称已有玩家使用，请登录或换一个昵称');
            const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(input.password,salt,64)).toString('hex');
            if(names.has(input.nameKey))throw fail(409,'这个昵称已有玩家使用');
            player={id:crypto.randomUUID(),username:input.username,nameKey:input.nameKey,passwordSalt:salt,passwordHash:hash,createdAt:new Date().toISOString(),save:null,revision:0,updatedAt:null,sessions:[]};
            writePlayer(player);players.set(player.id,player);names.set(player.nameKey,player.id);
          }else{
            if(!player)throw fail(401,'昵称或密码不正确');
            const hash=await scrypt(input.password,player.passwordSalt,64);
            if(!crypto.timingSafeEqual(hash,Buffer.from(player.passwordHash,'hex')))throw fail(401,'昵称或密码不正确');
          }
          const token=issueSession(player);return json(res,200,payload(player),{'Set-Cookie':cookie(token)});
        }
        const player=authenticated(req);
        if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,player?payload(player):{user:null});
        if(!player)throw fail(401,'请先登录你的玩家账号');
        if(req.method==='GET'&&url.pathname==='/api/world'){
          const error=presence.connect(req,res,player,cookieHash(sessionToken(req)),url.searchParams.get('clientId'));
          if(error)throw fail(error.status,error.message);return;
        }
        if(req.method==='POST'&&url.pathname==='/api/presence'){
          const error=presence.update(player,cookieHash(sessionToken(req)),await body(req,4096));
          if(error)throw fail(error.status,error.message);return json(res,200,{ok:true});
        }
        if(req.method==='POST'&&url.pathname==='/api/duel/invite'){
          const input=await body(req,4096),result=presence.invite(player,cookieHash(sessionToken(req)),input?.targetId);
          if(result?.status)throw fail(result.status,result.message);return json(res,200,result);
        }
        if(req.method==='POST'&&url.pathname==='/api/duel/respond'){
          const input=await body(req,4096),result=presence.respond(player,cookieHash(sessionToken(req)),input?.duelId,input?.accept===true);
          if(result?.status)throw fail(result.status,result.message);return json(res,200,result);
        }
        if(req.method==='POST'&&url.pathname==='/api/duel/action'){
          const input=await body(req,4096),result=presence.action(player,cookieHash(sessionToken(req)),input?.duelId,input?.moveId);
          if(result?.status)throw fail(result.status,result.message);return json(res,200,result);
        }
        if(req.method==='POST'&&url.pathname==='/api/duel/leave'){
          const input=await body(req,4096);presence.leaveDuel(player,input?.duelId);return json(res,200,{ok:true});
        }
        if(req.method==='POST'&&url.pathname==='/api/leave'){
          const input=await body(req,4096);presence.leave(player,cookieHash(sessionToken(req)),input?.clientId);return json(res,200,{ok:true});
        }
        if(req.method==='POST'&&url.pathname==='/api/logout'){
          const hash=cookieHash(sessionToken(req));player.sessions=player.sessions.filter(s=>s.hash!==hash);writePlayer(player);sessions.delete(hash);
          presence.revoke(hash);
          return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
        }
        if(req.method==='POST'&&url.pathname==='/api/starter'){
          const input=await body(req,4096);if(player.save)throw fail(409,'你已选择初始伙伴，请加载已有存档');
          if(!GameData.STARTERS.includes(input?.starterId))throw fail(400,'请选择提供的三只初始宝可梦之一');
          const save=GameData.createSave(input.starterId);
          const seed=crypto.createHash('sha256').update(player.id).digest();
          save.player.x=96+(seed.readUInt16BE(0)%744);
          save.player.y=96+(seed.readUInt16BE(2)%400);
          const updated={...player,save,revision:1,updatedAt:new Date().toISOString()};
          writePlayer(updated);Object.assign(player,updated);return json(res,200,payload(player));
        }
        if((req.method==='PUT'||req.method==='POST')&&url.pathname==='/api/save'){
          const input=await body(req);if(!player.save)throw fail(409,'请先选择初始伙伴');
          if(input?.revision!==player.revision)throw fail(409,'存档已在另一个页面更新，请重新载入');
          let save;try{save=GameData.validateSave(input.save);}catch(error){throw fail(400,error.message);}
          if(save.starterId!==player.save.starterId)throw fail(400,'不能更改存档中的初始伙伴');
          const updated={...player,save,revision:player.revision+1,updatedAt:new Date().toISOString()};
          writePlayer(updated);Object.assign(player,updated);return json(res,200,{revision:player.revision,updatedAt:player.updatedAt});
        }
        throw fail(404,'接口不存在');
      }
      if(!['GET','HEAD'].includes(req.method))throw fail(405,'不支持该请求方式');
      let name;try{name=decodeURIComponent(url.pathname);}catch{throw fail(400,'网页地址无效');}
      if(name==='/')name='/index.html';
      if(!(name==='/index.html'||name==='/shared/game-data.js'||name.startsWith('/assets/')))throw fail(404,'页面不存在');
      const file=path.resolve(__dirname,`.${name}`);
      if(name.startsWith('/assets/')&&!file.startsWith(path.join(__dirname,'assets')+path.sep))throw fail(404,'文件不存在');
      if(!file.startsWith(path.resolve(__dirname)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw fail(404,'文件不存在');
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8'};
      const type=types[path.extname(file)];if(!type)throw fail(404,'文件不存在');
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD')res.end();else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    }catch(error){
      if(!error.status)console.error('服务器处理请求失败：',error.message);
      if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'服务器存档暂时不可用，请稍后重试'});else res.destroy();
    }
  });server.on('close',()=>presence.close());return server;
}
if(require.main===module){
  const port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0';const server=createGameServer();
  server.on('error',error=>{console.error(`无法启动服务器：${error.message}`);process.exitCode=1;});
  server.listen(port,host,()=>{
    console.log(`主机访问：http://localhost:${server.address().port}/`);
    for(const i of Object.values(os.networkInterfaces()).flat())if(i&&i.family==='IPv4'&&!i.internal)console.log(`局域网访问：http://${i.address}:${server.address().port}/`);
    console.log('玩家存档保存在 data/players；保持此窗口开启。');
  });
}
module.exports={createGameServer};
