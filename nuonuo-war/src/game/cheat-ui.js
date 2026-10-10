// 糯糯战记 · 作弊菜单 + 撒旦技能栏
// 作弊设置存在界面这边，每开一局复制进新引擎，所以“电脑水晶 100 万”这类设置下一局也还在。
(function () {
  const R = window.RULES;
  const C = window.Combat;
  const G = window.GameUI;
  const SATAN = C.BY_ID.satan;
  const $ = (id) => document.getElementById(id);

  // 跨局保留的作弊设置
  const cfg = {
    infiniteGold: false, noCd: false, noSupply: false, aiOff: false, satanNoCd: false,
    incomeMul: [1, 1], dmgMul: [1, 1], invuln: [false, false], godMode: [false, false],
    crystalMax: [R.lane.crystalHp, R.lane.crystalHp],
  };

  const eng = () => G.state.eng;
  const fmt = (n) => (n >= 1e8 ? `${+(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${+(n / 1e4).toFixed(1)} 万` : String(Math.round(n)));

  function pushCheats(e) {
    if (!e) return;
    const c = e.cheats;
    for (const k of ['infiniteGold', 'noCd', 'noSupply', 'aiOff', 'satanNoCd']) c[k] = cfg[k];
    for (const k of ['incomeMul', 'dmgMul', 'invuln', 'godMode']) c[k] = cfg[k].slice();
  }

  // ---------- 面板 ----------
  const SECTIONS = [
    { title: '金币', rows: [
      { label: '加钱', buttons: [['+1000', () => addGold(1000)], ['+1 万', () => addGold(1e4)], ['+10 万', () => addGold(1e5)]] },
      { label: '', toggles: [['无限金币', 'infiniteGold']] },
      { label: '我方收入', choice: ['incomeMul', 0, [1, 5, 20, 100]] },
    ] },
    { title: '出兵', rows: [
      { label: '', toggles: [['出兵无冷却', 'noCd'], ['无限人口', 'noSupply']] },
      { label: '撒旦', buttons: [['免费召唤撒旦', summonSatan]], toggles: [['撒旦技能无冷却', 'satanNoCd']] },
    ] },
    { title: '我方水晶', crystal: 0 },
    { title: '电脑水晶', crystal: 1 },
    { title: '伤害', rows: [
      { label: '我方伤害', choice: ['dmgMul', 0, [1, 3, 10, 100]] },
      { label: '电脑伤害', choice: ['dmgMul', 1, [1, 0.5, 0.1, 0]] },
      { label: '', toggles: [['我方单位无敌', 'godMode', 0], ['电脑单位无敌', 'godMode', 1]] },
    ] },
    { title: '电脑', rows: [
      { label: '', toggles: [['电脑停止出兵', 'aiOff']] },
      { label: '电脑收入', choice: ['incomeMul', 1, [0, 0.5, 1, 2, 5]] },
    ] },
    { title: '战场', rows: [
      { label: '速度', speed: [0.5, 1, 2, 4, 8] },
      { label: '', buttons: [['秒杀全部敌军', () => wipe(1), 'danger'], ['清空我方', () => wipe(0)]] },
    ] },
  ];

  function chip(text, on, onClick, extra) {
    const b = document.createElement('button');
    b.className = `chip${on ? ' on' : ''}${extra ? ' ' + extra : ''}`;
    b.textContent = text;
    b.addEventListener('click', () => { onClick(); render(); });
    return b;
  }

  function render() {
    const box = $('cheat');
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.innerHTML = '作弊菜单 <span></span>';
    h.querySelector('span').appendChild(chip('关闭', false, toggle));
    box.appendChild(h);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '单机游戏，哥哥说了算。按 C 打开或关闭。这里的设置会一直保留到下一局。';
    box.appendChild(hint);

    for (const sec of SECTIONS) {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = sec.title;
      fs.appendChild(lg);
      if (sec.crystal != null) crystalRows(fs, sec.crystal);
      for (const r of sec.rows || []) {
        const row = document.createElement('div');
        row.className = 'row';
        if (r.label) { const s = document.createElement('span'); s.textContent = r.label; row.appendChild(s); }
        for (const [t, fn, cls] of r.buttons || []) row.appendChild(chip(t, false, fn, cls));
        for (const [t, key, side] of r.toggles || []) {
          const on = side == null ? cfg[key] : cfg[key][side];
          row.appendChild(chip(t, on, () => {
            if (side == null) cfg[key] = !cfg[key]; else cfg[key][side] = !cfg[key][side];
            pushCheats(eng());
          }));
        }
        if (r.choice) {
          const [key, side, vals] = r.choice;
          for (const v of vals) row.appendChild(chip(`×${v}`, cfg[key][side] === v, () => { cfg[key][side] = v; pushCheats(eng()); }));
        }
        if (r.speed) {
          for (const v of r.speed) row.appendChild(chip(`${v}×`, G.state.speed === v, () => G.setSpeed(v)));
        }
        fs.appendChild(row);
      }
      box.appendChild(fs);
    }
  }

  function crystalRows(fs, side) {
    const e = eng();
    const c = e ? e.crystals[side] : null;
    const row1 = document.createElement('div');
    row1.className = 'row';
    row1.innerHTML = `<span>当前</span>`;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '1';
    inp.id = `cheat-hp-${side}`;
    inp.value = String(Math.ceil(c ? c.hp : cfg.crystalMax[side]));
    row1.appendChild(inp);
    row1.appendChild(chip('设为这个数', false, () => {
      const v = Math.max(1, Math.floor(Number(inp.value) || 1));
      setCrystal(side, v, Math.max(v, cfg.crystalMax[side]));
    }));
    fs.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.innerHTML = '<span>上限</span>';
    for (const v of [4000, 1e5, 1e6, 1e8]) {
      row2.appendChild(chip(fmt(v), cfg.crystalMax[side] === v, () => setCrystal(side, v, v)));
    }
    fs.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    row3.appendChild(chip('回满', false, () => { const e2 = eng(); if (e2) e2.setCrystal(side, e2.crystals[side].maxHp); }));
    row3.appendChild(chip('无敌', cfg.invuln[side], () => { cfg.invuln[side] = !cfg.invuln[side]; pushCheats(eng()); }));
    if (side === 1) row3.appendChild(chip('只剩 1 血', false, () => { const e2 = eng(); if (e2) e2.setCrystal(1, 1); }));
    fs.appendChild(row3);
  }

  // ---------- 作弊动作 ----------
  function addGold(n) {
    const e = eng();
    if (!e) return G.toast('先开始一局');
    e.sides[0].gold += n;
    G.toast(`+${fmt(n)} 金币`);
  }
  function setCrystal(side, hp, max) {
    cfg.crystalMax[side] = max;
    const e = eng();
    if (e) e.setCrystal(side, hp, max);
    G.toast(`${side === 0 ? '我方' : '电脑'}水晶：${fmt(hp)} / ${fmt(max)}`);
  }
  function wipe(side) {
    const e = eng();
    if (!e) return;
    e.wipe(side);
    G.toast(side === 1 ? '敌军已全部消失' : '我方已清空');
  }
  function summonSatan() {
    const e = eng();
    if (!e || e.ended) return G.toast('先开始一局');
    const S = e.sides[0];
    const saved = { gold: S.gold, cd: S.cdLeft.satan, supply: S.supplyUsed };
    S.gold += SATAN.cost;
    S.cdLeft.satan = 0;
    S.supplyUsed = Math.min(S.supplyUsed, R.economy.supplyCap - SATAN.supply);
    const why = e.canSpawn(0, 'satan');
    if (why === 'ok') {
      e.spawn(0, 'satan');
      S.gold = saved.gold;
      S.supplyUsed = saved.supply + SATAN.supply;
      G.toast('撒旦降临');
    } else {
      S.gold = saved.gold;
      S.cdLeft.satan = saved.cd;
      S.supplyUsed = saved.supply;
      G.toast(why === 'max' ? '撒旦已经在场上了' : '现在不能召唤');
    }
  }

  function toggle() {
    const box = $('cheat');
    const show = box.classList.contains('hidden');
    if (show) render();
    box.classList.toggle('hidden', !show);
  }

  // ---------- 撒旦技能栏 ----------
  const bar = $('satanbar');
  const btns = SATAN.manualSkills.map((m, i) => {
    const b = document.createElement('button');
    b.className = 'sk-btn';
    b.style.setProperty('--c', m.color);
    b.title = `${m.name}（${m.key}）：${m.desc}`;
    b.innerHTML = `<span class="k">${m.key}</span>${m.name}<span class="cdm"></span><span class="cdn"></span>`;
    b.addEventListener('click', () => cast(i));
    bar.appendChild(b);
    return { b, m, mask: b.querySelector('.cdm'), num: b.querySelector('.cdn') };
  });

  function cast(i) {
    const e = eng();
    if (!e || !G.state.running || G.state.paused || e.ended) return;
    const r = C.castManual(e, 0, i);
    if (r === 'cooldown') G.toast('技能冷却中');
    else if (r === 'nosatan') G.toast('撒旦不在场上');
  }

  G.onKey = (k) => {
    if (k === 'C') { toggle(); return; }
    const i = SATAN.manualSkills.findIndex((m) => m.key === k);
    if (i >= 0) cast(i);
  };
  G.onNewGame = (e) => {
    pushCheats(e);
    for (let s = 0; s < 2; s++) if (cfg.crystalMax[s] !== R.lane.crystalHp) e.setCrystal(s, cfg.crystalMax[s], cfg.crystalMax[s]);
    if (!$('cheat').classList.contains('hidden')) render();
  };
  let lastPanel = 0;
  G.onFrame = (e) => {
    const alive = e.units.some((u) => u.side === 0 && u.uid === 'satan' && e.alive(u));
    bar.classList.toggle('hidden', !alive);
    if (alive) {
      const cds = e.sides[0].manualCd;
      btns.forEach(({ m, mask, num }, i) => {
        const left = cds[i];
        mask.style.setProperty('--p', `${Math.round((left / m.cd) * 100)}%`);
        num.textContent = left > 0 ? String(Math.ceil(left)) : '';
      });
    }
    // 面板开着时，水晶血量输入框跟着刷新（正在输入时不打断）
    const now = performance.now();
    if (!$('cheat').classList.contains('hidden') && now - lastPanel > 500) {
      lastPanel = now;
      for (let s = 0; s < 2; s++) {
        const inp = $(`cheat-hp-${s}`);
        if (inp && document.activeElement !== inp) inp.value = String(Math.ceil(e.crystals[s].hp));
      }
    }
  };

  $('btn-cheat').addEventListener('click', toggle);
  // C 键在没开局时也能打开菜单
  window.addEventListener('keydown', (ev) => {
    if (G.state.running) return;
    if (ev.target && ev.target.tagName === 'INPUT') return;
    if (ev.key === 'c' || ev.key === 'C') toggle();
  });
})();
