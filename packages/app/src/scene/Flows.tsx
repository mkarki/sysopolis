import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points } from 'three';
import type { CityLayout, IR, Road, SystemStatus } from '@sysopolis/core';
import { useStore } from '../store';

const FLOW_COLORS: Record<Road['kind'], Color> = {
  inter: new Color('#ffd166'),
  intra: new Color('#67e8f9'),
  ring: new Color('#8b9cf7'),
};

interface Particle {
  roadIndex: number;
  offset: number;
  speed: number;
}

function isAlive(status: SystemStatus | undefined): boolean {
  return status === 'running' || status === 'unhealthy' || status === 'starting';
}

/**
 * Traffic = light particles flowing along roads.
 * - synthetic mode: link weights are exact → roads glow precisely
 * - docker mode: a system's netOutBps is split across its outgoing roads
 *   ("a busy building lights up the roads leaving it")
 * - an exited endpoint kills the flow, both-running gets a baseline pulse
 */
export function Flows({ ir, layout }: { ir: IR; layout: CityLayout }) {
  const pointsRef = useRef<Points>(null);

  const { geometry, particles } = useMemo(() => {
    const particles: Particle[] = [];
    layout.roads.forEach((road, roadIndex) => {
      const count = 2 + Math.round(road.baseWeight * 8);
      for (let i = 0; i < count; i++) {
        particles.push({
          roadIndex,
          offset: (i / count + roadIndex * 0.137) % 1,
          speed: 0.18 + road.baseWeight * 0.5,
        });
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(particles.length * 3), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(particles.length * 3), 3));
    return { geometry, particles };
  }, [layout]);

  const districtMembers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of ir.systems) {
      const members = map.get(s.districtId) ?? [];
      members.push(s.id);
      map.set(s.districtId, members);
    }
    return map;
  }, [ir]);

  const statusById = useMemo(() => new Map(ir.systems.map((s) => [s.id, s])), [ir]);
  const tmpColor = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const t = clock.elapsedTime;
    const metrics = useStore.getState().ir?.metrics ?? {};
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const colors = geometry.getAttribute('color') as BufferAttribute;

    // Per-road live intensity, computed once per frame.
    const intensities = layout.roads.map((road) => {
      if (road.kind === 'ring') {
        const members = districtMembers.get(road.districtId ?? '') ?? [];
        if (members.length === 0) return 0;
        const alive = members.filter((id) => isAlive(statusById.get(id)?.status)).length;
        return road.baseWeight * (alive / members.length);
      }
      const source = statusById.get(road.source ?? '');
      const target = statusById.get(road.target ?? '');
      if (!isAlive(source?.status) || !isAlive(target?.status)) return 0;
      const outDeg = layout.outDegree[road.source ?? ''] || 1;
      const perLinkBps = (metrics[road.source ?? '']?.netOutBps ?? 0) / outDeg;
      const boost = Math.min(1, Math.log10(1 + perLinkBps) / 6);
      let intensity = Math.min(1, 0.15 + 0.45 * road.baseWeight + 0.5 * boost);
      if (source?.status === 'unhealthy' || target?.status === 'unhealthy') intensity *= 0.45;
      return intensity;
    });

    particles.forEach((p, i) => {
      const road = layout.roads[p.roadIndex];
      const intensity = intensities[p.roadIndex];
      if (intensity <= 0.01) {
        positions.setXYZ(i, 0, -100, 0); // parked below ground — the outage is *visible*
        colors.setXYZ(i, 0, 0, 0);
        return;
      }
      const progress = (t * p.speed * (0.5 + intensity) + p.offset) % 1;
      const x = road.from.x + (road.to.x - road.from.x) * progress;
      const z = road.from.z + (road.to.z - road.from.z) * progress;
      positions.setXYZ(i, x, 0.22 + 0.06 * Math.sin(t * 3 + i), z);
      tmpColor.copy(FLOW_COLORS[road.kind]).multiplyScalar(0.25 + intensity);
      colors.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={4}
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        sizeAttenuation={false}
      />
    </points>
  );
}
