import { useMemo } from 'react';
import type { CityLayout, Road } from '@sysopolis/core';

const ROAD_COLORS: Record<Road['kind'], string> = {
  intra: '#232a3a',
  inter: '#2d3650',
  ring: '#28304a',
};

function RoadMesh({ road }: { road: Road }) {
  const { midX, midZ, length, angle, width } = useMemo(() => {
    const dx = road.to.x - road.from.x;
    const dz = road.to.z - road.from.z;
    return {
      midX: (road.from.x + road.to.x) / 2,
      midZ: (road.from.z + road.to.z) / 2,
      length: Math.hypot(dx, dz),
      angle: Math.atan2(dx, dz),
      width: road.kind === 'inter' ? 0.3 : 0.16,
    };
  }, [road]);

  if (length < 0.01) return null;
  return (
    <mesh position={[midX, 0.09, midZ]} rotation={[0, angle, 0]}>
      <boxGeometry args={[width, 0.02, length]} />
      <meshStandardMaterial color={ROAD_COLORS[road.kind]} />
    </mesh>
  );
}

/** Static road geometry — traffic lives in <Flows/>. */
export function Roads({ layout }: { layout: CityLayout }) {
  return (
    <group>
      {layout.roads.map((road) => (
        <RoadMesh key={road.id} road={road} />
      ))}
    </group>
  );
}
