// Live positions and the shared scene stay in memory; individual progress
// still uses the save files. Duels are short-lived server-authoritative state.
const fs=require('node:fs');
const path=require('node:path');
const GameData=require('./shared/game-data.js');
const COLORS=['#8ddbd0','#b7a5ef','#9ddc84','#ff9d9a','#87baf0','#f0c67d'];

function createPresence({sessionValid,worldFile}) {
  const clients=new Map();
  const duels=new Map();
  const duelTimers=new Map();
  const resourceIds=new Set(GameData.RESOURCES.map(resource=>resource.id));
  const creatureDefs=new Map(GameData.WILD.map(creature=>[creature.id,creature]));
  const defaultWildState=(creature,rarity='B')=>{const grade=GameData.normalizeRarity(rarity),maxHp=GameData.statsAtLevel(creature.id,creature.level,grade).maxHp;return {id:creature.id,level:creature.level,rarity:grade,hp:maxHp,captured:false,respawnAt:0};};
  let sharedCollected=new Set(),sharedWild=new Map([...creatureDefs.values()].map(creature=>[creature.id,defaultWildState(creature)])),worldResetVersion=0,worldDay=1,worldLoaded=false,worldWildLoaded=false,worldNeedsPersist=false;
  if(worldFile){try{
    const saved=JSON.parse(fs.readFileSync(worldFile,'utf8'));
    if(Array.isArray(saved.collected)){sharedCollected=new Set(saved.collected.filter(id=>resourceIds.has(id)));worldLoaded=true;}
    if(Number.isInteger(saved.resetVersion)&&saved.resetVersion>=0)worldResetVersion=saved.resetVersion;
    if(Number.isInteger(saved.day)&&saved.day>=1)worldDay=saved.day;
    if(Array.isArray(saved.wild)){worldLoaded=true;worldWildLoaded=true;for(const item of saved.wild){const creature=creatureDefs.get(item?.id);if(!creature)continue;const level=Number.isInteger(item.level)?Math.max(1,Math.min(99,item.level)):creature.level,captured=item.captured===true,legacyMaxHp=GameData.statsAtLevel(creature.id,level,'B').maxHp,legacyHp=Number.isInteger(item.hp)?Math.max(0,Math.min(legacyMaxHp,item.hp)):legacyMaxHp,legacyRarity=item.rarity===undefined,rarity=legacyRarity&&!captured?GameData.rollRarity():GameData.normalizeRarity(item.rarity),maxHp=GameData.statsAtLevel(creature.id,level,rarity).maxHp,hp=legacyRarity&&!captured?Math.max(0,Math.min(maxHp,Math.round((legacyHp/legacyMaxHp)*maxHp))):Number.isInteger(item.hp)?Math.max(0,Math.min(maxHp,item.hp)):maxHp;sharedWild.set(creature.id,{id:creature.id,level,rarity,hp,captured,respawnAt:Number.isFinite(item.respawnAt)?Math.max(0,item.respawnAt):0});if(legacyRarity)worldNeedsPersist=true;}}
  }catch{}}
  const respawnDelay=()=>{const missing=[...sharedWild.values()].filter(item=>!item.captured&&item.hp<=0).length;return Math.max(6000,30000-Math.max(0,missing-1)*3000);};
  function refreshWildRespawns(now=Date.now()){
    let refreshed=false;const missing=[...sharedWild.values()].filter(item=>!item.captured&&item.hp<=0).length;
    for(const creature of creatureDefs.values()){
      const current=sharedWild.get(creature.id);if(!current||current.captured||current.hp>0)continue;
      const due=respawnDelay();
      if(!current.respawnAt)current.respawnAt=now+due;
      else current.respawnAt=Math.min(current.respawnAt,now+due);
      if(current.respawnAt<=now){sharedWild.set(creature.id,defaultWildState(creature,GameData.rollRarity()));refreshed=true;}
    }
    return refreshed;
  }
  function persistWorld(){if(!worldFile)return;fs.mkdirSync(path.dirname(worldFile),{recursive:true});const temporary=`${worldFile}.tmp`;fs.writeFileSync(temporary,JSON.stringify({resetVersion:worldResetVersion,day:worldDay,collected:[...sharedCollected],wild:[...sharedWild.values()]},null,2),'utf8');fs.renameSync(temporary,worldFile);}
  if(worldNeedsPersist){persistWorld();worldNeedsPersist=false;}
  let changed=false,order=0;
  const colorFor=id=>COLORS[parseInt(id.replace(/-/g,'').slice(0,8),16)%COLORS.length];
  function snapshot(){
    if(refreshWildRespawns())persistWorld();
    const latest=new Map();
    for(const client of clients.values()){
      const previous=latest.get(client.player.id);
      if(!previous||client.order>previous.order)latest.set(client.player.id,client);
    }
    return {players:[...latest.values()].map(c=>({id:c.player.id,username:c.player.username,x:c.x,y:c.y,battle:c.battle,color:colorFor(c.player.id)})),collected:[...sharedCollected],wild:[...sharedWild.values()],resetVersion:worldResetVersion,day:worldDay};
  }
  function send(client,message){
    // Disconnect slow readers instead of allowing an unbounded output buffer.
    if(client.res.writableLength>65536){client.res.destroy();return;}
    client.res.write(message);
  }
  function broadcast(){
    changed=false;
    const message=`event: world\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for(const client of clients.values())send(client,message);
  }
  function sendDuel(client,duel){if(!client||!clients.has(client.id))return;send(client,`event: duel\ndata: ${JSON.stringify(duelFor(duel,client.player.id))}\n\n`);}
  function broadcastDuel(duel){for(const client of clients.values())if(client.player.id===duel.initiatorId||client.player.id===duel.receiverId)sendDuel(client,duel);}
  function clientForPlayer(id){return [...clients.values()].filter(client=>client.player.id===id).sort((a,b)=>b.order-a.order)[0];}
  function activeMon(player){return player.save?.party?.find(mon=>mon.id===player.save.activePokemonId)||player.save?.party?.find(mon=>mon.hp>0)||player.save?.party?.[0];}
  function cloneMon(mon){return mon?{...mon,types:Array.isArray(mon.types)?[...mon.types]:[mon.type]}:null;}
  function duelFor(duel,viewerId){
    const mine=viewerId===duel.initiatorId?duel.initiator:duel.receiver,other=viewerId===duel.initiatorId?duel.receiver:duel.initiator;
    const publicMon=side=>({id:side.id,username:side.username,name:side.mon.name,speciesId:side.mon.speciesId,type:side.mon.type,types:side.mon.types,level:side.mon.level,hp:side.hp,maxHp:side.mon.maxHp,attack:side.mon.attack,defense:side.mon.defense,spAttack:side.mon.spAttack,spDefense:side.mon.spDefense,speed:side.mon.speed,moves:GameData.movesAtLevel(side.mon.speciesId,side.mon.level)});
    return {id:duel.id,status:duel.status,initiatorId:duel.initiatorId,receiverId:duel.receiverId,initiatorName:duel.initiatorName,receiverName:duel.receiverName,initiatorReady:duel.initiatorReady,receiverReady:duel.receiverReady,reason:duel.reason||'',winnerId:duel.winnerId||null,turn:duel.turn||0,lastAction:duel.lastAction||'',nextActorId:duel.nextActorId||null,action:duel.action||null,mine:publicMon(mine),other:publicMon(other)};
  }
  function makeDuel(initiator,receiver){
    const a=cloneMon(activeMon(initiator)),b=cloneMon(activeMon(receiver));
    return {id:`duel-${Date.now().toString(36)}-${(++order).toString(36)}`,createdAt:Date.now(),initiatorId:initiator.id,receiverId:receiver.id,initiatorName:initiator.username,receiverName:receiver.username,initiator:{id:initiator.id,username:initiator.username,mon:a,hp:a.hp},receiver:{id:receiver.id,username:receiver.username,mon:b,hp:b.hp},initiatorReady:true,receiverReady:false,status:'pending',turn:0,lastAction:'',nextActorId:null,action:null};
  }
  function clearDuelTimer(duel){const timer=duelTimers.get(duel.id);if(timer){clearTimeout(timer);duelTimers.delete(duel.id);}}
  function chooseDuelMove(side){const moveIds=GameData.movesAtLevel(side.mon.speciesId,side.mon.level).filter(id=>GameData.MOVE_DEFS[id]);return moveIds[Math.floor(Math.random()*moveIds.length)]||'tackle';}
  function scheduleDuelTurn(duel,delay=900){
    clearDuelTimer(duel); if(duel.status!=='battle')return;
    const timer=setTimeout(()=>{duelTimers.delete(duel.id);performDuelTurn(duel,duel.nextActorId);},delay);duelTimers.set(duel.id,timer);
  }
  function performDuelTurn(duel,actorId,requestedMoveId){
    if(!duel||duel.status!=='battle')return null;
    clearDuelTimer(duel);
    const actor=actorId===duel.initiatorId?duel.initiator:duel.receiver;
    const target=actor===duel.initiator?duel.receiver:duel.initiator;
    if(!actor||!target||actor.hp<=0||target.hp<=0)return null;
    const moveId=requestedMoveId||chooseDuelMove(actor),move=GameData.MOVE_DEFS[moveId]||GameData.MOVE_DEFS.tackle;
    const result=GameData.calculateDamage(move,actor.mon,target.mon),beforeTarget=target.hp,beforeActor=actor.hp;
    actor.hp=move.heal?Math.min(actor.mon.maxHp,actor.hp+move.heal):actor.hp;
    target.hp=move.damage?Math.max(0,target.hp-result.damage):target.hp;
    const relation=result.multiplier>=2?'属性克制！':result.multiplier===0?'没有效果。':result.multiplier<1?'效果较弱。':'';
    duel.turn=(duel.turn||0)+1;duel.nextActorId=target.id;
    duel.action={id:`${duel.id}-action-${duel.turn}`,actorId:actor.id,actorName:actor.username,actorMonName:actor.mon.name,targetId:target.id,moveId,moveName:move.name,type:move.type,damage:Math.max(0,beforeTarget-target.hp),heal:Math.max(0,actor.hp-beforeActor),multiplier:result.multiplier,targetHp:target.hp,actorHp:actor.hp};
    duel.lastAction=`${actor.username} 的 ${actor.mon.name} 使用了 ${move.name}${move.damage?`，造成 ${duel.action.damage} 点伤害`:''}${move.heal?`，回复 ${duel.action.heal} 点生命`:''}${relation?`，${relation}`:''}`;
    if(target.hp<=0){duel.status='finished';duel.winnerId=actor.id;duel.reason=`${target.mon.name} 失去战斗能力`;clearDuelTimer(duel);}
    else scheduleDuelTurn(duel,760);
    broadcastDuel(duel);return duel.action;
  }
  function beginDuel(duel){
    const first=duel.initiator.mon.speed>=duel.receiver.mon.speed?duel.initiator:duel.receiver;
    duel.nextActorId=first.id;duel.action=null;duel.lastAction='战斗开始，双方将自动随机释放已学技能。';broadcastDuel(duel);scheduleDuelTurn(duel,650);
  }
  function drop(client){
    if(clients.get(client.id)!==client)return;
    clients.delete(client.id);changed=true;
  }
  function connect(req,res,player,hash,id){
    if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id||''))return {status:400,message:'实时连接编号无效'};
    if(!player.save)return {status:409,message:'请先选择初始伙伴'};
    let seededWorld=false;
    if(!worldLoaded){
      if(Array.isArray(player.save.collected)&&player.save.collected.length)sharedCollected=new Set(player.save.collected.filter(id=>resourceIds.has(id)));
      if(Number.isInteger(player.save.day)&&player.save.day>worldDay)worldDay=player.save.day;
      worldLoaded=true;seededWorld=true;
    }
    if(!worldWildLoaded&&Array.isArray(player.save.wild)){for(const item of player.save.wild){const creature=creatureDefs.get(item?.id);if(!creature)continue;const level=Number.isInteger(item.level)?Math.max(1,Math.min(99,item.level)):creature.level,rarity=GameData.normalizeRarity(item.rarity),maxHp=GameData.statsAtLevel(creature.id,level,rarity).maxHp;sharedWild.set(creature.id,{id:creature.id,level,rarity,hp:Number.isInteger(item.hp)?Math.max(0,Math.min(maxHp,item.hp)):maxHp,captured:item.captured===true,respawnAt:0});}worldWildLoaded=true;seededWorld=true;}
    if(seededWorld)persistWorld();
    const previous=clients.get(id);
    if(previous&&previous.player.id!==player.id)return {status:409,message:'实时连接编号已被使用'};
    if(previous){drop(previous);previous.res.end();}
    for(const active of [...clients.values()])if(active.player.id===player.id&&active.hash===hash){drop(active);active.res.end();}
    const client={id,res,player,hash,x:player.save.player.x,y:player.save.player.y,battle:false,order:++order,lastSeen:Date.now()};
    clients.set(id,client);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    res.flushHeaders();res.write('retry: 1500\n\n');
    res.on('close',()=>{drop(client);broadcast();});
    broadcast();for(const duel of duels.values())if(duel.initiatorId===player.id||duel.receiverId===player.id)sendDuel(client,duel);return null;
  }
  function update(player,hash,input){
    const client=clients.get(input?.clientId);
    if(!client||client.player.id!==player.id||client.hash!==hash)return {status:409,message:'实时连接已断开，请重新连接'};
    if(!Number.isFinite(input.x)||input.x<44||input.x>916||!Number.isFinite(input.y)||input.y<60||input.y>560||typeof input.battle!=='boolean')return {status:400,message:'玩家位置无效'};
    let worldChanged=false;
    if(refreshWildRespawns()){persistWorld();worldChanged=true;}
    if(Array.isArray(input.collect))for(const id of input.collect)if(resourceIds.has(id)&&!sharedCollected.has(id)){sharedCollected.add(id);worldChanged=true;}
    if(Array.isArray(input.wild))for(const item of input.wild){const creature=creatureDefs.get(item?.id),current=creature&&sharedWild.get(item.id);if(!creature||!current||typeof item.captured!=='boolean'||!Number.isInteger(item.hp))continue;const incomingRarity=item.rarity===undefined?current.rarity:GameData.normalizeRarity(item.rarity),maxHp=GameData.statsAtLevel(creature.id,current.level,current.rarity).maxHp;if(item.captured&&!current.captured){current.captured=true;current.hp=0;current.respawnAt=0;worldChanged=true;}else if(!current.captured&&!item.captured&&item.level===current.level&&incomingRarity===current.rarity&&item.hp<current.hp){current.hp=Math.max(0,Math.min(maxHp,item.hp));if(current.hp<=0&&!current.respawnAt)current.respawnAt=Date.now()+respawnDelay();worldChanged=true;}}
    if(Number.isInteger(input.day)&&input.day>worldDay){worldDay=Math.max(worldDay,input.day);for(const creature of creatureDefs.values()){const current=sharedWild.get(creature.id);if(current&&!current.captured)sharedWild.set(creature.id,defaultWildState(creature,current.rarity));}worldChanged=true;}
    if(input.resetWorld===true){const hadCollected=sharedCollected.size>0,hadWild=[...sharedWild.values()].some(item=>!item.captured&&item.hp<GameData.statsAtLevel(item.id,item.level,item.rarity).maxHp);if(hadCollected||hadWild||worldDay!==1){sharedCollected.clear();for(const creature of creatureDefs.values()){const current=sharedWild.get(creature.id);if(!current?.captured)sharedWild.set(creature.id,defaultWildState(creature,current.rarity));}worldDay=1;worldResetVersion++;worldChanged=true;}}
    if(worldChanged){persistWorld();changed=true;}
    if(client.x!==input.x||client.y!==input.y||client.battle!==input.battle)changed=true;
    Object.assign(client,{x:input.x,y:input.y,battle:input.battle,order:++order,lastSeen:Date.now()});
    return null;
  }
  function invite(player,hash,targetId){
    const from=clientForPlayer(player.id),to=clientForPlayer(targetId);
    if(!from||from.hash!==hash)return {status:409,message:'实时连接已断开，请重新连接'};
    if(!to||to.player.id===player.id)return {status:404,message:'这位玩家当前不在线'};
    if(from.battle||to.battle)return {status:409,message:'战斗中的玩家不能发起或接受人物对战'};
    for(const duel of duels.values())if(duel.status==='pending'||duel.status==='battle')if([duel.initiatorId,duel.receiverId].includes(player.id)||[duel.initiatorId,duel.receiverId].includes(targetId))return {status:409,message:'其中一位玩家已经在对战或等待确认'};
    const duel=makeDuel(player,to.player);duels.set(duel.id,duel);broadcastDuel(duel);return {duel:duelFor(duel,player.id)};
  }
  function respond(player,hash,duelId,accept){
    const duel=duels.get(duelId);if(!duel||duel.receiverId!==player.id)return {status:404,message:'对战邀请已失效'};
    const client=clientForPlayer(player.id);if(!client||client.hash!==hash)return {status:409,message:'实时连接已断开，请重新连接'};
    if(duel.status!=='pending')return {duel:duelFor(duel,player.id)};
    duel.receiverReady=!!accept;duel.status=accept?'battle':'declined';duel.reason=accept?'':'对方拒绝了对战';if(accept)beginDuel(duel);else broadcastDuel(duel);return {duel:duelFor(duel,player.id)};
  }
  function action(player,hash,duelId,moveId){
    const duel=duels.get(duelId);if(!duel||duel.status!=='battle'||![duel.initiatorId,duel.receiverId].includes(player.id))return {status:404,message:'对战已结束'};
    const client=clientForPlayer(player.id);if(!client||client.hash!==hash)return {status:409,message:'实时连接已断开，请重新连接'};
    const mine=player.id===duel.initiatorId?duel.initiator:duel.receiver;
    const moveIds=GameData.movesAtLevel(mine.mon.speciesId,mine.mon.level);if(moveId&&!moveIds.includes(moveId))return {status:400,message:'这只宝可梦尚未学会该技能'};
    const move=moveId&&GameData.MOVE_DEFS[moveId];if(moveId&&!move)return {status:400,message:'技能不存在'};
    const actionResult=performDuelTurn(duel,player.id,moveId);return {duel:duelFor(duel,player.id),damage:actionResult?.damage||0};
  }
  function leaveDuel(player,duelId){const duel=duels.get(duelId);if(!duel||![duel.initiatorId,duel.receiverId].includes(player.id))return;clearDuelTimer(duel);duel.status='finished';duel.reason='对战已结束';broadcastDuel(duel);setTimeout(()=>duels.delete(duelId),4000);}
  function leave(player,hash,id){
    const client=clients.get(id);
    if(client&&client.player.id===player.id&&client.hash===hash){drop(client);client.res.end();broadcast();}
  }
  function revoke(hash){
    for(const client of [...clients.values()])if(client.hash===hash){drop(client);client.res.end();}
    broadcast();
  }
  const tick=setInterval(()=>{if(changed)broadcast();},100);
  const heartbeat=setInterval(()=>{
    if(refreshWildRespawns()){persistWorld();changed=true;}
    for(const client of [...clients.values()]){
      if(Date.now()-client.lastSeen>20000||!sessionValid(client.hash)){drop(client);client.res.end();}
      else send(client,': heartbeat\n\n');
    }
    for(const duel of [...duels.values()])if(Date.now()-duel.createdAt>30*60*1000&&duel.status==='pending'){clearDuelTimer(duel);duels.delete(duel.id);}
    if(changed)broadcast();
  },5000);
  tick.unref();heartbeat.unref();
  return {connect,update,leave,revoke,invite,respond,action,leaveDuel,close(){clearInterval(tick);clearInterval(heartbeat);for(const timer of duelTimers.values())clearTimeout(timer);duelTimers.clear();for(const client of [...clients.values()]){drop(client);client.res.end();}}};
}
module.exports={createPresence};
