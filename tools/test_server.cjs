const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createGameServer}=require('../server.cjs');
const GameData=require('../shared/game-data.js');
const http=require('node:http');

async function fixture(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pokemon-server-test-'));
  let server,base;
  async function start(){server=createGameServer({dataDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
  async function stop(){server.closeAllConnections?.();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
  await start();
  async function cleanup(){await stop();const resolved=path.resolve(dataDir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'pokemon-server-test-'));fs.rmSync(resolved,{recursive:true,force:true});}
  async function request(route,{cookie='',method='GET',body,origin}={}){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function player(username,starterId){
    const registered=await request('/api/register',{method:'POST',body:{username,password:'demo-password'}});assert.equal(registered.status,200);
    const result=await request('/api/starter',{method:'POST',cookie:registered.cookie,body:{starterId}});assert.equal(result.status,200);
    return {...result.data,cookie:registered.cookie};
  }
  async function world(cookie,clientId){
    const url=new URL(`/api/world?clientId=${encodeURIComponent(clientId)}`,base);
    return await new Promise((resolve,reject)=>{
      const request=http.get(url,{headers:{Cookie:cookie}},response=>{
        let buffer='';const stream={request,response,queue:[],waiters:[],close:()=>request.destroy()};
        stream.push=data=>{stream.queue.push(data);for(const waiter of [...stream.waiters]){const index=stream.queue.findIndex(waiter.predicate);if(index<0)continue;stream.waiters.splice(stream.waiters.indexOf(waiter),1);waiter.resolve(stream.queue.splice(index,1)[0]);}};
        stream.nextData=predicate=>{const index=stream.queue.findIndex(predicate);if(index>=0)return Promise.resolve(stream.queue.splice(index,1)[0]);return new Promise((resolve,reject)=>stream.waiters.push({predicate,resolve,reject}));};
        response.setEncoding('utf8');
        response.on('data',chunk=>{
          buffer+=chunk;
          while(true){const end=buffer.indexOf('\n\n');if(end<0)break;const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(value=>value.startsWith('data: '));if(!line)continue;let data;try{data=JSON.parse(line.slice(6));}catch{continue;}stream.push(data);}
        });
        response.once('error',reject);response.once('close',()=>{for(const waiter of stream.waiters.splice(0))waiter.reject(new Error('实时连接已关闭'));});
        resolve(stream);
      });
      request.once('error',reject);
    });
  }
  return {request,player,dataDir,cleanup,restart:async()=>{await stop();await start();},base:()=>base,world};
}
function scenario(name,callback){test(name,async()=>{const f=await fixture();try{await callback(f);}finally{await f.cleanup();}});}

scenario('three initial choices create exactly one partner, and a chosen starter cannot be replaced',async f=>{
  for(const [index,starterId] of GameData.STARTERS.entries()){
    const player=await f.player(`新玩家${index}`,starterId);
    assert.equal(player.save.party.length,1);assert.equal(player.save.party[0].speciesId,starterId);
    assert.equal(player.save.party[0].rarity,'S');assert.equal(player.save.items.rareCandy,10);assert.equal(player.save.items.gachaMaterial,10);assert.deepEqual(player.save.warehouse,[]);
    const again=await f.request('/api/starter',{method:'POST',cookie:player.cookie,body:{starterId:'squirtle'}});
    assert.equal(again.status,409);
  }
});

scenario('players have isolated server saves and keep all progress after a server restart',async f=>{
  const a=await f.player('训练家甲','bulbasaur'),b=await f.player('训练家乙','squirtle');
  const save=a.save;save.player.x=650;save.minutes=725;save.day=3;save.balls=8;save.collected=['berry-a'];save.bag=2;
  save.party.push({...GameData.makePokemon('eevee'),hp:16});save.activePokemonId='wild-eevee';
  save.wild.find(c=>c.id==='eevee').captured=true;save.wild.find(c=>c.id==='eevee').hp=16;
  save.history=[{time:'12:05',text:'捕捉成功：伊布 加入队伍'}];
  const result=await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:a.revision,save}});assert.equal(result.status,200);
  const other=await f.request('/api/session',{cookie:b.cookie});assert.deepEqual(other.data.save,b.save);
  await f.restart();
  const restored=await f.request('/api/session',{cookie:a.cookie});assert.equal(restored.status,200);
  assert.deepEqual(restored.data.save,GameData.validateSave(save));assert.equal(restored.data.revision,2);
  const login=await f.request('/api/login',{method:'POST',body:{username:'训练家甲',password:'demo-password'}});assert.equal(login.status,200);
  assert.deepEqual(login.data.save,restored.data.save);
  const files=fs.readdirSync(path.join(f.dataDir,'players'));assert.equal(files.length,2);
  const file=fs.readFileSync(path.join(f.dataDir,'players',`${a.user.id}.json`),'utf8');
  assert.ok(!file.includes('demo-password'));assert.ok(JSON.parse(file).passwordHash);
  assert.ok(!('passwordHash' in restored.data.user));
});

scenario('stale revisions and concurrent saves cannot overwrite the newest progress',async f=>{
  const a=await f.player('并发测试','charmander');
  const left=structuredClone(a.save),right=structuredClone(a.save);left.player.x=500;right.player.x=600;
  const results=await Promise.all([f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:1,save:left}}),f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:1,save:right}})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const latest=await f.request('/api/session',{cookie:a.cookie});assert.equal(latest.data.revision,2);
  const stale=await f.request('/api/save',{method:'POST',cookie:a.cookie,body:{revision:1,save:a.save}});assert.equal(stale.status,409);
  assert.deepEqual((await f.request('/api/session',{cookie:a.cookie})).data,latest.data);
});

scenario('login, logout, malformed saves, and unauthorized requests protect player data',async f=>{
  const a=await f.player('身份测试','charmander');
  assert.equal((await f.request('/api/save',{method:'PUT',body:{revision:1,save:a.save}})).status,401);
  assert.equal((await f.request('/api/login',{method:'POST',body:{username:'身份测试',password:'incorrect'}})).status,401);
  const invalid=structuredClone(a.save);invalid.party.push(GameData.makePokemon('pikachu'));
  assert.equal((await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:1,save:invalid}})).status,400);
  assert.equal((await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:1,save:GameData.createSave('squirtle')}})).status,400);
  assert.equal((await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:'{'})).status,400);
  assert.equal((await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:JSON.stringify({oversized:'x'.repeat(40000)})})).status,413);
  assert.equal((await f.request('/api/logout',{method:'POST',cookie:a.cookie,body:{},origin:'http://another-site.invalid'})).status,403);
  assert.equal((await f.request('/api/logout',{method:'POST',cookie:a.cookie,body:{}})).status,200);
  assert.deepEqual((await f.request('/api/session',{cookie:a.cookie})).data,{user:null});
});

scenario('static hosting serves game assets but never server code or private save files',async f=>{
  const a=await f.player('文件检查','squirtle');
  assert.equal((await f.request('/')).status,200);assert.equal((await f.request('/shared/game-data.js')).status,200);
  assert.equal((await f.request('/assets/monsters/squirtle.png')).status,200);
  for(const route of ['/server.cjs',`/data/players/${a.user.id}.json`,`/assets/..%2fdata/players/${a.user.id}.json`,'/%E0%A4%A'])assert.ok([400,404].includes((await f.request(route)).status));
  const info=await f.request('/api/server-info');assert.equal(info.status,200);assert.ok(Array.isArray(info.data.addresses));
});

scenario('online players share live names and positions without sharing their saves',async f=>{
  const a=await f.player('同屏甲','bulbasaur'),b=await f.player('同屏乙','squirtle');
  assert.ok(Math.hypot(a.save.player.x-b.save.player.x,a.save.player.y-b.save.player.y)>20,'players should start apart to see both names');
  const streamA=await f.world(a.cookie,'client-a-123456789');
  const firstA=await streamA.nextData(world=>world.players.some(player=>player.id===a.user.id));
  assert.deepEqual(firstA.players.map(player=>player.username),['同屏甲']);
  const streamB=await f.world(b.cookie,'client-b-123456789');
  const seenByA=await streamA.nextData(world=>world.players.some(player=>player.id===b.user.id));
  assert.ok(seenByA.players.some(player=>player.username==='同屏乙'));
  const moved=await f.request('/api/presence',{method:'POST',cookie:a.cookie,body:{clientId:'client-a-123456789',x:700,y:420,battle:true}});
  assert.equal(moved.status,200);
  const movedByB=await streamB.nextData(world=>world.players.some(player=>player.id===a.user.id&&player.x===700));
  assert.equal(movedByB.players.find(player=>player.id===a.user.id).username,'同屏甲');
  assert.equal(movedByB.players.find(player=>player.id===a.user.id).battle,true);
  assert.deepEqual((await f.request('/api/session',{cookie:b.cookie})).data.save.player,{x:b.save.player.x,y:b.save.player.y,hp:100,hunger:78});
  const left=await f.request('/api/leave',{method:'POST',cookie:a.cookie,body:{clientId:'client-a-123456789'}});assert.equal(left.status,200);
  const afterLeave=await streamB.nextData(world=>!world.players.some(player=>player.id===a.user.id));
  assert.equal(afterLeave.players.some(player=>player.username==='同屏甲'),false);
  streamA.close();streamB.close();
});

scenario('shared scene resources synchronize and players can confirm a duel',async f=>{
  const a=await f.player('同步甲','charmander'),b=await f.player('同步乙','squirtle');
  const upgraded=structuredClone(a.save);upgraded.party[0]=GameData.makePokemon('charmander',true,8);upgraded.activePokemonId=upgraded.party[0].id;
  upgraded.party[0].hp=1;upgraded.party.push(GameData.makePokemon('pikachu',false,3,'F','gacha-pika-a'));
  const saved=await f.request('/api/save',{method:'PUT',cookie:a.cookie,body:{revision:a.revision,save:upgraded}});
  assert.equal(saved.status,200);
  const opponent=structuredClone(b.save);opponent.party[0].hp=1;opponent.party.push(GameData.makePokemon('eevee',false,3,'F','gacha-eevee-b'));
  const opponentSaved=await f.request('/api/save',{method:'PUT',cookie:b.cookie,body:{revision:b.revision,save:opponent}});assert.equal(opponentSaved.status,200);
  const streamA=await f.world(a.cookie,'client-sync-a-123456789'),streamB=await f.world(b.cookie,'client-sync-b-123456789');
  await streamA.nextData(value=>Array.isArray(value.players));await streamB.nextData(value=>Array.isArray(value.players));
  const collected=await f.request('/api/presence',{method:'POST',cookie:a.cookie,body:{clientId:'client-sync-a-123456789',x:a.save.player.x,y:a.save.player.y,battle:false,collect:['berry-a']}});
  assert.equal(collected.status,200);
  const world=await streamB.nextData(value=>Array.isArray(value.collected)&&value.collected.includes('berry-a'));
  assert.ok(world.collected.includes('berry-a'));
  const eeveeRarity=a.save.wild.find(item=>item.id==='eevee').rarity;
  const eeveeMaxHp=GameData.statsAtLevel('eevee',3,eeveeRarity).maxHp;
  const wildHit=await f.request('/api/presence',{method:'POST',cookie:a.cookie,body:{clientId:'client-sync-a-123456789',x:a.save.player.x,y:a.save.player.y,battle:false,wild:[{id:'eevee',level:3,hp:0,captured:false}]}});
  assert.equal(wildHit.status,200);
  const wildWorld=await streamB.nextData(value=>Array.isArray(value.wild)&&value.wild.some(item=>item.id==='eevee'&&item.hp===0));
  assert.equal(wildWorld.wild.find(item=>item.id==='eevee').hp,0);
  const nextDay=await f.request('/api/presence',{method:'POST',cookie:a.cookie,body:{clientId:'client-sync-a-123456789',x:a.save.player.x,y:a.save.player.y,battle:false,day:2,wild:[{id:'eevee',level:3,hp:0,captured:false}]}});
  assert.equal(nextDay.status,200);
  const refreshedWorld=await streamB.nextData(value=>value.day===2&&Array.isArray(value.wild)&&value.wild.some(item=>item.id==='eevee'&&item.hp===eeveeMaxHp));
  assert.equal(refreshedWorld.wild.find(item=>item.id==='eevee').hp,eeveeMaxHp);
  assert.equal(refreshedWorld.wild.find(item=>item.id==='eevee').rarity,eeveeRarity);
  const captured=await f.request('/api/presence',{method:'POST',cookie:b.cookie,body:{clientId:'client-sync-b-123456789',x:b.save.player.x,y:b.save.player.y,battle:false,wild:[{id:'eevee',level:3,hp:0,captured:true}]}});
  assert.equal(captured.status,200);
  const capturedWorld=await streamA.nextData(value=>Array.isArray(value.wild)&&value.wild.some(item=>item.id==='eevee'&&item.captured===true));
  assert.equal(capturedWorld.wild.find(item=>item.id==='eevee').captured,true);
  const invite=await f.request('/api/duel/invite',{method:'POST',cookie:a.cookie,body:{targetId:b.user.id}});
  assert.equal(invite.status,200);assert.equal(invite.data.duel.status,'pending');assert.equal(invite.data.duel.initiatorReady,true);
  assert.equal(invite.data.duel.mine.level,8);
  const incoming=await streamB.nextData(value=>value.id===invite.data.duel.id);
  assert.equal(incoming.receiverReady,false);
  const accepted=await f.request('/api/duel/respond',{method:'POST',cookie:b.cookie,body:{duelId:invite.data.duel.id,accept:true}});
  assert.equal(accepted.status,200);assert.equal(accepted.data.duel.status,'battle');
  assert.equal(accepted.data.duel.mineRoster.length,2);assert.equal(accepted.data.duel.otherRoster.length,2);
  const forcedRotation=await f.request('/api/duel/action',{method:'POST',cookie:a.cookie,body:{duelId:invite.data.duel.id,moveId:'ember'}});
  assert.equal(forcedRotation.status,200);assert.equal(forcedRotation.data.duel.otherRoster[0].fainted,true);assert.equal(forcedRotation.data.duel.otherRoster[1].active,true);
  const started=await streamA.nextData(value=>value.id===invite.data.duel.id&&value.status==='battle');assert.equal(started.other.username,'同步乙');
  const actionSeen=await streamB.nextData(value=>value.id===invite.data.duel.id&&value.turn===1);assert.equal(actionSeen.status,'battle');assert.ok(actionSeen.action?.moveName);assert.ok(actionSeen.action.damage>=0);
  streamA.close();streamB.close();
});
