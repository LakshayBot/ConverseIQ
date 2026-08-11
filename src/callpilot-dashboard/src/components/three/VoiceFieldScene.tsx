// ============================================================================
// VoiceField — the hero's ambient room. Two layers, both felt not noticed:
//
//   1. VOLUMETRIC LIGHT — three enormous, extremely slow radial blobs
//      (terracotta + lavender) drawn as a full-screen gradient. Their energy
//      sits behind the headline and the stage — the illuminated region the
//      content lives in. Drifts on a 20–40 s cycle, breathes with the mouse.
//
//   2. DUST — ~350 very faint specks (93% fewer than the original field)
//      spread across depth layers (z ∈ [−9, 9]), each with its own near-zero
//      opacity, soft-blurred sprite, and glacial drift. The headline zone is
//      masked out entirely: no dust ever crosses the typography.
//
// The pulse (card lands in the hero window) still reaches the field, but as
// a whisper — amplitude 0.30 → 0.55 — the room breathes, nothing jumps.
// One additive draw call per layer, no post-processing.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

const FIELD_W = 34
const FIELD_H = 20

// ── Dust: geometry + drift ──────────────────────────────────────────────────

const DUST_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform vec2 uMaskCenter;
  uniform vec2 uMaskSize;

  attribute float aSize;
  attribute float aPhase;
  attribute float aVary;
  attribute float aOpacity;
  attribute float aLayer;

  varying float vMix;
  varying float vFade;
  varying float vOpacity;

  void main() {
    vec3 p = position;

    // Glacial drift — depth layers move at different, always slow speeds.
    float speed = mix(0.055, 0.14, aLayer);
    float wave1 = sin(p.x * 0.24 + uTime * speed + aPhase) * 0.6;
    float wave2 = cos(p.x * 0.13 - uTime * speed * 0.7 + aPhase * 1.7) * 0.4;
    float wave3 = sin(p.x * 0.4 + p.y * 0.25 + uTime * speed * 1.1 + aPhase * 0.4) * 0.12;
    p.y += (wave1 + wave2 + wave3) * uAmp * aVary;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Depth attenuation — nearer dust is a little larger and brighter.
    float depth = -mv.z;
    gl_PointSize = aSize * (140.0 / depth) * mix(0.75, 1.25, aLayer);

    vMix = clamp(0.5 + p.y * 0.12, 0.0, 1.0);

    // Fade toward the edges — never a hard boundary, never a frame.
    vFade = smoothstep(-11.0, -4.5, p.y) * smoothstep(11.0, 5.0, p.y);

    // Typography mask: a soft rectangle around the headline zone. Dust is
    // cleared inside it — no particle ever crosses the words.
    vec2 d = abs(p.xy - uMaskCenter) / uMaskSize;
    float mask = 1.0 - smoothstep(0.72, 1.18, max(d.x, d.y));

    // Some specks are nearly invisible by design; depth dims the far ones.
    vOpacity = aOpacity * mix(0.5, 1.0, aLayer) * mask;
  }
`

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uTheme;

  varying float vMix;
  varying float vFade;
  varying float vOpacity;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    // Soft-blurred sprite: heavy, smooth falloff — dust, not dots.
    float alpha = pow(smoothstep(0.5, 0.02, d), 2.6);
    // Light theme: the dust recedes further into the paper.
    alpha *= vFade * vOpacity * mix(1.0, 0.5, uTheme);
    if (alpha < 0.004) discard;

    vec3 color = mix(uColorA, uColorB, vMix);
    gl_FragColor = vec4(color, alpha);
  }
`

// ── Volumetric light: full-screen drifting blobs ────────────────────────────

const LIGHT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LIGHT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uTheme;

  varying vec2 vUv;

  vec3 blob(vec2 uv, vec2 c, float r, vec3 col, float strength) {
    vec2 d = uv - c;
    float dist = dot(d, d) / (r * r);
    return col * strength * exp(-dist * 2.4);
  }

  void main() {
    vec2 uv = vUv + uMouse * 0.02;

    // Three enormous, near-static fields. Phases far apart so the motion
    // is a slow tide, never a pattern.
    vec2 c1 = vec2(0.30 + 0.05 * sin(uTime * 0.045), 0.70 + 0.04 * cos(uTime * 0.038));
    vec2 c2 = vec2(0.72 + 0.06 * cos(uTime * 0.03), 0.48 + 0.05 * sin(uTime * 0.04));
    vec2 c3 = vec2(0.42 + 0.04 * sin(uTime * 0.026 + 2.0), 0.86 + 0.05 * cos(uTime * 0.042 + 1.0));

    // Light theme: a warm daylight field — brighter warm, gentler cool.
    float intensity = mix(1.0, 0.55, uTheme);
    vec3 warm = mix(vec3(1.0, 0.52, 0.32), vec3(0.92, 0.62, 0.46), uTheme);
    vec3 cool = mix(vec3(0.55, 0.42, 1.0), vec3(0.55, 0.5, 0.72), uTheme);
    vec3 deep = mix(vec3(1.0, 0.62, 0.42), vec3(0.82, 0.6, 0.5), uTheme);

    vec3 col = vec3(0.0);
    col += blob(uv, c1, 0.42, warm, 0.075 * intensity);
    col += blob(uv, c2, 0.48, cool, 0.05 * intensity);
    col += blob(uv, c3, 0.52, deep, 0.045 * intensity);

    // Alpha follows the light's intensity: empty regions stay transparent,
    // so the canvas never paints an opaque veil over the page.
    float alpha = clamp(length(col) * 3.0, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`

const TARGET_REST = 0.3
const TARGET_PULSE = 0.55

export function VoiceFieldScene({ mobile = false }: { mobile?: boolean }): React.JSX.Element {
  const dustRef = useRef<THREE.Points>(null)
  const lightRef = useRef<THREE.Mesh>(null)
  const ampRef = useRef(TARGET_REST)
  const targetRef = useRef(TARGET_REST)
  const decayRef = useRef(1)
  const themeRef = useRef(
    document.documentElement.dataset.theme === 'light' ? 1 : 0,
  )

  // ── Dust geometry: denser below (behind the stage), sparse in the text
  //    zone, spread across nine depth layers.
  const dustGeometry = useMemo(() => {
    const count = mobile ? 110 : 350
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)
    const varies = new Float32Array(count)
    const opacities = new Float32Array(count)
    const layers = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * FIELD_W
      // Bias downward: the top third of the field stays quiet.
      const y = (Math.pow(Math.random(), 1.5) - 0.5) * 2 * (FIELD_H * 0.42)
      const z = (Math.random() - 0.5) * 18
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      sizes[i] = 1.1 + Math.random() * 2.1
      phases[i] = Math.random() * Math.PI * 2
      varies[i] = 0.35 + Math.random() * 0.65
      opacities[i] = 0.12 + Math.random() * 0.28
      layers[i] = Math.random()
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geo.setAttribute('aVary', new THREE.BufferAttribute(varies, 1))
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1))
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1))
    return geo
  }, [mobile])

  const dustMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: TARGET_REST },
          uMaskCenter: { value: new THREE.Vector2(-1.5, 3.2) },
          uMaskSize: { value: new THREE.Vector2(5.4, 3.1) },
          uColorA: { value: new THREE.Color('#ff7a50') },
          uColorB: { value: new THREE.Color('#7d5df6') },
          uTheme: { value: 0 },
        },
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  const lightGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(70, 42)
    return geo
  }, [])

  const lightMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMouse: { value: new THREE.Vector2(0, 0) },
          uTheme: { value: 0 },
        },
        vertexShader: LIGHT_VERT,
        fragmentShader: LIGHT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  // The hero window pulses the field when a card lands.
  useEffect(() => {
    const onPulse = (): void => {
      targetRef.current = TARGET_PULSE
      decayRef.current = 0
    }
    window.addEventListener('cp:voice-pulse', onPulse)
    return () => window.removeEventListener('cp:voice-pulse', onPulse)
  }, [])

  // Theme adaptation — the light theme gets a softer, warmer ambient.
  useEffect(() => {
    const onTheme = (e: Event): void => {
      const detail = (e as CustomEvent<string>).detail
      themeRef.current = detail === 'light' ? 1 : 0
    }
    window.addEventListener('callpilot:theme', onTheme)
    return () => window.removeEventListener('callpilot:theme', onTheme)
  }, [])

  const mouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      mouse.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouse.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    dustMaterial.uniforms.uTime.value = t
    lightMaterial.uniforms.uTime.value = t

    // Pulse envelope: a whisper on card land, decaying back to rest.
    if (decayRef.current < 1) {
      decayRef.current = Math.min(1, decayRef.current + delta * 1.6)
      targetRef.current =
        TARGET_REST + (TARGET_PULSE - TARGET_REST) * Math.pow(1 - decayRef.current, 3)
    }
    ampRef.current += (targetRef.current - ampRef.current) * Math.min(1, delta * 2.5)
    dustMaterial.uniforms.uAmp.value = ampRef.current

    // Theme blends in quickly — the DOM carries the 0.55s crossfade,
    // the shader only needs to track it, so the lerp window is short
    // (≈160ms) and the per-frame JS cost disappears early.
    const theme = dustMaterial.uniforms.uTheme.value
    const nextTheme = themeRef.current
    if (Math.abs(nextTheme - theme) > 0.001) {
      dustMaterial.uniforms.uTheme.value = theme + (nextTheme - theme) * Math.min(1, delta * 6)
      lightMaterial.uniforms.uTheme.value = dustMaterial.uniforms.uTheme.value
    }

    // Restrained mouse parallax — the room leans, nothing chases the cursor.
    const mx = mouse.current.x
    const my = mouse.current.y
    lightMaterial.uniforms.uMouse.value.set(mx, my)

    if (dustRef.current) {
      dustRef.current.rotation.y += (mx * 0.06 - dustRef.current.rotation.y) * delta * 1.5
      dustRef.current.rotation.x += (my * 0.03 - dustRef.current.rotation.x) * delta * 1.5
    }
    if (lightRef.current) {
      lightRef.current.position.x = mx * 0.4
      lightRef.current.position.y = my * 0.25
    }
  })

  return (
    <group>
      <mesh
        ref={lightRef}
        geometry={lightGeometry}
        material={lightMaterial}
        position={[0, 0, -6]}
        renderOrder={0}
        frustumCulled={false}
      />
      <points
        ref={dustRef}
        geometry={dustGeometry}
        material={dustMaterial}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  )
}
