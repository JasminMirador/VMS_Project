import { useRef, useEffect } from 'react';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';
import './SpecularButton.css';
import { useTheme } from '../../context/ThemeContext';

const PAD = 20;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shapeSDF(vec2 p) { return sdRoundedRect(p, uHalfSize, uRadius); }

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = shapeSDF(p);
  vec2 L = vec2(cos(uAngle), sin(uAngle));

  // Dark base stroke hugging the edge for a sense of thickness
  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;

  // Symmetric specular: the edges facing toward/away from the light both
  // catch a streak. The angular window (size + fade) is measured with an
  // elliptical normal so it varies continuously along straight edges.
  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);
  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float hi = line * rim * edgeClamp * uIntensity;

  vec3 col = uBaseColor * base + uLineColor * hi;
  float a = clamp(base + hi, 0.0, 1.0);
  fragColor = vec4(col, a);
}
`;

// Emerald colors that older call sites pass in are re-mapped to the Mirador
// theme (brand) color so every glossy button follows the theme. Values mirror
// --brand in styles/global.css (dark / light); kept in JS because the WebGL
// layer needs concrete colors and can't read CSS vars during render.
const BRAND_MAP = {
  dark: {
    '#10b981': '#22d3ee', '#059669': '#22d3ee', '#34d399': '#67e8f9', '#6ee7b7': '#67e8f9',
    '#0d3326': '#0b3a45', '#064e3b': '#0b3a45', '#d1fae5': '#0b3a45',
    '#f0fff8': '#ecfeff', '#065f46': '#ecfeff',
  },
  light: {
    '#10b981': '#0e7490', '#059669': '#0e7490', '#34d399': '#0e7490', '#6ee7b7': '#a5f3fc',
    '#0d3326': '#cffafe', '#064e3b': '#cffafe', '#d1fae5': '#cffafe',
    '#f0fff8': '#ffffff', '#065f46': '#155e75',
  },
};
const toBrand = (c, map) => (typeof c === 'string' && map[c.toLowerCase()]) || c;

const SpecularButton = ({
  children = 'Get Started',
  size = 'lg',
  radius = 18,
  tint = '#ffffff',
  tintOpacity = 0,
  blur = 0,
  textColor = '#f5f5f5',
  lineColor = '#ffffff',
  baseColor = '#525252',
  intensity = 1,
  shineSize = 10,
  shineFade = 40,
  thickness = 1,
  speed = 0.35,
  followMouse = true,
  proximity = 250,
  autoAnimate = false,
  disabled = false,
  onClick,
  className = '',
  type = 'button',
  style = {},
  ...rest
}) => {
  const btnRef = useRef(null);
  const fxRef = useRef(null);
  const propsRef = useRef({});

  const themeCtx = useTheme();
  const isLight = themeCtx?.theme === 'light' ||
    (themeCtx?.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  const bm = BRAND_MAP[isLight ? 'light' : 'dark'];
  // Emerald call sites become the solid login-style button (--button-bg, white text).
  if (typeof tint === 'string' && BRAND_MAP.dark[tint.toLowerCase()]) {
    tint = '#0e7490';
    tintOpacity = 1;
    baseColor = '#0e7490';
    textColor = '#ffffff';
    lineColor = isLight ? '#a5f3fc' : '#67e8f9';
  } else {
    tint = toBrand(tint, bm);
    textColor = toBrand(textColor, bm);
    lineColor = toBrand(lineColor, bm);
    baseColor = toBrand(baseColor, bm);
  }

  propsRef.current = { radius, lineColor, baseColor, intensity, shineSize, shineFade, thickness, speed, followMouse, proximity, autoAnimate };

  useEffect(() => {
    const btn = btnRef.current;
    const fx = fxRef.current;
    if (!btn || !fx) return;

    const dpr = window.devicePixelRatio || 1;
    let renderer, gl;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr });
      gl = renderer.gl;
      if (!gl) return;
    } catch (e) {
      console.warn('WebGL initialization failed in SpecularButton:', e);
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uCenter: { value: [0, 0] },
        uHalfSize: { value: [1, 1] },
        uRadius: { value: 0 },
        uAngle: { value: 2.4 },
        uPx: { value: dpr },
        uLineColor: { value: [1, 1, 1] },
        uBaseColor: { value: [0.32, 0.32, 0.32] },
        uIntensity: { value: 1 },
        uShineSize: { value: 0.17 },
        uShineFade: { value: 0.7 },
        uThickness: { value: 1 },
        uBaseWidth: { value: dpr }
      }
    });

    const mesh = new Mesh(gl, { geometry, program });
    fx.appendChild(gl.canvas);

    const sizeRef = { w: 1, h: 1 };
    const resize = () => {
      const rect = btn.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      sizeRef.w = w;
      sizeRef.h = h;
      renderer.setSize(w + PAD * 2, h + PAD * 2);
      program.uniforms.uCenter.value = [(PAD + w / 2) * dpr, (PAD + h / 2) * dpr];
      program.uniforms.uHalfSize.value = [(w / 2) * dpr, (h / 2) * dpr];
    };
    const ro = new ResizeObserver(resize);
    ro.observe(btn);
    resize();

    let pointerAngle = null;
    let proximityT = 0;
    const onPointerMove = e => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
      const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
      const dist = Math.hypot(dx, dy);
      if (dist === 0) {
        const nx = (e.clientX - cx) / (rect.width / 2);
        const ny = (cy - e.clientY) / (rect.height / 2);
        pointerAngle = Math.atan2(2 / rect.height, -2 / rect.width) + nx * 0.3 + ny * 0.15;
      } else {
        pointerAngle = Math.atan2(cy - e.clientY, e.clientX - cx);
      }
      const t = Math.max(0, 1 - dist / Math.max(propsRef.current.proximity, 1));
      proximityT = t * t * (3 - 2 * t);
    };
    window.addEventListener('pointermove', onPointerMove);

    let angle = 2.4;
    let idleAngle = 2.4;
    let bright = 0;
    let last = performance.now();
    let raf = 0;

    const lineC = new Color();
    const baseC = new Color();

    const update = now => {
      raf = requestAnimationFrame(update);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const p = propsRef.current;

      idleAngle += p.speed * dt;
      const steer = p.followMouse && pointerAngle != null && (!p.autoAnimate || proximityT > 0);
      const target = steer ? pointerAngle : idleAngle;
      const diff = ((target - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += diff * (1 - Math.exp(-dt * 7));

      const brightTarget = p.autoAnimate ? 1 : proximityT;
      bright += (brightTarget - bright) * (1 - Math.exp(-dt * 8));

      lineC.set(p.lineColor);
      baseC.set(p.baseColor);
      program.uniforms.uAngle.value = angle;
      program.uniforms.uRadius.value = Math.min(p.radius, Math.min(sizeRef.w, sizeRef.h) / 2) * dpr;
      program.uniforms.uLineColor.value = [lineC.r, lineC.g, lineC.b];
      program.uniforms.uBaseColor.value = [baseC.r, baseC.g, baseC.b];
      program.uniforms.uIntensity.value = p.intensity * bright;
      program.uniforms.uShineSize.value = (p.shineSize * Math.PI) / 180;
      program.uniforms.uShineFade.value = (p.shineFade * Math.PI) / 180;
      program.uniforms.uThickness.value = p.thickness * dpr;
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      if (gl.canvas.parentNode === fx) fx.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`specular-button specular-button--${size}${className ? ` ${className}` : ''}`}
      style={{
        ...style,
        '--sb-radius': `${radius}px`,
        '--sb-tint': tint,
        '--sb-tint-opacity': tintOpacity,
        '--sb-blur': `${blur}px`,
        '--sb-text-color': textColor
      }}
      {...rest}
    >
      <span ref={fxRef} className="specular-button__fx" aria-hidden="true" />
      <span className="specular-button__label">{children}</span>
    </button>
  );
};

export default SpecularButton;
