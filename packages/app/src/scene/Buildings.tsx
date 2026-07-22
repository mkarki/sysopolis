import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, Color, InstancedMesh, Object3D } from 'three';
import { KIND_COLORS, type CityLayout, type IR } from '@sysopolis/core';
import { useStore } from '../store';

const EXITED_COLOR = new Color('#161a22');
const UNHEALTHY_COLOR = new Color('#f87171');
const STARTING_COLOR = new Color('#60a5fa');
const UNKNOWN_COLOR = new Color('#3a4150');

export function buildingDimensions(footprint: number, height: number): { side: number; h: number } {
  return { side: 0.7 + footprint * 1.1, h: 0.6 + height * 3.4 };
}

/**
 * All buildings in one InstancedMesh. Base transform is static per layout;
 * colors are re-computed every frame so status changes (and flicker/pulse
 * animations) hit the GPU without any React work.
 */
export function Buildings({ ir, layout }: { ir: IR; layout: CityLayout }) {
  const meshRef = useRef<InstancedMesh>(null);
  const select = useStore((s) => s.select);

  const systems = useMemo(
    () => ir.systems.filter((s) => layout.positions[s.id]),
    [ir, layout],
  );

  // Built once (not via onUpdate, which re-fires on every re-render and would
  // accumulate the translation): origin at the base so scaling Y grows upward.
  const boxGeometry = useMemo(() => {
    const g = new BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  useLayoutEffect(() => () => boxGeometry.dispose(), [boxGeometry]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new Object3D();
    systems.forEach((s, i) => {
      const pos = layout.positions[s.id];
      const { side, h } = buildingDimensions(s.footprint, s.height);
      dummy.position.set(pos.x, 0, pos.z);
      dummy.scale.set(side, h, side);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new Color(KIND_COLORS[s.kind]));
    });
    mesh.count = systems.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [systems, layout]);

  const tmpColor = useMemo(() => new Color(), []);
  const baseColors = useMemo(() => systems.map((s) => new Color(KIND_COLORS[s.kind])), [systems]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const metrics = useStore.getState().ir?.metrics ?? {};
    systems.forEach((s, i) => {
      const base = baseColors[i];
      switch (s.status) {
        case 'exited':
          tmpColor.copy(EXITED_COLOR);
          break;
        case 'unknown':
          tmpColor.copy(UNKNOWN_COLOR);
          break;
        case 'starting': {
          const pulse = 0.5 + 0.5 * Math.sin(t * 4 + i);
          tmpColor.copy(STARTING_COLOR).multiplyScalar(0.4 + 0.6 * pulse);
          break;
        }
        case 'unhealthy': {
          // Nervous flicker between its own color and alarm red.
          const flicker = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7) * Math.sin(t * 23 + i);
          tmpColor.copy(base).lerp(UNHEALTHY_COLOR, 0.35 + 0.55 * flicker);
          break;
        }
        default: {
          // Alive: brightness breathes slightly with CPU load.
          const cpu = metrics[s.id]?.cpu ?? 15;
          tmpColor.copy(base).multiplyScalar(0.62 + Math.min(0.55, cpu / 130));
        }
      }
      mesh.setColorAt(i, tmpColor);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    const system = systems[e.instanceId];
    if (system) select(system.id);
  };

  return (
    <instancedMesh
      ref={meshRef}
      geometry={boxGeometry}
      args={[undefined, undefined, Math.max(1, systems.length)]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
      castShadow
    >
      <meshStandardMaterial roughness={0.55} metalness={0.15} />
    </instancedMesh>
  );
}
