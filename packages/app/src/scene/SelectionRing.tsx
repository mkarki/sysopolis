import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh } from 'three';
import type { CityLayout, IR } from '@sysopolis/core';
import { useStore } from '../store';
import { buildingDimensions } from './Buildings';

/** Pulsing ring under the selected building. */
export function SelectionRing({ ir, layout }: { ir: IR; layout: CityLayout }) {
  const selectedId = useStore((s) => s.selectedId);
  const ringRef = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const ring = ringRef.current;
    if (!ring) return;
    const pulse = 1 + 0.08 * Math.sin(clock.elapsedTime * 5);
    ring.scale.setScalar(pulse);
  });

  if (!selectedId) return null;
  const system = ir.systems.find((s) => s.id === selectedId);
  const pos = system && layout.positions[selectedId];
  if (!system || !pos) return null;
  const { side } = buildingDimensions(system.footprint, system.height);

  return (
    <mesh ref={ringRef} position={[pos.x, 0.12, pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[side * 0.75, side * 0.92, 48]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
    </mesh>
  );
}
