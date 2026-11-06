/* makaug off-plan walkthrough — a first-person look around an apartment built from its floor plan.
 *
 * One file, two uses: the public project page mounts it as an interactive
 * viewer (drag to look, keys or on-screen buttons to walk, "auto tour"), and
 * the offline renderer drives the same scene along the same camera path to
 * make the walkthrough videos. The scene is modelled from a compact layout
 * (metres): rooms with floor finishes and labels, wall segments with openings
 * for doors and windows, and simple furniture so a visitor can read the
 * rooms. It is a concept: the developer's finishes and dimensions govern.
 *
 * Expects window.THREE (three.js r150+). No build step.
 */
(function initializeMakaugWalkthrough(global) {
  'use strict';

  const EYE_HEIGHT = 1.55;
  const WALL_THICKNESS = 0.14;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function canvasTexture(THREE, draw, size = 256, repeat = [1, 1]) {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    draw(context, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function tileTexture(THREE, base = '#e9e3da', grout = '#d3ccc1', repeat = [1, 1]) {
    return canvasTexture(THREE, (ctx, size) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = grout; ctx.lineWidth = 3;
      const step = size / 2;
      for (let i = 0; i <= 2; i += 1) {
        ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,.025)';
      for (let i = 0; i < 40; i += 1) ctx.fillRect(Math.random() * size, Math.random() * size, 6, 2);
    }, 256, repeat);
  }

  function woodTexture(THREE, repeat = [1, 1]) {
    return canvasTexture(THREE, (ctx, size) => {
      ctx.fillStyle = '#b48a62'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 9; i += 1) {
        ctx.fillStyle = i % 2 ? '#a77c55' : '#bd936a';
        ctx.fillRect(0, i * (size / 9), size, size / 9 - 2);
      }
      ctx.strokeStyle = 'rgba(70,40,20,.18)'; ctx.lineWidth = 1;
      for (let i = 0; i < 30; i += 1) { ctx.beginPath(); ctx.moveTo(0, Math.random() * size); ctx.lineTo(size, Math.random() * size); ctx.stroke(); }
    }, 256, repeat);
  }

  function skyTexture(THREE) {
    return canvasTexture(THREE, (ctx, size) => {
      const sky = ctx.createLinearGradient(0, 0, 0, size);
      sky.addColorStop(0, '#6fa5d8'); sky.addColorStop(0.55, '#cfe3f3'); sky.addColorStop(0.56, '#8aa78a'); sky.addColorStop(0.72, '#6f9a6a'); sky.addColorStop(0.73, '#4c7fb2'); sky.addColorStop(1, '#3f6f9e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, size, size);
      const haze = ctx.createLinearGradient(0, size * 0.3, 0, size * 0.56);
      haze.addColorStop(0, 'rgba(255,255,255,0)'); haze.addColorStop(1, 'rgba(255,255,255,.55)');
      ctx.fillStyle = haze; ctx.fillRect(0, size * 0.3, size, size * 0.26);
      ctx.fillStyle = 'rgba(40,60,40,.35)';
      for (let i = 0; i < 18; i += 1) { const x = i * (size / 18); ctx.fillRect(x, size * 0.56 - 6 - (i % 4) * 7, size / 18 - 3, 10 + (i % 4) * 7); }
    }, 512, [1, 1]);
  }

  function materials(THREE) {
    const tiles = tileTexture(THREE, '#ebe6dd', '#d6cfc3', [1, 1]);
    const bathTiles = tileTexture(THREE, '#d8dcd9', '#b9c0bb', [2, 2]);
    const deck = woodTexture(THREE, [1.5, 1.5]);
    return {
      floor: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.55, metalness: 0.02 }),
      bath: new THREE.MeshStandardMaterial({ map: bathTiles, roughness: 0.4 }),
      deck: new THREE.MeshStandardMaterial({ map: deck, roughness: 0.8 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.92 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xb9ad9b, roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x9c7a56, roughness: 0.7 }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.7 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.35, metalness: 0.1 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x8f8373, roughness: 1 }),
      linen: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1 }),
      pillow: new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 1 }),
      white: new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.4, metalness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xbfe0f5, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28 }),
      screen: new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.2, metalness: 0.4 }),
      plant: new THREE.MeshStandardMaterial({ color: 0x3f7a3f, roughness: 1 }),
      pot: new THREE.MeshStandardMaterial({ color: 0x8c6a4a, roughness: 1 }),
      rug: new THREE.MeshStandardMaterial({ color: 0xcfc3b1, roughness: 1 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.5, metalness: 0.5 }),
      sky: new THREE.MeshBasicMaterial({ map: skyTexture(THREE), side: THREE.BackSide })
    };
  }

  function box(THREE, group, material, w, h, d, x, y, z, rotationY = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  /**
   * A wall from (x1,z1) to (x2,z2) with openings. Each opening sits `at`
   * metres along the wall, `width` wide, from `sill` up to `head`.
   */
  function buildWall(THREE, group, mats, wall, height) {
    const dx = wall.x2 - wall.x1; const dz = wall.z2 - wall.z1;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return;
    const angle = Math.atan2(dz, dx);
    const material = wall.material === 'accent' ? mats.accent : mats.wall;
    const thickness = wall.thickness || WALL_THICKNESS;
    const cuts = (wall.openings || []).slice().sort((a, b) => a.at - b.at);
    const place = (from, to, bottom, top) => {
      const w = to - from; const h = top - bottom;
      if (w <= 0.01 || h <= 0.01) return;
      const mid = from + w / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), material);
      mesh.position.set(wall.x1 + Math.cos(angle) * mid, bottom + h / 2, wall.z1 + Math.sin(angle) * mid);
      mesh.rotation.y = -angle;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    };
    let cursor = 0;
    cuts.forEach((cut) => {
      const start = clamp(cut.at - cut.width / 2, 0, length);
      const end = clamp(cut.at + cut.width / 2, 0, length);
      place(cursor, start, 0, height);
      const sill = cut.sill || 0; const head = cut.head || 2.15;
      if (sill > 0) place(start, end, 0, sill);
      if (head < height) place(start, end, head, height);
      if (cut.glass) {
        const w = end - start; const h = head - sill;
        const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), mats.glass);
        pane.position.set(wall.x1 + Math.cos(angle) * (start + w / 2), sill + h / 2, wall.z1 + Math.sin(angle) * (start + w / 2));
        pane.rotation.y = -angle;
        group.add(pane);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.06), mats.metal);
        frame.position.set(pane.position.x, head - 0.02, pane.position.z); frame.rotation.y = -angle; group.add(frame);
        const frame2 = frame.clone(); frame2.position.y = sill + 0.02; group.add(frame2);
      }
      cursor = end;
    });
    place(cursor, length, 0, height);
  }

  const FURNITURE = {
    bed(THREE, g, m, f) {
      const w = f.w || 1.6; const d = f.d || 2.0;
      box(THREE, g, m.darkWood, w + 0.1, 0.3, d + 0.1, 0, 0.15, 0);
      box(THREE, g, m.linen, w, 0.22, d, 0, 0.4, 0);
      box(THREE, g, m.pillow, w * 0.42, 0.12, 0.45, -w * 0.25, 0.57, -d / 2 + 0.35);
      box(THREE, g, m.pillow, w * 0.42, 0.12, 0.45, w * 0.25, 0.57, -d / 2 + 0.35);
      box(THREE, g, m.fabric, w, 0.05, d * 0.45, 0, 0.53, d * 0.2);
      box(THREE, g, m.darkWood, w + 0.3, 1.1, 0.08, 0, 0.55, -d / 2 - 0.06);
      box(THREE, g, m.wood, 0.45, 0.45, 0.4, -w / 2 - 0.35, 0.22, -d / 2 + 0.3);
      box(THREE, g, m.wood, 0.45, 0.45, 0.4, w / 2 + 0.35, 0.22, -d / 2 + 0.3);
    },
    sofa(THREE, g, m, f) {
      const w = f.w || 2.2; const d = f.d || 0.9;
      box(THREE, g, m.fabric, w, 0.42, d, 0, 0.21, 0);
      box(THREE, g, m.fabric, w, 0.5, 0.25, 0, 0.62, -d / 2 + 0.12);
      box(THREE, g, m.fabric, 0.22, 0.56, d, -w / 2 + 0.11, 0.5, 0);
      box(THREE, g, m.fabric, 0.22, 0.56, d, w / 2 - 0.11, 0.5, 0);
      box(THREE, g, m.pillow, 0.45, 0.4, 0.14, -w * 0.25, 0.6, -d / 2 + 0.3);
      box(THREE, g, m.pillow, 0.45, 0.4, 0.14, w * 0.25, 0.6, -d / 2 + 0.3);
    },
    armchair(THREE, g, m) {
      box(THREE, g, m.fabric, 0.8, 0.42, 0.8, 0, 0.21, 0);
      box(THREE, g, m.fabric, 0.8, 0.5, 0.2, 0, 0.62, -0.3);
      box(THREE, g, m.fabric, 0.18, 0.55, 0.8, -0.31, 0.5, 0);
      box(THREE, g, m.fabric, 0.18, 0.55, 0.8, 0.31, 0.5, 0);
    },
    table(THREE, g, m, f) {
      const w = f.w || 1.4; const d = f.d || 0.8; const h = f.h || 0.74;
      box(THREE, g, m.wood, w, 0.05, d, 0, h, 0);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(THREE, g, m.darkWood, 0.06, h, 0.06, sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08)));
      const chairs = f.chairs == null ? 4 : f.chairs;
      for (let i = 0; i < chairs; i += 1) {
        const side = i % 2 ? 1 : -1; const along = (Math.floor(i / 2) - (chairs / 2 - 1) / 2) * 0.6;
        box(THREE, g, m.darkWood, 0.42, 0.04, 0.42, along, 0.45, side * (d / 2 + 0.3));
        box(THREE, g, m.darkWood, 0.42, 0.45, 0.04, along, 0.68, side * (d / 2 + 0.5));
      }
    },
    coffee(THREE, g, m) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32), m.wood); mesh.position.y = 0.4; g.add(mesh);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.38, 12), m.metal); leg.position.y = 0.19; g.add(leg);
    },
    rug(THREE, g, m, f) { box(THREE, g, m.rug, f.w || 2.4, 0.015, f.d || 1.8, 0, 0.008, 0); },
    tv(THREE, g, m, f) {
      const w = f.w || 1.8;
      box(THREE, g, m.darkWood, w, 0.45, 0.42, 0, 0.225, 0);
      box(THREE, g, m.screen, 1.35, 0.78, 0.04, 0, 1.05, -0.05);
    },
    kitchen(THREE, g, m, f) {
      const w = f.w || 2.6; const d = 0.62;
      box(THREE, g, m.wood, w, 0.86, d, 0, 0.43, 0);
      box(THREE, g, m.stone, w + 0.04, 0.05, d + 0.04, 0, 0.885, 0);
      box(THREE, g, m.wood, w, 0.7, 0.36, 0, 1.75, -0.13);
      for (let i = 0; i < Math.floor(w / 0.6); i += 1) box(THREE, g, m.metal, 0.02, 0.5, 0.02, -w / 2 + 0.3 + i * 0.6, 0.45, d / 2 + 0.02);
      box(THREE, g, m.white, 0.6, 0.02, 0.42, -w / 2 + 0.5, 0.92, 0);
      box(THREE, g, m.metal, 0.52, 0.03, 0.46, w / 2 - 0.55, 0.92, 0);
      box(THREE, g, m.metal, 0.03, 0.3, 0.03, -w / 2 + 0.5, 1.05, -0.2);
    },
    fridge(THREE, g, m) { box(THREE, g, m.metal, 0.7, 1.8, 0.65, 0, 0.9, 0); },
    wardrobe(THREE, g, m, f) {
      const w = f.w || 1.8;
      box(THREE, g, m.wood, w, 2.2, 0.6, 0, 1.1, 0);
      for (let i = 1; i < Math.round(w / 0.6); i += 1) box(THREE, g, m.darkWood, 0.015, 2.1, 0.02, -w / 2 + i * 0.6, 1.1, 0.31);
    },
    wc(THREE, g, m) {
      box(THREE, g, m.white, 0.38, 0.42, 0.55, 0, 0.21, 0.05);
      box(THREE, g, m.white, 0.4, 0.4, 0.18, 0, 0.6, -0.2);
      box(THREE, g, m.white, 0.36, 0.03, 0.46, 0, 0.44, 0.08);
    },
    basin(THREE, g, m) {
      box(THREE, g, m.wood, 0.8, 0.8, 0.48, 0, 0.4, 0);
      box(THREE, g, m.white, 0.76, 0.1, 0.46, 0, 0.84, 0);
      box(THREE, g, m.glass, 0.7, 0.6, 0.02, 0, 1.45, -0.22);
      box(THREE, g, m.metal, 0.03, 0.2, 0.03, 0, 0.98, -0.12);
    },
    shower(THREE, g, m, f) {
      const w = f.w || 0.95;
      box(THREE, g, m.bath, w, 0.08, w, 0, 0.04, 0);
      box(THREE, g, m.glass, w, 2.0, 0.02, 0, 1.05, w / 2);
      box(THREE, g, m.glass, 0.02, 2.0, w, -w / 2, 1.05, 0);
      box(THREE, g, m.metal, 0.03, 1.2, 0.03, w / 2 - 0.1, 1.5, -w / 2 + 0.08);
      box(THREE, g, m.metal, 0.22, 0.02, 0.22, w / 2 - 0.1, 2.08, -w / 2 + 0.15);
    },
    plant(THREE, g, m) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.4, 14), m.pot); pot.position.y = 0.2; g.add(pot);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 8), m.darkWood); stem.position.y = 0.6; g.add(stem);
      for (let i = 0; i < 5; i += 1) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), m.plant);
        leaf.scale.set(1, 0.45, 1.3); leaf.position.set(Math.cos(i * 1.25) * 0.18, 0.95 + (i % 2) * 0.16, Math.sin(i * 1.25) * 0.18); leaf.rotation.y = i; g.add(leaf);
      }
    },
    desk(THREE, g, m) { box(THREE, g, m.wood, 1.2, 0.04, 0.6, 0, 0.74, 0); box(THREE, g, m.darkWood, 0.05, 0.72, 0.55, -0.55, 0.36, 0); box(THREE, g, m.darkWood, 0.05, 0.72, 0.55, 0.55, 0.36, 0); },
    shelf(THREE, g, m, f) { const w = f.w || 1.0; box(THREE, g, m.wood, w, 1.8, 0.35, 0, 0.9, 0); for (let i = 1; i < 4; i += 1) box(THREE, g, m.darkWood, w - 0.06, 0.02, 0.33, 0, i * 0.45, 0); },
    bench(THREE, g, m, f) { box(THREE, g, m.wood, f.w || 1.2, 0.42, 0.45, 0, 0.21, 0); },
    lounger(THREE, g, m) { box(THREE, g, m.fabric, 0.65, 0.12, 1.7, 0, 0.3, 0); box(THREE, g, m.fabric, 0.65, 0.5, 0.1, 0, 0.55, -0.8); box(THREE, g, m.metal, 0.6, 0.25, 1.6, 0, 0.12, 0); },
    rail(THREE, g, m, f) {
      const w = f.w || 2; box(THREE, g, m.rail, w, 0.05, 0.05, 0, 1.1, 0);
      box(THREE, g, m.glass, w, 1.0, 0.02, 0, 0.58, 0);
      for (let i = 0; i <= Math.round(w / 1.2); i += 1) box(THREE, g, m.rail, 0.04, 1.1, 0.04, -w / 2 + i * (w / Math.max(1, Math.round(w / 1.2))), 0.55, 0);
    }
  };

  function buildFurniture(THREE, group, mats, item) {
    const builder = FURNITURE[item.type];
    if (!builder) return;
    const g = new THREE.Group();
    g.position.set(item.x, 0, item.z);
    g.rotation.y = item.rot || 0;
    builder(THREE, g, mats, item);
    group.add(g);
  }

  function labelSprite(THREE, text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(12,38,24,.78)';
    ctx.beginPath(); ctx.roundRect(8, 20, 496, 88, 22); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '700 44px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false }));
    sprite.scale.set(1.6, 0.4, 1);
    return sprite;
  }

  /** Build the apartment. Returns { scene, root, bounds, walls, labels }. */
  function buildScene(THREE, layout, options = {}) {
    const mats = materials(THREE);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe3f3);
    const root = new THREE.Group();
    scene.add(root);
    const height = layout.wall_height || 2.85;
    const W = layout.width; const D = layout.depth;

    // Sky and a horizon so the balcony looks out on something.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 16), mats.sky);
    sky.position.set(W / 2, 0, D / 2);
    scene.add(sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x5f8a5c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -24, D / 2); scene.add(ground);

    // Floors per room, ceiling over the enclosed rooms.
    (layout.rooms || []).forEach((room) => {
      const material = room.floor === 'bath' ? mats.bath : room.floor === 'deck' ? mats.deck : mats.floor;
      const floorMaterial = material.clone();
      if (floorMaterial.map) { floorMaterial.map = floorMaterial.map.clone(); floorMaterial.map.needsUpdate = true; floorMaterial.map.repeat.set(Math.max(1, room.w / 0.8), Math.max(1, room.d / 0.8)); }
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.d), floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(room.x + room.w / 2, 0, room.z + room.d / 2);
      floor.receiveShadow = true;
      root.add(floor);
      if (room.floor !== 'deck') {
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.d), mats.ceiling);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(room.x + room.w / 2, height, room.z + room.d / 2);
        root.add(ceiling);
        if (room.label) {
          const sprite = labelSprite(THREE, room.label);
          sprite.position.set(room.x + room.w / 2, 2.35, room.z + room.d / 2);
          sprite.userData.label = true;
          root.add(sprite);
        }
      } else {
        // Balcony slab edge and a glass balustrade on the open sides.
        const slab = new THREE.Mesh(new THREE.BoxGeometry(room.w, 0.25, room.d), mats.accent);
        slab.position.set(room.x + room.w / 2, -0.13, room.z + room.d / 2);
        root.add(slab);
      }
    });

    (layout.walls || []).forEach((wall) => buildWall(THREE, root, mats, wall, wall.height || height));
    (layout.furniture || []).forEach((item) => buildFurniture(THREE, root, mats, item));

    // Light: soft sky light plus a sun through the balcony side.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.35);
    sun.position.set(W / 2 + 6, 9, D + 8);
    sun.target.position.set(W / 2, 0, D / 2);
    scene.add(sun); scene.add(sun.target);
    if (options.shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -14; sun.shadow.camera.right = 14; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    }
    (layout.lights || []).forEach((light) => {
      const point = new THREE.PointLight(0xfff4e0, light.intensity || 6, 7, 2);
      point.position.set(light.x, light.y || height - 0.3, light.z);
      scene.add(point);
    });
    const fill = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(fill);

    const walls = (layout.walls || []).map((wall) => ({ ...wall, length: Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) }));
    return { scene, root, mats, walls, bounds: { minX: 0, minZ: 0, maxX: W, maxZ: D } };
  }

  /** Keep a walker out of walls: push the point away from any solid wall part it is closer than `radius` to. */
  function collide(walls, x, z, radius = 0.32) {
    let px = x; let pz = z;
    for (let pass = 0; pass < 2; pass += 1) {
      walls.forEach((wall) => {
        const dx = wall.x2 - wall.x1; const dz = wall.z2 - wall.z1;
        const length = wall.length || Math.hypot(dx, dz);
        if (!length) return;
        const t = clamp(((px - wall.x1) * dx + (pz - wall.z1) * dz) / (length * length), 0, 1);
        const along = t * length;
        const open = (wall.openings || []).some((cut) => (cut.sill || 0) < 1.2 && along >= cut.at - cut.width / 2 && along <= cut.at + cut.width / 2);
        if (open) return;
        const cx = wall.x1 + dx * t; const cz = wall.z1 + dz * t;
        const dist = Math.hypot(px - cx, pz - cz);
        if (dist < radius && dist > 0.0001) {
          const push = (radius - dist) / dist;
          px += (px - cx) * push; pz += (pz - cz) * push;
        }
      });
    }
    return { x: px, z: pz };
  }

  /** The yaw that looks from (x, z) towards (toX, toZ). */
  function yawTowards(x, z, toX, toZ) {
    return Math.atan2(-(toX - x), -(toZ - z));
  }

  /** Catmull-Rom through the keyframes; `t` in seconds. A key may give `look: [x, z]` instead of `yaw`. */
  function samplePath(path, time) {
    const keys = path.map((key, index) => ({
      ...key,
      t: key.t == null ? index * 3 : key.t,
      yaw: key.yaw == null && Array.isArray(key.look) ? yawTowards(key.x, key.z, key.look[0], key.look[1]) : (key.yaw || 0)
    }));
    if (!keys.length) return { x: 0, z: 0, yaw: 0, pitch: 0 };
    const total = keys[keys.length - 1].t;
    const clock = clamp(time, 0, total);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= clock) i += 1;
    const a = keys[Math.max(0, i - 1)]; const b = keys[i]; const c = keys[Math.min(keys.length - 1, i + 1)]; const d = keys[Math.min(keys.length - 1, i + 2)];
    const span = Math.max(0.0001, c.t - b.t);
    const u = clamp((clock - b.t) / span, 0, 1);
    const smooth = u * u * (3 - 2 * u);
    const cr = (p0, p1, p2, p3, s) => 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
    const unwrap = (from, to) => { let delta = to - from; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2; return from + delta; };
    const yawB = b.yaw; const yawA = unwrap(yawB, a.yaw); const yawC = unwrap(yawB, c.yaw); const yawD = unwrap(yawC, d.yaw);
    return {
      x: cr(a.x, b.x, c.x, d.x, smooth),
      z: cr(a.z, b.z, c.z, d.z, smooth),
      yaw: cr(yawA, yawB, yawC, yawD, smooth),
      pitch: lerp(b.pitch || 0, c.pitch || 0, smooth),
      y: lerp(b.y == null ? EYE_HEIGHT : b.y, c.y == null ? EYE_HEIGHT : c.y, smooth),
      done: clock >= total,
      caption: b.caption || ''
    };
  }

  function pathDuration(path) {
    return path.length ? (path[path.length - 1].t == null ? (path.length - 1) * 3 : path[path.length - 1].t) : 0;
  }

  function applyPose(camera, pose) {
    camera.position.set(pose.x, pose.y == null ? EYE_HEIGHT : pose.y, pose.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = pose.yaw;
    camera.rotation.x = pose.pitch || 0;
  }

  /**
   * Mount an interactive viewer. Returns a controller with dispose(), tour(),
   * stopTour(), reset().
   */
  function mount(container, layout, options = {}) {
    const THREE = options.THREE || global.THREE;
    if (!THREE || !container) return null;
    const built = buildScene(THREE, layout, { shadows: false });
    const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const first = (layout.path && layout.path[0]) || { x: layout.width / 2, z: layout.depth / 2, yaw: 0 };
    const start = { x: first.x, z: first.z, yaw: first.yaw == null && Array.isArray(first.look) ? yawTowards(first.x, first.z, first.look[0], first.look[1]) : (first.yaw || 0) };
    const pose = { x: start.x, z: start.z, yaw: start.yaw, pitch: 0, y: EYE_HEIGHT };
    const keys = {};
    const touch = { forward: 0, turn: 0 };
    let dragging = null;
    let touring = false;
    let tourClock = 0;
    let disposed = false;
    let last = performance.now();

    const resize = () => {
      const width = container.clientWidth || 640; const height = container.clientHeight || 360;
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    resize();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(container);

    const onPointerDown = (event) => { touring = false; dragging = { x: event.clientX, y: event.clientY, yaw: pose.yaw, pitch: pose.pitch }; renderer.domElement.setPointerCapture?.(event.pointerId); };
    const onPointerMove = (event) => {
      if (!dragging) return;
      pose.yaw = dragging.yaw + (event.clientX - dragging.x) * 0.0062;
      pose.pitch = clamp(dragging.pitch + (event.clientY - dragging.y) * 0.0045, -0.9, 0.9);
    };
    const onPointerUp = () => { dragging = null; };
    const onKey = (down) => (event) => {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(key)) {
        keys[key] = down; touring = false;
        if (event.target === renderer.domElement || document.activeElement === renderer.domElement) event.preventDefault();
      }
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('keydown', onKey(true));
    renderer.domElement.addEventListener('keyup', onKey(false));
    renderer.domElement.addEventListener('wheel', (event) => { event.preventDefault(); touring = false; move(event.deltaY < 0 ? 0.35 : -0.35, 0); }, { passive: false });

    function move(forward, strafe) {
      // The camera looks down its local -Z: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
      const nx = pose.x - Math.sin(pose.yaw) * forward + Math.cos(pose.yaw) * strafe;
      const nz = pose.z - Math.cos(pose.yaw) * forward - Math.sin(pose.yaw) * strafe;
      const safe = collide(built.walls, clamp(nx, built.bounds.minX + 0.3, built.bounds.maxX - 0.3), clamp(nz, built.bounds.minZ + 0.3, built.bounds.maxZ - 0.3));
      pose.x = safe.x; pose.z = safe.z;
    }

    function frame(now) {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (touring && layout.path && layout.path.length) {
        tourClock += dt;
        const sample = samplePath(layout.path, tourClock);
        pose.x = sample.x; pose.z = sample.z; pose.yaw = sample.yaw; pose.pitch = sample.pitch; pose.y = sample.y;
        if (typeof options.onCaption === 'function') options.onCaption(sample.caption);
        if (sample.done) { touring = false; if (typeof options.onTourEnd === 'function') options.onTourEnd(); }
      } else {
        const speed = 1.6 * dt; const turn = 1.6 * dt;
        let forward = 0; let strafe = 0;
        if (keys.w || keys.arrowup) forward += 1;
        if (keys.s || keys.arrowdown) forward -= 1;
        if (keys.a) strafe -= 1;
        if (keys.d) strafe += 1;
        if (keys.arrowleft || keys.q) pose.yaw += turn;
        if (keys.arrowright || keys.e) pose.yaw -= turn;
        forward += touch.forward; pose.yaw -= touch.turn * turn;
        if (forward || strafe) move(forward * speed, strafe * speed);
        pose.y = EYE_HEIGHT;
      }
      applyPose(camera, pose);
      renderer.render(built.scene, camera);
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    return {
      tour() { touring = true; tourClock = 0; },
      stopTour() { touring = false; },
      isTouring() { return touring; },
      reset() { touring = false; pose.x = start.x; pose.z = start.z; pose.yaw = start.yaw; pose.pitch = 0; },
      press(direction, down) {
        if (direction === 'forward') touch.forward = down ? 1 : 0;
        if (direction === 'back') touch.forward = down ? -1 : 0;
        if (direction === 'left') touch.turn = down ? -1 : 0;
        if (direction === 'right') touch.turn = down ? 1 : 0;
        if (down) touring = false;
      },
      dispose() {
        disposed = true;
        if (observer) observer.disconnect();
        renderer.dispose();
        container.innerHTML = '';
      },
      renderer, camera, scene: built.scene
    };
  }

  global.MakaugWalkthrough = { buildScene, mount, samplePath, pathDuration, applyPose, collide, yawTowards, EYE_HEIGHT };
}(typeof window !== 'undefined' ? window : globalThis));
