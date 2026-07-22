import { useMemo } from 'react';
import { useStore } from '../store';
import { Districts } from './Districts';
import { Buildings } from './Buildings';
import { Roads } from './Roads';
import { Flows } from './Flows';
import { SelectionRing } from './SelectionRing';
import { CameraRig } from './CameraRig';

export function City() {
  const ir = useStore((s) => s.ir);
  const layout = useStore((s) => s.layout);

  const groundSize = useMemo(() => (layout ? layout.radius * 4 : 200), [layout]);

  if (!ir || !layout) return null;

  return (
    <group>
      <CameraRig radius={layout.radius} />
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} onPointerMissed={() => useStore.getState().select(null)}>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <Districts layout={layout} />
      <Roads layout={layout} />
      <Buildings ir={ir} layout={layout} />
      <Flows ir={ir} layout={layout} />
      <SelectionRing ir={ir} layout={layout} />
    </group>
  );
}
