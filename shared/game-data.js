(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.GameData = data;
})(typeof window !== 'undefined' ? window : this, function () {
  const STARTERS = ['bulbasaur', 'charmander', 'squirtle'];
  const MAX_PARTY = 6;
  const RARITY_GRADES = ['F','E','D','C','B','A','S','SS','SSS'];
  const RARITY_WEIGHTS = [36,24,16,10,6,3,1.5,.65,.2];
  const RARITY_INDEX = Object.fromEntries(RARITY_GRADES.map((grade,index)=>[grade,index]));
  function normalizeRarity(value) { return RARITY_INDEX[value] === undefined ? 'B' : value; }
  function rarityFactor(value) { return 1 + (RARITY_INDEX[normalizeRarity(value)] - RARITY_INDEX.B) * .1; }
  function rollRarity(random=Math.random) {
    const total=RARITY_WEIGHTS.reduce((sum,value)=>sum+value,0); let pick=Math.max(0,Math.min(total-.000001,random()*total));
    for(let index=0;index<RARITY_GRADES.length;index++){pick-=RARITY_WEIGHTS[index];if(pick<0)return RARITY_GRADES[index];}
    return 'SSS';
  }
  const SPECIES = {
    // These compact base values keep the demo readable while still making each
    // species feel different. Level growth is applied by statsAtLevel below.
    eevee:{name:'伊布',type:'一般',types:['一般'],maxHp:60,baseStats:{attack:16,defense:14,spAttack:16,spDefense:14,speed:17}},
    bulbasaur:{name:'妙蛙种子',type:'草 / 毒',types:['草','毒'],maxHp:72,baseStats:{attack:15,defense:16,spAttack:18,spDefense:18,speed:12}},
    squirtle:{name:'杰尼龟',type:'水',types:['水'],maxHp:64,baseStats:{attack:14,defense:19,spAttack:16,spDefense:20,speed:10}},
    pikachu:{name:'皮卡丘',type:'电',types:['电'],maxHp:56,baseStats:{attack:17,defense:11,spAttack:19,spDefense:12,speed:21}},
    charmander:{name:'小火龙',type:'火',types:['火'],maxHp:62,baseStats:{attack:18,defense:13,spAttack:18,spDefense:14,speed:18}},
    chikorita:{name:'菊草叶',type:'草',types:['草'],maxHp:68,baseStats:{attack:13,defense:18,spAttack:17,spDefense:20,speed:13}},
    torchic:{name:'火稚鸡',type:'火',types:['火'],maxHp:58,baseStats:{attack:16,defense:12,spAttack:19,spDefense:15,speed:16}},
    mudkip:{name:'水跃鱼',type:'水',types:['水'],maxHp:66,baseStats:{attack:18,defense:15,spAttack:16,spDefense:16,speed:11}},
    treecko:{name:'木守宫',type:'草',types:['草'],maxHp:57,baseStats:{attack:17,defense:12,spAttack:18,spDefense:13,speed:20}},
    cyndaquil:{name:'火球鼠',type:'火',types:['火'],maxHp:56,baseStats:{attack:15,defense:11,spAttack:20,spDefense:14,speed:19}},
    froakie:{name:'呱呱泡蛙',type:'水',types:['水'],maxHp:55,baseStats:{attack:14,defense:12,spAttack:18,spDefense:13,speed:21}},
    snivy:{name:'藤藤蛇',type:'草',types:['草'],maxHp:59,baseStats:{attack:14,defense:17,spAttack:17,spDefense:17,speed:18}}
  };
  // Compact implementation of the standard type chart. Values are attack multipliers.
  const TYPE_EFFECTIVENESS = {
    一般:{岩石:.5,钢:.5,幽灵:0}, 火:{火:.5,水:.5,草:2,冰:2,虫:2,岩石:.5,龙:.5,钢:2},
    水:{火:2,水:.5,草:.5,地面:2,岩石:2,龙:.5}, 草:{火:.5,水:2,草:.5,毒:.5,地面:2,岩石:2,飞行:.5,虫:.5,龙:.5,钢:.5},
    电:{水:2,电:.5,草:.5,地面:0,飞行:2,龙:.5}, 冰:{火:.5,水:.5,草:2,地面:2,飞行:2,龙:2,冰:.5,钢:.5},
    毒:{草:2,毒:.5,地面:.5,岩石:.5,幽灵:.5,钢:0}, 地面:{火:2,电:2,草:.5,毒:2,岩石:2,飞行:0,虫:.5,钢:2},
    飞行:{电:.5,草:2,格斗:2,岩石:.5,钢:.5}, 超能力:{格斗:2,毒:2,超能力:.5,钢:.5,恶:0},
    虫:{火:.5,草:2,格斗:.5,毒:.5,飞行:.5,超能力:2,幽灵:.5,钢:.5,妖精:.5}, 岩石:{火:2,冰:2,飞行:2,虫:2,格斗:.5,地面:.5,钢:.5},
    格斗:{一般:2,冰:2,岩石:2,恶:2,钢:2,毒:.5,飞行:.5,超能力:.5,虫:.5,妖精:.5,幽灵:0},
    幽灵:{一般:0,超能力:2,幽灵:2,恶:.5}, 龙:{龙:2,钢:.5,妖精:0}, 恶:{超能力:2,幽灵:2,格斗:.5,恶:.5,妖精:.5},
    钢:{火:.5,水:.5,电:.5,冰:2,岩石:2,妖精:2,钢:.5}, 妖精:{火:.5,毒:.5,钢:.5,格斗:2,龙:2,恶:2}
  };
  // A compact, level-based learnset inspired by the mainline games.
  // Damage and levels are intentionally scaled for this small survival demo.
  const MOVE_DEFS = {
    tackle:{name:'撞击',type:'一般',damage:14,heal:0,learnLevel:1,power:14,category:'physical'},
    sprout:{name:'萌芽波',type:'草',damage:10,heal:8,learnLevel:3,power:18,category:'special'},
    ember:{name:'炽焰爪',type:'火',damage:22,heal:0,learnLevel:4,power:22,category:'special'},
    vine:{name:'藤鞭',type:'草',damage:22,heal:0,learnLevel:4,power:22,category:'physical'},
    water:{name:'水枪',type:'水',damage:22,heal:0,learnLevel:4,power:22,category:'special'},
    electric:{name:'电击',type:'电',damage:22,heal:0,learnLevel:4,power:22,category:'special'},
    quick:{name:'电光一闪',type:'一般',damage:18,heal:0,learnLevel:3,power:18,category:'physical'},
    rest:{name:'休整',type:'一般',damage:0,heal:18,learnLevel:3,power:0},
    razorleaf:{name:'飞叶快刀',type:'草',damage:30,heal:0,learnLevel:7,power:30,category:'physical'},
    flamethrower:{name:'喷射火焰',type:'火',damage:34,heal:0,learnLevel:7,power:34,category:'special'},
    waterpulse:{name:'水之波动',type:'水',damage:34,heal:0,learnLevel:7,power:34,category:'special'},
    thunderbolt:{name:'十万伏特',type:'电',damage:34,heal:0,learnLevel:7,power:34,category:'special'},
    swift:{name:'高速星星',type:'一般',damage:28,heal:0,learnLevel:7,power:28,category:'special'},
    solarbeam:{name:'日光束',type:'草',damage:46,heal:0,learnLevel:10,power:46,category:'special'}
  };
  const SPECIES_LEARNSET = {
    eevee:[['tackle',1],['quick',3],['rest',3],['swift',7]],
    bulbasaur:[['tackle',1],['sprout',3],['vine',4],['razorleaf',7],['solarbeam',10]],
    chikorita:[['tackle',1],['sprout',3],['vine',4],['razorleaf',7]],
    squirtle:[['tackle',1],['water',4],['rest',3],['waterpulse',7]],
    pikachu:[['tackle',1],['electric',4],['quick',3],['thunderbolt',7]],
    charmander:[['tackle',1],['ember',4],['rest',3],['flamethrower',7]]
    ,torchic:[['tackle',1],['ember',3],['rest',4],['flamethrower',8]]
    ,mudkip:[['tackle',1],['water',3],['rest',4],['waterpulse',8]]
    ,treecko:[['tackle',1],['sprout',3],['vine',4],['razorleaf',8]]
    ,cyndaquil:[['tackle',1],['ember',3],['quick',4],['flamethrower',8]]
    ,froakie:[['tackle',1],['water',3],['quick',4],['waterpulse',8]]
    ,snivy:[['tackle',1],['sprout',3],['vine',4],['razorleaf',8]]
  };
  const SPECIES_MOVES = Object.fromEntries(Object.entries(SPECIES_LEARNSET).map(([species,learnset])=>[species,learnset.map(item=>item[0])]));
  const RESOURCES = [
    {id:'berry-a',type:'berry',x:164,y:158,label:'甜莓',amount:2}, {id:'berry-b',type:'berry',x:734,y:171,label:'甜莓',amount:2},
    {id:'tree-a',type:'tree',x:260,y:112,label:'木材',amount:3}, {id:'tree-b',type:'tree',x:820,y:390,label:'木材',amount:3},
    {id:'stone-a',type:'stone',x:700,y:490,label:'石头',amount:2}, {id:'stone-b',type:'stone',x:126,y:437,label:'石头',amount:2},
    {id:'flower-a',type:'flower',x:550,y:176,label:'月光花',amount:1}, {id:'flower-b',type:'flower',x:368,y:490,label:'月光花',amount:1}
  ];
  const ITEM_DEFS = {
    berry:{name:'甜莓',icon:'🍓',description:'恢复用食材（暂不可使用）'},
    wood:{name:'木材',icon:'🪵',description:'营地建造材料（暂不可使用）'},
    stone:{name:'石头',icon:'◈',description:'营地建造材料（暂不可使用）'},
    flower:{name:'月光花',icon:'🌼',description:'复活一只阵亡的宝可梦'},
    legacy:{name:'已有物资',icon:'📦',description:'旧存档物资（暂不可使用）'},
    gachaMaterial:{name:'宝可梦抽卡材料',icon:'🎟️',description:'用于抽取一只随机宝可梦'}
  };
  const WILD = [
    {id:'eevee',x:650,y:305,temperament:'谨慎',size:82,level:3}, {id:'bulbasaur',x:300,y:410,temperament:'好奇',size:86,level:5},
    {id:'squirtle',x:150,y:305,temperament:'悠闲',size:78,level:4}, {id:'pikachu',x:750,y:95,temperament:'活泼',size:78,level:6},
    {id:'charmander',x:520,y:505,temperament:'勇敢',size:82,level:5}, {id:'chikorita',x:838,y:287,temperament:'温和',size:78,level:6},
    {id:'torchic',x:92,y:112,temperament:'热情',size:76,level:4}, {id:'mudkip',x:895,y:470,temperament:'顽皮',size:78,level:5},
    {id:'treecko',x:438,y:112,temperament:'机敏',size:78,level:6}, {id:'cyndaquil',x:240,y:530,temperament:'胆小',size:76,level:4},
    {id:'froakie',x:610,y:90,temperament:'灵活',size:76,level:5}, {id:'snivy',x:895,y:180,temperament:'优雅',size:78,level:6}
  ];
  function experienceForLevel(level) { return Math.max(0,Math.floor((level-1)*(level-1)*18)); }
  function levelFromExperience(experience) {
    let level=1; while(level<99&&experience>=experienceForLevel(level+1))level++; return level;
  }
  function statsAtLevel(speciesId, level, rarity='B') {
    const species=SPECIES[speciesId];
    const base=species?.baseStats||{attack:14,defense:14,spAttack:14,spDefense:14,speed:14};
    const growth=Math.max(0,Math.min(98,Math.floor(level||1)-1));
    const factor=rarityFactor(rarity);
    return {
      // Keep the demo's original starting HP at levels 1–4, then grow the
      // health pool with each later level so healing and battles stay readable.
      maxHp:Math.max(1,Math.round(((species?.maxHp||60)+Math.max(0,growth-3)*4)*factor)),
      attack:Math.max(1,Math.round((base.attack+growth*1.8)*factor)),
      defense:Math.max(1,Math.round((base.defense+growth*1.65)*factor)),
      spAttack:Math.max(1,Math.round((base.spAttack+growth*1.75)*factor)),
      spDefense:Math.max(1,Math.round(((base.spDefense??base.defense)+growth*1.65)*factor)),
      speed:Math.max(1,Math.round((base.speed+growth*1.7)*factor))
    };
  }
  function typeEffectiveness(moveType, defenderTypes) {
    const types=Array.isArray(defenderTypes)?defenderTypes:[defenderTypes];
    return types.reduce((multiplier,type)=>multiplier*(TYPE_EFFECTIVENESS[moveType]?.[type] ?? 1),1);
  }
  function calculateDamage(action, attacker, defender) {
    if(!action?.damage)return {damage:0,multiplier:1,stab:false};
    const multiplier=typeEffectiveness(action.type,defender?.types||[defender?.type]);
    // Normal-type moves use Attack, while every other type uses Special
    // Attack. Their matching defensive stat absorbs the corresponding power.
    const physical=action.type==='一般'||action.category==='physical';
    const attackStat=physical?(attacker?.attack||14):(attacker?.spAttack||14);
    const defenseStat=physical?(defender?.defense||14):(defender?.spDefense||defender?.defense||14);
    const levelDifference=(attacker?.level||1)-(defender?.level||1);
    // Keep the early demo's small numbers readable, then let the four stats
    // influence matchups more clearly once levels start to diverge.
    const rawStatRatio=attackStat/Math.max(1,defenseStat);
    // Even close-level encounters get a gentle stat influence. The wider
    // range only appears when levels are far apart, keeping early damage
    // readable while still rewarding Attack / Special Attack investment.
    const statRatio=Math.abs(levelDifference)<=2
      ? Math.max(.92,Math.min(1.08,1+(rawStatRatio-1)*.015))
      : Math.max(.78,Math.min(1.25,1+(rawStatRatio-1)*.18+levelDifference*.018));
    const levelRatio=Math.abs(levelDifference)<=2?1:Math.max(.8,Math.min(1.2,1+levelDifference*.012));
    // The demo keeps the listed move power readable; the stat coefficient and
    // type multiplier provide the scaling without shrinking baseline moves.
    const coefficient=1;
    return {damage:Math.max(1,Math.round(action.damage*coefficient*multiplier*statRatio*levelRatio)),multiplier,stab:false,category:physical?'physical':'special',physical,coefficient,attackStat,defenseStat,statRatio,levelRatio};
  }
  function learnset(speciesId) { return SPECIES_LEARNSET[speciesId] || [['tackle',1],['quick',3],['rest',3]]; }
  // Battle UI keeps four equipped moves; newer learned skills replace the oldest slot.
  function movesAtLevel(speciesId,level) { return learnset(speciesId).filter(([,learnLevel])=>learnLevel<=level).map(([move])=>move).slice(-4); }
  const GACHA_POOL = Object.keys(SPECIES);
  function makePokemon(speciesId, starter = false, levelOverride, rarity='B', idOverride) {
    const species=SPECIES[speciesId];
    const level=Number.isInteger(levelOverride)?Math.max(1,Math.min(99,levelOverride)):starter?4:3;
    const grade=normalizeRarity(rarity),stats=statsAtLevel(speciesId,level,grade);
    return {id:idOverride||`${starter?'starter':'wild'}-${speciesId}`,speciesId,...species,...stats,rarity:grade,growthFactor:rarityFactor(grade),hp:stats.maxHp,level,experience:experienceForLevel(level),sprite:`assets/monsters/${speciesId}.png`};
  }
  function makeWildProgress(creature, rarity=rollRarity()) {
    const grade=normalizeRarity(rarity);
    return {id:creature.id,level:creature.level,rarity:grade,hp:statsAtLevel(creature.id,creature.level,grade).maxHp,captured:false};
  }
  function experienceReward(wild, action) {
    const level=Math.max(1,Math.floor(wild?.level||1)), power=action?.damage>=30?1.35:1;
    return Math.max(1,Math.round((8+level*3)*rarityFactor(wild?.rarity)*power));
  }
  function createSave(starterId) {
    if(!STARTERS.includes(starterId))throw new Error('请选择提供的三只初始宝可梦之一');
    const partner=makePokemon(starterId,true,4,'S');
    return {version:1,starterId,player:{x:468,y:315,hp:100,hunger:78},day:1,minutes:360,bag:0,balls:10,items:{rareCandy:3,gachaMaterial:999},inventory:{},
      party:[partner],warehouse:[],activePokemonId:partner.id,collected:[],wild:WILD.map(c=>makeWildProgress(c)),history:[]};
  }
  function snapshot(state) {
    const inventory={};
    Object.entries(state.inventory||{}).forEach(([key,value])=>{if(Number.isInteger(value)&&value>0)inventory[key]=value;});
    const occupied=Object.keys(inventory).length;
    const legacy=Math.max(0,Math.floor(state.bag||0)-occupied);
    if(legacy>0)inventory.legacy=(inventory.legacy||0)+legacy;
    return {version:1,starterId:state.starterId,player:{x:state.player.x,y:state.player.y,hp:state.player.hp,hunger:state.player.hunger},
      day:state.day,minutes:state.minutes,bag:Object.keys(inventory).length,balls:state.balls,items:{rareCandy:Math.max(0,Math.floor(state.items?.rareCandy||0)),gachaMaterial:Math.max(0,Math.floor(state.items?.gachaMaterial||0))},inventory,party:state.party.map(mon=>({id:mon.id,speciesId:mon.speciesId,rarity:normalizeRarity(mon.rarity),hp:mon.hp,level:mon.level,experience:Number.isFinite(mon.experience)?mon.experience:experienceForLevel(mon.level||3)})),warehouse:(state.warehouse||[]).map(mon=>({id:mon.id,speciesId:mon.speciesId,rarity:normalizeRarity(mon.rarity),hp:mon.hp,level:mon.level,experience:Number.isFinite(mon.experience)?mon.experience:experienceForLevel(mon.level||3)})),
      activePokemonId:state.activePokemonId,collected:[...state.collected],wild:state.creatures.map(c=>({id:c.id,level:c.level,rarity:normalizeRarity(c.rarity),hp:c.hp,captured:!!c.captured})),history:(state.history||[]).map(item=>({...item}))};
  }
  function validateSave(raw) {
    function check(ok,message){if(!ok)throw new Error(message);}
    function number(value,min,max,integer=false){
      check(typeof value==='number' && Number.isFinite(value) && value>=min && value<=max && (!integer||Number.isInteger(value)),'存档中有无效数值'); return value;
    }
    check(raw && raw.version===1 && STARTERS.includes(raw.starterId),'初始宝可梦或存档版本无效');
    check(raw.player && Array.isArray(raw.party) && raw.party.length>=1 && raw.party.length<=MAX_PARTY,'队伍数据无效');
    check(raw.warehouse===undefined||Array.isArray(raw.warehouse),'宝可梦仓库数据无效');
    const warehouseInput=Array.isArray(raw.warehouse)?raw.warehouse:[];
    const parsePokemon=(mon,starterAllowed)=>{
      check(mon && Object.hasOwn(SPECIES,mon.speciesId),'宝可梦种类无效');
      const starter=mon.id===`starter-${raw.starterId}`;
      const validId=starter?mon.speciesId===raw.starterId:(typeof mon.id==='string'&&/^(wild|gacha)-[a-z0-9-]+$/i.test(mon.id));
      check(validId&&(!starterAllowed||starter||mon.id!==`starter-${raw.starterId}`),'宝可梦身份无效');
      const fallbackLevel=number(mon.level===undefined?(starter?4:3):mon.level,1,99,true);
      const rarity=normalizeRarity(mon.rarity),result=makePokemon(mon.speciesId,starter,fallbackLevel,rarity);
      const experience=mon.experience===undefined?experienceForLevel(fallbackLevel):number(mon.experience,0,experienceForLevel(100),true);
      result.experience=experience;result.level=levelFromExperience(experience);Object.assign(result,statsAtLevel(mon.speciesId,result.level,rarity));result.rarity=rarity;result.growthFactor=rarityFactor(rarity);result.hp=number(mon.hp,0,result.maxHp,true);result.id=mon.id;return result;
    };
    const party=raw.party.map(mon=>parsePokemon(mon,true)),warehouse=warehouseInput.map(mon=>parsePokemon(mon,false));
    const allPokemon=[...party,...warehouse];
    check(new Set(allPokemon.map(mon=>mon.id)).size===allPokemon.length,'宝可梦身份重复');
    check(allPokemon.some(mon=>mon.id===`starter-${raw.starterId}`),'存档缺少初始伙伴');
    check(party.some(mon=>mon.id===raw.activePokemonId),'出战宝可梦无效');
    check(Array.isArray(raw.wild) && raw.wild.length<=WILD.length,'野怪进度无效');
    const wild=WILD.map(c=>{
      const matches=raw.wild.filter(item=>item && item.id===c.id);
      // Old saves contain only the original six encounters. Add newly
      // available species with fresh progress during validation.
      if(matches.length===0)return makeWildProgress(c,'B');
      check(matches.length===1,'野怪数据重复或缺失');
      const item=matches[0]; check(typeof item.captured==='boolean','捕捉状态无效');
      check(item.captured===allPokemon.some(mon=>mon.id===`wild-${c.id}`),'捕捉进度与队伍不一致');
      const level=number(item.level===undefined?c.level:item.level,1,99,true);
      const rarity=normalizeRarity(item.rarity),maxHp=statsAtLevel(c.id,level,rarity).maxHp;
      return {id:c.id,level,rarity,hp:number(item.hp,0,maxHp,true),captured:item.captured};
    });
    check(Array.isArray(raw.collected) && raw.collected.length<=RESOURCES.length && new Set(raw.collected).size===raw.collected.length,'物品进度无效');
    const collected=raw.collected.map(id=>{check(RESOURCES.some(r=>r.id===id),'物品种类无效');return id;});
    // The scene's collected-node list and the player's carried materials are
    // separate: resetting the camp can respawn nodes without deleting inventory.
    number(raw.bag,0,12,true);
    const inventory={};
    const inputInventory=raw.inventory&&typeof raw.inventory==='object'&&!Array.isArray(raw.inventory)?raw.inventory:null;
    if(inputInventory){
      Object.entries(inputInventory).forEach(([key,value])=>{
        check(Object.hasOwn(ITEM_DEFS,key),'物品种类无效');
        const amount=number(value,0,999,true);
        if(amount>0)inventory[key]=amount;
      });
    } else if(raw.bag>0){
      // Older saves only stored a carried-item total. Keep that quantity in a
      // visible compatibility stack until it can be assigned to a real type.
      inventory.legacy=number(raw.bag,0,12,true);
    }
    const bag=Object.keys(inventory).length;
    check(bag<=12,'背包格子已满');
    const items={rareCandy:Number.isInteger(raw.items?.rareCandy)?raw.items.rareCandy:0,gachaMaterial:Number.isInteger(raw.items?.gachaMaterial)?raw.items.gachaMaterial:0};
    check(items.rareCandy>=0&&items.rareCandy<=999&&items.gachaMaterial>=0&&items.gachaMaterial<=999999,'道具数据无效');
    const history=raw.history||[];
    check(Array.isArray(history)&&history.length<=5,'行动记录无效');
    const safeHistory=history.map(item=>{check(item&&typeof item.time==='string'&&/^\d{2}:\d{2}$/.test(item.time)&&typeof item.text==='string'&&item.text.length<=160,'行动记录无效');return {time:item.time,text:item.text};});
    return {version:1,starterId:raw.starterId,player:{x:number(raw.player.x,44,916),y:number(raw.player.y,60,560),hp:number(raw.player.hp,0,100),hunger:number(raw.player.hunger,0,100)},
      day:number(raw.day,1,1000000,true),minutes:number(raw.minutes,0,1439.999999),bag,balls:number(raw.balls,0,10,true),items:{rareCandy:items.rareCandy||0,gachaMaterial:items.gachaMaterial||0},inventory,party,warehouse,activePokemonId:raw.activePokemonId,collected,wild,history:safeHistory};
  }
  return {STARTERS,MAX_PARTY,RARITY_GRADES,RARITY_WEIGHTS,RARITY_INDEX,SPECIES,MOVE_DEFS,SPECIES_MOVES,SPECIES_LEARNSET,TYPE_EFFECTIVENESS,ITEM_DEFS,RESOURCES,WILD,GACHA_POOL,experienceForLevel,levelFromExperience,statsAtLevel,typeEffectiveness,calculateDamage,movesAtLevel,makePokemon,makeWildProgress,experienceReward,normalizeRarity,rarityFactor,rollRarity,createSave,snapshot,validateSave};
});
