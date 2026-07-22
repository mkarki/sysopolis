import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera } from 'three';

/** Fit the orthographic zoom to the city radius whenever the layout changes. */
export function CameraRig({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    const viewport = Math.min(size.width, size.height);
    camera.zoom = Math.max(6, viewport / (radius * 1.8));
    camera.updateProjectionMatrix();
  }, [camera, radius, size.width, size.height]);

  return null;
}
