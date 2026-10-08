// PIXELFIELD — a noise fluid field quantised to an 8 px dot grid, stepping at 12 fps. The field's
// value sorts every cell into one of three layers: mint/teal-grey fragments on black at the edge,
// a blue/indigo dot matrix on deep blue inside, bright purple on dark purple at the core. The
// field's height follows the loudness; kicks fray the edge and flash it acid green. The sung line
// sits on top in Archivo: words still to come as scanlines, sung words solid.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { frameIdx, hexToLinear } from '../engine/util';

const STEP_FPS = 12;
/** 60 fps frames per field step. */
const STEP = 60 / STEP_FPS;

const HEXES = {
  base: '#010413', mint: '#9EDB99', teal: '#618785', blue: '#1620B8', indigo: '#38189E',
  dpurple: '#4F0F84', purple: '#782296', bpurple: '#A941B1', acid: '#C8FF2E',
} as const;
const v3 = (hex: string) => `vec3(${hexToLinear(hex).map((x) => x.toFixed(5)).join(',')})`;

const FRAG = /* glsl */ `
uniform float ts;    // stepped time (s)
uniform float stepIdx; // step index (seeds the edge fragments)
uniform float level; // field height 0..1 (rms at the step)
uniform float kick;  // kick pulse at the step
const vec3 P_BASE = ${v3(HEXES.base)};
const vec3 P_MINT = ${v3(HEXES.mint)};
const vec3 P_TEAL = ${v3(HEXES.teal)};
const vec3 P_BLUE = ${v3(HEXES.blue)};
const vec3 P_INDIGO = ${v3(HEXES.indigo)};
const vec3 P_DPURPLE = ${v3(HEXES.dpurple)};
const vec3 P_PURPLE = ${v3(HEXES.purple)};
const vec3 P_BPURPLE = ${v3(HEXES.bpurple)};
const vec3 P_ACID = ${v3(HEXES.acid)};
const float CELL = 8.0;
const float DOT = 6.0; // dot side (logical px); the 2 px gap shows the layer's ground

void main() {
  vec2 px = FRAG_PX;                       // logical px, y up
  vec2 cell = floor(px / CELL);
  vec2 inCell = px - cell * CELL;
  vec2 c = (cell + 0.5) * CELL;            // the whole cell samples the field at its centre
  vec2 q = c / 1080.0;

  // flowing field: domain-warped fbm, rising from the bottom by the loudness
  vec2 w = vec2(fbm(vec3(q * 1.3, ts * 0.35), 3), fbm(vec3(q * 1.3 + 7.1, ts * 0.35), 3));
  float n = fbm(vec3(q * 2.1 + w * 0.9 + vec2(0.0, -ts * 0.25), ts * 0.2), 4);
  float height = mix(0.28, 0.82, level);
  float v = n * 0.55 + (height - c.y / 1080.0) * 1.5;

  float edge = 0.0;                        // layer 1 starts here
  float mid = 0.16 + kick * 0.08;          // kicks widen the fragmented edge band
  float core = mid + 0.30;

  vec3 ground = P_BASE;
  vec3 ink = P_BASE;
  float on = 0.0;
  float h = hash12(cell + stepIdx * 17.31);   // re-rolled every step
  if (v >= core) {
    ground = P_DPURPLE;
    float k = clamp((v - core) / 0.35, 0.0, 1.0);
    ink = hash12(cell * 1.7 + 3.0) < mix(0.25, 0.9, k) ? P_BPURPLE : P_PURPLE;
    on = 1.0;
  } else if (v >= mid) {
    ground = mix(P_BASE, P_BLUE, 0.35);
    float k = (v - mid) / (core - mid);
    ink = hash12(cell * 1.3 + 9.0) < k ? P_INDIGO : P_BLUE;
    on = 1.0;
  } else if (v >= edge - kick * 0.12) {
    // fragments: denser towards the blue layer and on kicks
    float k = clamp((v - edge + kick * 0.12) / (mid - edge + kick * 0.12), 0.0, 1.0);
    float density = mix(0.06, 0.6, k * k) + kick * 0.35;
    if (h < density) {
      on = 1.0;
      ink = hash12(cell + 41.0) < k ? P_MINT : P_TEAL;
      if (hash12(cell * 0.7 + stepIdx * 3.1) < kick * 0.8) ink = P_ACID;
    }
  }

  vec2 d = inCell - (CELL - DOT) * 0.5;
  // pixel centres sit on .5, so [0, DOT) covers exactly DOT px (DOT·PX_SCALE at 4K)
  float inside = step(0.0, d.x) * step(0.0, d.y) * step(d.x, DOT - 1e-3) * step(d.y, DOT - 1e-3);
  fragColor = vec4(mix(ground, ink, on * inside), 1.0);
}
`;

const SIZE = 132;
const LEFT = 120;
const BASELINE = 300;
const SCAN = 4; // scanline period (logical px), lit for half of it

export default class PixelField extends Scene {
  field = new FSPass(FRAG, {
    ts: { value: 0 }, stepIdx: { value: 0 }, level: { value: 0 }, kick: { value: 0 },
  });
  text = new Layer2D();
  fam = F.archivo(100, 900);
  lines: Line[] = [];

  override init() {
    const { lyrics, start, end } = this.ctx;
    this.lines = lyrics.linesIn(start, end);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;

    // 12 fps: frameIdx is constant over a frame's shutter, so no frame straddles a step
    const fi = frameIdx(f.t);
    const step = Math.floor(fi / STEP);
    const ts = (step * STEP) / 60;
    const a = audio.sample(ts); // the same features as f.a, read at the step
    const u = this.field.u;
    u.ts!.value = ts;
    u.stepIdx!.value = step % 4096;
    u.level!.value = Math.min(1, a.rms * 1.15);
    u.kick!.value = Math.min(1, a.kick);
    this.field.render(renderer, out);

    // lyric: word states at the frame's own time (also constant over the shutter)
    const tf = fi / 60;
    const line = this.lines.find((l) => tf >= l.start && tf < l.end)
      ?? [...this.lines].reverse().find((l) => l.start <= tf) ?? this.lines[0];
    const c = this.text.ctx;
    this.text.clear();
    if (line) {
      c.font = font(this.fam, SIZE);
      c.textBaseline = 'alphabetic';
      c.fillStyle = HEXES.acid;
      const size = Math.min(SIZE, (SIZE * (W - LEFT * 2)) / measure(line.text, this.fam, SIZE));
      c.font = font(this.fam, size);
      const space = measure(' ', this.fam, size);
      let x = LEFT;
      for (const w of line.words) {
        const ww = measure(w.w, this.fam, size);
        if (tf >= w.start) c.fillText(w.w, x, BASELINE);
        else {
          c.save();
          c.beginPath();
          for (let y = BASELINE - size; y < BASELINE + size * 0.3; y += SCAN) c.rect(x - 4, y, ww + 8, SCAN / 2);
          c.clip();
          c.fillText(w.w, x, BASELINE);
          c.restore();
        }
        x += ww + space;
      }
    }
    comp.draw(renderer, this.text.upload(), out);

    return { bloom: 0, halation: 0, grain: 0, ca: 0 };
  }
}
