// ============================================================================
// VoiceField — a persistent, GPU-cheap particle field behind the hero.
// The field is *voice*: it hums at a low amplitude, and every time a
// transcript line lands in the hero window it pulses once — the page
// breathes with the call. One draw call, additive, no post-processing.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

const COUNT = 5200
const WIDTH = 34
const HEIGHT = 20

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;

  attribute float aSize;
  attribute float aPhase;
  attribute float aVary;

  varying float vMix;
  varying float vFade;

  void main() {
    vec3 p = position;

    float wave1 = sin(p.x * 0.42 + uTime * 0.85 + aPhase) * 0.34;
    float wave2 = cos(p.x * 0.23 - uTime * 0.6 + aPhase * 1.7) * 0.22;
    float wave3 = sin(p.x * 0.9 + p.y * 0.4 + uTime * 1.5 + aPhase * 0.4) * 0.1;
    p.y += (wave1 + wave2 + wave3) * uAmp * aVary;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (140.0 / -mv.z);

    vMix = clamp(0.5 + p.y * 0.16, 0.0, 1.0);
    // Bright band reaches the top of the camera frustum (p.y ≈ 7.3) so the
    // halo never reads as clipped against the TopNav / viewport edge. The
    // lower edge is unchanged — particles fade out below the hero copy.
    vFade = smoothstep(-10.5, -4.0, p.y) * smoothstep(10.5, 6.0, p.y);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying float vMix;
  varying float vFade;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float alpha = smoothstep(0.5, 0.08, d) * 0.85 * vFade;
    if (alpha < 0.003) discard;

    vec3 color = mix(uColorA, uColorB, vMix);
    gl_FragColor = vec4(color, alpha);
  }
`

const TARGET_REST = 0.32
const TARGET_PULSE = 1.0

export function VoiceFieldScene(): React.JSX.Element {
  const pointsRef = useRef<THREE.Points>(null)
  const ampRef = useRef(TARGET_REST)
  const targetRef = useRef(TARGET_REST)
  const decayRef = useRef(1)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(COUNT * 3)
    const sizes = new Float32Array(COUNT)
    const phases = new Float32Array(COUNT)
    const varies = new Float32Array(COUNT)

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * WIDTH
      positions[i * 3 + 1] = (Math.random() - 0.5) * HEIGHT
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6
      sizes[i] = 0.8 + Math.random() * 1.6
      phases[i] = Math.random() * Math.PI * 2
      varies[i] = 0.45 + Math.random() * 0.55
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geo.setAttribute('aVary', new THREE.BufferAttribute(varies, 1))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: TARGET_REST },
          uColorA: { value: new THREE.Color('#ff7a50') },
          uColorB: { value: new THREE.Color('#7d5df6') },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
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
    material.uniforms.uTime.value = t

    if (decayRef.current < 1) {
      decayRef.current = Math.min(1, decayRef.current + delta * 2.2)
      targetRef.current =
        TARGET_REST + (TARGET_PULSE - TARGET_REST) * Math.pow(1 - decayRef.current, 3)
    }
    ampRef.current += (targetRef.current - ampRef.current) * Math.min(1, delta * 4)
    material.uniforms.uAmp.value = ampRef.current

    if (pointsRef.current) {
      pointsRef.current.rotation.y +=
        (mouse.current.x * 0.12 - pointsRef.current.rotation.y) * delta * 2
      pointsRef.current.rotation.x +=
        (mouse.current.y * 0.06 - pointsRef.current.rotation.x) * delta * 2
    }
  })

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  )
}
