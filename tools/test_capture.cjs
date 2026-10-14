const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

// Exercise the real game script with a controlled clock and random outcomes.
function game() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      style: {}, dataset: {}, children: [], attributes: {}, textContent: '', listeners: {},
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name)
      },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      click() { if (!this.disabled) this.listeners.click?.(); },
      focus() {}, getContext() { return {}; }
    };
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  Object.assign(get('gameCanvas'), {width: 960, height: 600});
  const moves = ['tackle', 'sprout', 'ember'].map(move => {
    const button = element(); button.dataset.move = move; return button;
  });
  let now = 0, nextTimer = 1, randomValue = 0;
  const timers = new Map();
  const randomMath = Object.create(Math);
  randomMath.random = () => randomValue;
  const context = vm.createContext({
    GameData: require('../shared/game-data.js'),
    document: {getElementById: get, createElement: element, querySelectorAll: selector => selector === '.move-btn' ? moves : []},
    window: {addEventListener() {}}, Image: class {}, Math: randomMath,
    requestAnimationFrame() {}, performance: {now: () => now},
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, {callback, due: now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const run = expression => vm.runInContext(expression, context);
  run(source);
  const state = run('state'); state.ready = true;
  return {
    state, get, moves, run,
    random(value) { randomValue = value; },
    start(index = 0) {
      const creature = state.creatures[index];
      state.player.x = creature.x; state.player.y = creature.y;
      run(`startBattle(state.creatures[${index}])`);
      return creature;
    },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([,timer]) => timer.due <= end).sort((a,b) => a[1].due-b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].callback();
      }
      now = end;
    }
  };
}

test('successful capture spends one ball, adds the correct partner, and removes the wild encounter', () => {
  const g = game(), c = g.start();
  g.run('capturePokemon(); capturePokemon(); useMove("ember")');
  assert.equal(g.state.balls, 9);
  assert.equal(c.hp, c.maxHp);
  assert.equal(g.get('captureBtn').disabled, true);
  assert.ok(g.moves.every(button => button.disabled));
  g.tick(1100);
  assert.equal(c.captured, true);
  assert.equal(g.state.party.length, 2);
  assert.equal(g.state.party[1].sprite, c.sprite);
  assert.equal(g.get('partyCount').textContent, '2 / 6');
  assert.match(g.get('battleMessage').textContent, /捕捉成功/);
  assert.equal(g.run('targetAt({x:650,y:285})'), null);
  assert.equal(g.run('nearCreature()'), undefined);
  assert.equal(g.run('targetAvailable({kind:"creature",target:state.creatures[0]})'), false);
  g.run('capturePokemon(); useMove("ember")');
  assert.equal(g.state.balls, 9);
  assert.equal(g.state.party.length, 2);
  assert.equal(g.state.player.hp, 100);
  g.tick(1600);
  assert.equal(g.state.battle, false);
});

test('defeating wild Pokémon grants draw material, and warehouse stores, retrieves, and releases Pokémon', () => {
  const g=game(), c=g.start();
  c.hp=1;g.run('useMove("ember"); closeBattle()');
  assert.equal(g.state.items.gachaMaterial,1000);
  g.run('drawGacha()');
  assert.equal(g.state.items.gachaMaterial,999);
  assert.equal(g.state.party.length,2);
  const id=g.state.party[1].id;
  g.run(`storePokemon("${id}")`);
  assert.equal(g.state.party.length,1);assert.equal(g.state.warehouse.length,1);
  g.run(`takePokemon("${id}")`);
  assert.equal(g.state.party.length,2);assert.equal(g.state.warehouse.length,0);
  g.run(`storePokemon("${id}"); releasePokemon("${id}","warehouse")`);
  assert.equal(g.state.party.length,1);assert.equal(g.state.warehouse.length,0);
  const capturedGame=game(),wild=capturedGame.start();capturedGame.run('capturePokemon()');capturedGame.tick(1100);capturedGame.run('closeBattle(); releasePokemon("wild-eevee","party")');
  assert.equal(wild.captured,false);assert.doesNotThrow(()=>capturedGame.run('GameData.validateSave(GameData.snapshot(state))'));
});

test('failed capture spends a ball, triggers one counterattack, and permits a retry', () => {
  const g = game(), c = g.start();
  g.random(.99);
  g.run('capturePokemon()');
  g.tick(1100);
  assert.equal(g.state.party.length, 1);
  assert.ok(!c.captured);
  assert.equal(g.state.player.hp, 100);
  assert.equal(g.state.battleBusy, true);
  assert.match(g.get('battleMessage').textContent, /挣脱/);
  g.tick(600);
  assert.equal(g.state.party[0].hp, 62);
  assert.equal(g.state.player.hp, 100);
  assert.equal(g.state.battleBusy, false);
  assert.equal(g.get('captureBtn').disabled, false);
  g.run('capturePokemon()');
  assert.equal(g.state.balls, 8);
  g.tick(1700);
  assert.equal(g.state.party[0].hp, 50);
});

test('weakening a wild Pokémon improves capture odds without allowing concurrent actions', () => {
  const full = game(); full.start(); full.random(.4);
  full.run('capturePokemon()'); full.tick(1100);
  assert.equal(full.state.party.length, 1);

  const weak = game(), c = weak.start(); weak.random(.4);
  weak.run('useMove("ember"); useMove("ember"); capturePokemon()');
  assert.equal(c.hp, c.maxHp-22);
  assert.equal(weak.state.balls, 10);
  weak.tick(450);
  weak.run('capturePokemon()'); weak.tick(1100);
  assert.equal(weak.state.party.length, 2);
  assert.equal(weak.state.party[1].hp, c.hp);
});

test('empty ball supply, a full party, and defeated Pokémon reject capture', () => {
  const empty = game(); empty.start(); empty.state.balls = 0;
  empty.run('updateBattle(); capturePokemon()');
  assert.equal(empty.get('captureBtn').disabled, true);
  assert.equal(empty.state.balls, 0);
  assert.equal(empty.state.battleBusy, false);

  const full = game(); full.start();
  full.state.party.push({...full.state.party[0]}, {...full.state.party[0]}, {...full.state.party[0]}, {...full.state.party[0]}, {...full.state.party[0]});
  full.run('updateBattle(); capturePokemon()');
  assert.equal(full.get('captureBtn').disabled, true);
  assert.equal(full.state.balls, 9);
  assert.equal(full.state.battleBusy, true);

  const defeated = game(), c = defeated.start(); c.hp = 10;
  defeated.run('useMove("ember"); capturePokemon()');
  assert.equal(c.hp, 0);
  assert.equal(defeated.state.balls, 10);
  assert.equal(defeated.get('captureBtn').disabled, true);
  defeated.tick(1000);
  assert.equal(defeated.state.battle, false);
  assert.equal(defeated.state.player.hp, 100);
});

test('retreat cancels pending capture and counterattacks across encounters', () => {
  const g = game(), old = g.start();
  g.run('capturePokemon(); closeBattle()');
  const next = g.start(1);
  g.tick(5000);
  assert.ok(!old.captured && !next.captured);
  assert.equal(g.state.party.length, 1);
  assert.equal(g.state.balls, 9);
  assert.equal(g.state.currentEncounter, next);
  assert.equal(g.state.player.hp, 100);
  g.random(.99); g.run('capturePokemon()'); g.tick(1100);
  g.run('closeBattle()'); g.start(2); g.tick(5000);
  assert.equal(g.state.player.hp, 100);
});

test('reset restores the camp scene while preserving party and carried supplies', () => {
  const g = game(), caught = g.start();
  g.run('capturePokemon()'); g.tick(1100);
  g.run('closeBattle(); state.balls=4; state.bag=2; state.items={rareCandy:77}; state.collected.add("berry-a"); state.activePokemonId="wild-eevee"; resetGame()');
  g.tick(5000);
  assert.equal(g.state.balls, 4);
  assert.equal(g.state.bag, 2);
  assert.equal(g.state.items.rareCandy, 77);
  assert.equal(g.state.collected.size, 0);
  assert.equal(g.state.party.length, 2);
  assert.equal(g.state.activePokemonId, 'wild-eevee');
  assert.equal(caught.captured, true);
  assert.ok(g.state.creatures.filter(c => !c.captured).every(c => c.hp === c.maxHp));
  assert.equal(g.state.battle, false);
  assert.equal(g.state.player.hp, 100);
  assert.equal(g.get('partyCount').textContent, '2 / 6');
});

function catchPartner(g, index = 0) {
  g.start(index); g.run('capturePokemon()'); g.tick(2700);
  return g.state.party.at(-1);
}

test('clicking a captured partner switches outside battle, including its portrait, HP, and moves', () => {
  const g = game(), eevee = catchPartner(g);
  g.get('partyList').children[1].click();
  assert.equal(g.state.activePokemonId, eevee.id);
  assert.equal(g.get('allyPortrait').children[0].src, eevee.sprite);
  assert.equal(g.get('playerHpText').textContent, '生命 60 / 60');
  assert.equal(g.get('partyList').children[1].attributes['aria-pressed'], 'true');
  assert.equal(g.get('partyList').children[0].attributes['aria-pressed'], 'false');
  assert.equal(g.moves[1].dataset.move, 'quick');
  assert.equal(g.state.party[0].id, 'starter-charmander');
  assert.equal(g.state.party[0].hp, 74);
  g.tick(5000);
  assert.equal(eevee.hp, 60);
  g.get('partyList').children[0].click();
  assert.equal(g.state.activePokemonId, 'starter-charmander');
  assert.equal(g.moves[1].dataset.move, 'ember');
});

test('battle roster selection consumes one turn, damages the new partner, and blocks repeated actions', () => {
  const g = game(), eevee = catchPartner(g), enemy = g.start(1);
  g.get('switchBtn').click();
  assert.equal(g.get('battleSwitcher').hidden, false);
  assert.equal(g.get('switchBtn').attributes['aria-expanded'], 'true');
  g.tick(1000);
  assert.equal(g.state.party[0].hp, 74);
  g.get('battleParty').children[1].click();
  assert.equal(g.state.activePokemonId, eevee.id);
  assert.equal(g.state.battleBusy, true);
  assert.equal(g.get('battleSwitcher').hidden, true);
  assert.ok(g.moves.every(button => button.disabled));
  g.run('switchPokemon("starter-charmander"); useMove("quick"); capturePokemon()');
  assert.equal(g.state.activePokemonId, eevee.id);
  assert.equal(g.state.balls, 9);
  assert.equal(enemy.hp, enemy.maxHp);
  g.tick(450);
  assert.equal(eevee.hp, 55);
  assert.equal(g.state.party[0].hp, 74);
  assert.equal(g.state.battleBusy, false);
  g.run('useMove("ember")');
  assert.equal(enemy.hp, enemy.maxHp);
  g.run('useMove("quick")');
  assert.equal(enemy.hp, enemy.maxHp-18);
  assert.match(g.get('battleMessage').textContent, /伊布 使用电光一闪/);
});

test('recovery moves heal only the active Pokémon and obey its own maximum HP', () => {
  const g = game(), eevee = catchPartner(g);
  g.get('partyList').children[1].click();
  const enemy = g.start(1); eevee.hp = 50;
  g.run('useMove("rest")');
  assert.equal(eevee.hp, 60);
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(g.state.party[0].hp, 74);
  assert.equal(g.state.player.hp, 100);
  g.tick(450);
  assert.equal(eevee.hp, 55);
  assert.equal(g.get('playerHpText').textContent, '生命 55 / 60');
});

test('switching is locked during a capture and unlocks after a failed attempt', () => {
  const g = game(), eevee = catchPartner(g); g.start(1); g.random(.99);
  g.run('capturePokemon(); switchPokemon("wild-eevee")');
  assert.equal(g.state.activePokemonId, 'starter-charmander');
  assert.equal(g.get('partyList').children[1].disabled, true);
  assert.equal(g.get('switchBtn').disabled, true);
  g.tick(1700);
  assert.equal(g.get('partyList').children[1].disabled, false);
  assert.equal(g.state.party[0].hp, 62);
  assert.equal(eevee.hp, 60);
  g.random(0); g.run('capturePokemon()'); g.tick(1100);
  assert.equal(g.get('partyList').children[1].disabled, true);
  g.run('switchPokemon("wild-eevee")');
  assert.equal(g.state.activePokemonId, 'starter-charmander');
  g.tick(1600); g.get('partyList').children[1].click();
  assert.equal(g.state.activePokemonId, 'wild-eevee');
});

test('a fainted Pokémon cannot act and replacement resumes automatic battle', () => {
  const g = game(), eevee = catchPartner(g), enemy = g.start(1);
  g.state.party[0].hp = 5;
  g.random(.99); g.run('capturePokemon()'); g.tick(1700);
  assert.equal(g.state.party[0].hp, 0);
  assert.equal(g.state.battle, true);
  assert.equal(g.state.battleResolved, false);
  assert.equal(g.get('battleSwitcher').hidden, false);
  assert.equal(g.get('partyList').children[0].disabled, true);
  assert.equal(g.get('captureBtn').disabled, true);
  g.run('useMove("ember"); capturePokemon()');
  assert.equal(g.state.balls, 8);
  g.random(0);
  g.get('battleParty').children[1].click();
  assert.equal(g.state.activePokemonId, eevee.id);
  assert.equal(g.state.battleBusy, false);
  g.tick(1000);
  assert.equal(eevee.hp, 55);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.equal(g.get('captureBtn').disabled, false);
  g.run('switchPokemon("starter-charmander"); switchPokemon("missing")');
  assert.equal(g.state.activePokemonId, eevee.id);
});

test('all-party defeat returns to camp with usable HP and reset cancels a pending switch turn', () => {
  const g = game(), eevee = catchPartner(g); g.start(1);
  g.state.party.forEach(mon => mon.hp = 5);
  g.run('useMove("tackle")'); g.tick(450);
  g.get('battleParty').children[1].click();
  g.run('useMove("tackle")'); g.tick(450);
  assert.equal(g.state.battleResolved, true);
  assert.equal(g.state.player.x, 468);
  assert.equal(g.state.player.y, 315);
  assert.ok(g.state.party.every(mon => mon.hp > 0));
  assert.equal(eevee.hp, 21);
  g.tick(1200); g.start(2);
  assert.equal(g.state.battle, true);
  g.run('switchPokemon("wild-eevee"); resetGame()'); g.tick(5000);
  assert.equal(g.state.activePokemonId, 'wild-eevee');
  assert.equal(g.state.party.length, 2);
  assert.equal(g.state.party[0].hp, 26);
  assert.equal(g.state.battle, false);
  assert.equal(g.state.partyMenuOpen, false);
  assert.match(g.get('allyName').textContent, /^伊布 · Lv\. 3 · XP /);
});

test('retreat cancels a switch counterattack and Pokémon keep their HP across encounters', () => {
  const g = game(), eevee = catchPartner(g); g.start(1);
  g.run('switchPokemon("wild-eevee"); closeBattle()'); g.tick(5000);
  assert.equal(eevee.hp, 60);
  g.start(2); g.run('useMove("quick")'); g.tick(450); g.run('closeBattle()');
  assert.equal(eevee.hp, 55);
  g.start(3);
  assert.equal(g.get('playerHpText').textContent, '生命 55 / 60');
  assert.equal(g.state.activePokemonId, 'wild-eevee');
});

test('all three starter choices retain their identity and moves through reset and save restoration', () => {
  for(const species of ['bulbasaur','charmander','squirtle']){
    const g=game(), data=g.run(`GameData.createSave('${species}')`);
    g.run('applyServerSave({user:{id:"test-user",username:"测试训练家"},save:GameData.createSave("'+species+'"),revision:1})');
    assert.equal(g.state.party[0].speciesId,species);
    assert.equal(g.state.party[0].hp,data.party[0].maxHp);
    assert.equal(g.state.party.length,1);
    g.run('resetGame()');
    assert.equal(g.state.starterId,species);
    assert.equal(g.state.activePokemonId,`starter-${species}`);
    g.run('currentUser=null; clearTimeout(saveTimer); saveTimer=null');
  }
});

test('capturing the same species as the starter preserves two distinct Pokémon after restoring a save', () => {
  const g=game();catchPartner(g,4);
  assert.equal(g.state.party[0].id,'starter-charmander');
  assert.equal(g.state.party[1].id,'wild-charmander');
  g.get('partyList').children[1].click();
  g.run('applyServerSave({user:{id:"test-user",username:"测试训练家"},save:GameData.snapshot(state),revision:4})');
  assert.equal(g.state.party.length,2);
  assert.equal(g.state.activePokemonId,'wild-charmander');
  assert.equal(g.state.creatures[4].captured,true);
  assert.equal(g.state.balls,9);
  g.run('currentUser=null; clearTimeout(saveTimer); saveTimer=null');
});

test('experience raises levels, unlocks the level learnset, and stores progress in snapshots', () => {
  const g=game(), mon=g.state.party[0];
  assert.equal(mon.level,4);
  assert.deepEqual(g.run('moveIds(state.party[0])'),['tackle','ember','rest']);
  g.run('gainExperience(state.party[0],486)');
  assert.equal(mon.experience,648);
  assert.equal(mon.level,7);
  assert.deepEqual(g.run('moveIds(state.party[0])'),['tackle','ember','rest','flamethrower']);
  assert.match(g.get('battleMessage').textContent,/升级到 Lv\.7/);
  const saved=g.run('GameData.snapshot(state)');
  assert.equal(saved.party[0].experience,648);
  const restored=require('../shared/game-data.js').validateSave(saved);
  assert.equal(restored.party[0].level,7);
  assert.equal(restored.party[0].experience,648);
});

test('level growth changes battle stats and wild levels survive save validation', () => {
  const data=require('../shared/game-data.js');
  const low=data.makePokemon('pikachu',false,3), high=data.makePokemon('pikachu',false,8);
  assert.ok(high.maxHp>low.maxHp);
  assert.ok(high.attack>low.attack);
  assert.ok(high.defense>low.defense);
  assert.ok(high.spAttack>low.spAttack);
  assert.ok(high.spDefense>low.spDefense);
  assert.ok(high.speed>low.speed);
  const save=data.createSave('charmander');
  const wild=save.wild.find(item=>item.id==='pikachu');
  assert.equal(wild.level,6);
  assert.equal(data.validateSave(save).wild.find(item=>item.id==='pikachu').level,6);
});

test('damage uses attack and defense for normal moves, and special attack and special defense for other types', () => {
  const data=require('../shared/game-data.js');
  const attacker={...data.makePokemon('charmander',false,8),attack:100,spAttack:10};
  const defender={...data.makePokemon('eevee',false,8),defense:10,spDefense:100};
  const physical=data.calculateDamage({...data.MOVE_DEFS.tackle,damage:20},attacker,defender);
  const special=data.calculateDamage({...data.MOVE_DEFS.ember,damage:20},attacker,defender);
  assert.equal(physical.attackStat,100);
  assert.equal(physical.defenseStat,10);
  assert.equal(special.attackStat,10);
  assert.equal(special.defenseStat,100);
  assert.equal(typeof physical.damage,'number');
  assert.equal(typeof special.damage,'number');
});

test('the package opens and a rare candy levels the active Pokémon once', () => {
  const g=game(), mon=g.state.party[0];
  g.state.items={rareCandy:2};
  g.run('renderParty()');
  assert.equal(g.get('rareCandyCount').textContent,'×2');
  g.get('bagBtn').click();
  assert.equal(g.get('bagPanel').hidden,false);
  g.get('rareCandyBtn').click();
  assert.equal(mon.level,5);
  assert.equal(mon.experience,require('../shared/game-data.js').experienceForLevel(5));
  assert.equal(g.state.items.rareCandy,1);
  assert.match(g.get('log').children[0].children[1].textContent,/使用神奇糖果/);
  assert.equal(g.get('rareCandyCount').textContent,'×1');
  g.state.battle=true; g.run('renderBag()');
  assert.equal(g.get('rareCandyBtn').disabled,true);
});

test('collected materials stack by type and use one inventory slot', () => {
  const g=game();
  g.run('state.player.x=164; state.player.y=158; interact(state.resources[0])');
  assert.equal(g.state.inventory.berry,2);
  assert.equal(g.state.bag,1);
  g.run('state.player.x=734; state.player.y=171; interact(state.resources[1])');
  assert.equal(g.state.inventory.berry,4);
  assert.equal(g.state.bag,1);
  g.run('state.player.x=260; state.player.y=112; interact(state.resources[2])');
  assert.equal(g.state.inventory.wood,3);
  assert.equal(g.state.bag,2);
  g.run('renderBag()');
  assert.equal(g.get('materialList').children.length,2);
  assert.equal(g.get('materialList').children[0].disabled,true);
  const save=g.run('GameData.snapshot(state)');
  const restored=require('../shared/game-data.js').validateSave(save);
  assert.deepEqual(restored.inventory,{berry:4,wood:3});
  assert.equal(restored.bag,2);
});

test('a moon flower revives a fainted partner from the package', () => {
  const g=game(), mon=g.state.party[0];
  mon.hp=0; g.state.inventory.flower=2; g.run('renderBag()');
  assert.equal(g.get('materialList').children[0].disabled,false);
  g.get('materialList').children[0].click();
  assert.ok(mon.hp>0);
  assert.equal(g.state.inventory.flower,1);
  assert.equal(g.state.bag,1);
});

test('the clock advances independently from walking', () => {
  const g=game();
  g.run('state.minutes=360; movePlayer(1,0,1)');
  assert.equal(g.state.minutes,360);
  g.run('advanceClock(4000)');
  assert.equal(g.state.minutes,361);
});

test('typed skills create a visual effect and stronger skills use the powerful treatment', () => {
  const g=game();
  g.run('showBattleEffect(GameData.MOVE_DEFS.ember,"小火龙")');
  assert.equal(g.get('battleFx').children.length,11);
  g.run('showBattleEffect(GameData.MOVE_DEFS.flamethrower,"小火龙")');
  assert.equal(g.get('battleFx').children.length,18);
  assert.match(g.get('battleFx').children[1].className,/powerful/);
});

test('type matchups alter damage advice and automatic battles pick learned skills', () => {
  const data=require('../shared/game-data.js');
  assert.equal(data.typeEffectiveness('火',['草']),2);
  assert.equal(data.typeEffectiveness('水',['火']),2);
  assert.equal(data.typeEffectiveness('电',['地面']),0);
  assert.equal(data.typeEffectiveness('火',['水']),.5);
  const g=game(), enemy=g.start(1);
  assert.equal(g.state.autoBattle,true);
  g.tick(1200);
  assert.equal(g.state.battleBusy,true);
  assert.ok(enemy.hp<enemy.maxHp);
  assert.match(g.get('battleMessage').textContent,/使用/);
});
