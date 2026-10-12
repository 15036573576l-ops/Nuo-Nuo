// 把 assets/frostwing-src/frostwing.html（极寒之翼，three.js r128）离屏渲染成冰龙的逐帧图。
// 输出：<out>/<anim>_<i>.png（成品画面）和 <anim>_<i>.m.png（剪影遮罩），再由 tools/build_frostwing.py 合成条带图。
// 依赖：npm i three@0.128.0 playwright（NODE_PATH 指到装它们的 node_modules）。
// 用法：node tools/render_frostwing.js <out 目录> [probe]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'frostwing-frames'));
const PROBE = process.argv[3] === 'probe';
const VW = 1280, VH = 672;                  // 渲染视口（成品帧是它裁掉一侧再缩小一半，见 build_frostwing.py）

// 镜头：在龙的右前方，稍微俯视。出图后水平镜像，龙头朝右
const CAM = { tgt: [0.6, 7.6, 0.4], az: 1.02, pol: 1.3, r: 46 };
const T0 = 23;                              // 固定的动画时钟：呼吸、尾巴这些慢动作停在这一刻

function patched() {
  let html = fs.readFileSync(path.join(ROOT, 'assets/frostwing-src/frostwing.html'), 'utf8');
  const three = require.resolve('three/build/three.min.js');
  const rep = (a, b) => {
    if (!html.includes(a)) throw new Error('补丁位置没找到：' + a.slice(0, 60));
    html = html.replace(a, b);
  };
  rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
    `<script>window.__DG_TEST = { manual: true };</script><script src="file://${three}"></script>`);
  html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/, '');
  // 暴露内部函数，逐帧手动驱动
  rep('A, C, U, Q, VIEWS, applyView, renderer, scene, eyeMesh, D,',
    'A, C, U, Q, VIEWS, applyView, renderer, scene, eyeMesh, D, P, camera, animate, emitAll, updateParticles, updateCamera, renderFrame, mFinal,');
  // 精灵图不要暗角、色散和噪点
  rep('col *= 1.-smoothstep(0.18,0.95,r2*1.9)*0.62;', '');
  rep('vec2 off = c*r2*0.012;', 'vec2 off = vec2(0.);');
  rep('col += (hash21(gl_FragCoord.xy + fract(uTime)*91.7)-0.5)*0.018;', '');
  rep('camera.rotateZ(Math.sin(A.t * 0.13) * 0.006);', '');
  const f = path.join(os.tmpdir(), 'frostwing-render.html');
  fs.writeFileSync(f, html);
  return f;
}

// 页面里跑的部分
function pageSetup(cam) {
  const g = window.__dg;
  const THREE = window.THREE;
  const kids = g.scene.children;
  // 前 5 个是龙（皮、鳞、冰刺、翼膜、眼睛），Points 是吐息和冰尘；其余（天空、地面、冰柱、浮冰、风雪）全部隐藏
  const dragon = kids.slice(0, 5);
  const points = kids.find((o) => o.isPoints);
  for (const o of kids) o.visible = dragon.includes(o) || o === points;
  g.renderer.setClearColor(0x000000, 1);
  g.U.uFogDen.value = 0;
  g.A.auto = false;
  const mask = new THREE.ShaderMaterial({
    defines: { NB: g.D.bones.length },
    uniforms: { uBones: g.U.uBones, uBreath: g.U.uBreath },
    vertexShader: window.DG.GLSL.depthVert,
    fragmentShader: 'void main(){ gl_FragColor = vec4(1.); }',
    side: THREE.DoubleSide,
  });
  const cv = g.renderer.domElement;
  const grab = () => cv.toDataURL('image/png');
  window.__fw = {
    // 一帧：t 动画时钟，roarT / flapT 两个动作的进度（秒，-1 = 不播），dt 给粒子用
    frame(o) {
      const A = g.A;
      const dt = o.dt || 1 / 30;
      A.t = o.t; g.U.uTime.value = o.t;
      A.roarT = o.roarT == null || o.roarT < 0 ? -1 : o.roarT - dt;
      A.flapT = o.flapT == null || o.flapT < 0 ? -1 : o.flapT - dt;
      A.blinkT = 3;
      g.animate(dt);
      if (o.particles) { g.emitAll(dt); g.updateParticles(dt); }
      A.shake = 0;
      g.C.tgt.set(cam.tgt[0], cam.tgt[1], cam.tgt[2]);
      g.C.az = cam.az; g.C.pol = cam.pol; g.C.r = cam.r; g.C.tw = null; g.C.autoRot = false; g.C.follow = null; g.C.vAz = g.C.vPol = 0;
      g.updateCamera(0);
    },
    clearParticles() { g.P.life.fill(0); g.P.data.fill(0); },
    shot(particles) {
      points.visible = !!particles;
      g.renderFrame();
      const beauty = grab();
      points.visible = false;
      g.scene.overrideMaterial = mask;
      g.renderer.setRenderTarget(null);
      g.renderer.clear();
      dragon[3].visible = false; dragon[4].visible = false;
      g.renderer.render(g.scene, g.camera);
      const solid = grab();
      dragon[3].visible = true;
      g.renderer.clear();
      g.renderer.render(g.scene, g.camera);
      const all = grab();
      dragon[4].visible = true;
      g.scene.overrideMaterial = null;
      points.visible = true;
      return { beauty, solid, all };
    },
  };
}

// 动画表：每帧的参数。roar 事件全长 3.6 秒，flap 事件全长 3.4 秒（2.5 次振翼）
function plan() {
  const seq = {};
  // 飞行（待机和移动共用）：取振翼事件中间完整的一个周期，首尾相接
  seq.fly = Array.from({ length: 12 }, (_, i) => ({ t: T0, flapT: 3.4 * (0.3 + 0.4 * i / 12) }));
  // 咆哮吐息：吸气 → 张口喷吐 → 收口。带粒子，前面先空跑几帧
  seq.roar = Array.from({ length: 16 }, (_, i) => ({ t: T0 + 3.6 * (0.06 + 0.86 * i / 15), roarT: 3.6 * (0.06 + 0.86 * i / 15), particles: true }));
  return seq;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto('file://' + patched());
  await page.waitForFunction('window.__dgReady === true', null, { timeout: 600000 });
  console.log('龙建好了', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.addStyleTag({ content: '.mast,#hud,.hint,#loader{display:none!important}' });
  await page.evaluate(pageSetup, CAM);
  const save = (name, url) => fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));
  const shoot = async (name, particles) => {
    const r = await page.evaluate((p) => window.__fw.shot(p), particles);
    save(name + '.png', r.beauty); save(name + '.s.png', r.solid); save(name + '.a.png', r.all);
  };

  if (PROBE) {
    await page.evaluate((o) => window.__fw.frame(o), { t: T0, flapT: 3.4 * 0.5 });
    await shoot('probe_fly', false);
    for (let i = 0; i < 40; i++) await page.evaluate((o) => window.__fw.frame(o), { t: T0 + i / 30, roarT: 0.9 + i / 30, particles: true });
    await shoot('probe_roar', true);
    await browser.close();
    return;
  }

  const seq = plan();
  for (const [name, frames] of Object.entries(seq)) {
    await page.evaluate(() => window.__fw.clearParticles());
    let prev = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.particles) {
        // 粒子按 1/30 秒一步连续模拟到这一帧的时刻
        const from = prev == null ? f.roarT - 0.2 : prev;
        const n = Math.max(1, Math.round((f.roarT - from) * 30));
        for (let k = 1; k <= n; k++) {
          const rt = from + (f.roarT - from) * k / n;
          await page.evaluate((o) => window.__fw.frame(o), { t: f.t - (f.roarT - rt), roarT: rt, particles: true });
        }
        prev = f.roarT;
      } else {
        await page.evaluate((o) => window.__fw.frame(o), f);
      }
      await shoot(`${name}_${String(i).padStart(2, '0')}`, !!f.particles);
    }
    console.log(name, frames.length, '帧');
  }
  await browser.close();
})();
