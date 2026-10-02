
const DUR = window.SCENE_DURATION || 60, FADE = 0.4, ANIM = 0.5;
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const scenes = [...document.querySelectorAll('.scene')];
const els = [...document.querySelectorAll('.el')];
window.renderAt = (t) => {
  for (const s of scenes) {
    const a = +s.dataset.s, b = +s.dataset.e;
    const last = b >= DUR;
    let o = 0;
    if (t >= a && (t < b || last)) {
      o = a === 0 ? 1 : Math.min(1, (t - a) / FADE);
      if (!last) o = Math.min(o, (b - t) / FADE);
    }
    s.style.opacity = Math.max(0, o);
  }
  for (const e of els) {
    const i = +e.dataset.in, out = e.dataset.out ? +e.dataset.out : null;
    let p = ease((t - i) / ANIM);
    if (out !== null && t >= out) p = 0;
    const from = e.dataset.from;
    let tr;
    if (from === 'up') tr = `translateY(${(1 - p) * 140}px)`;
    else if (from === 'stamp') tr = `rotate(-10deg) scale(${1 + (1 - p) * 1.4})`;
    else tr = `translateY(${(1 - p) * 40}px)`;
    e.style.opacity = p;
    e.style.transform = tr;
    if (e.hasAttribute('data-collapse')) e.style.display = (t < i || (out !== null && t >= out)) ? 'none' : '';
  }
  document.getElementById('progress').style.width = (t / DUR * 100) + '%';
};
window.DURATION = DUR;
renderAt(0);
