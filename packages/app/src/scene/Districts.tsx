import { Html } from '@react-three/drei';
import type { CityLayout } from '@sysopolis/core';

/** District ground blocks + floating labels. */
export function Districts({ layout }: { layout: CityLayout }) {
  return (
    <group>
      {layout.districts.map((d) => (
        <group key={d.id} position={[d.center.x, 0, d.center.z]}>
          <mesh position={[0, 0.04, 0]} receiveShadow>
            <boxGeometry args={[d.w, 0.08, d.d]} />
            <meshStandardMaterial color={d.color} />
          </mesh>
          <Html
            position={[-d.w / 2 + 0.4, 0.2, -d.d / 2 + 0.2]}
            className="district-label"
            occlude={false}
            zIndexRange={[10, 0]}
          >
            <span>{d.label}</span>
          </Html>
        </group>
      ))}
    </group>
  );
}
