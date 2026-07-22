import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { connectLive } from './live';
import { useStore } from './store';
import { City } from './scene/City';
import { Hud } from './ui/Hud';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';

export default function App() {
  const ir = useStore((s) => s.ir);
  const connection = useStore((s) => s.connection);

  useEffect(() => connectLive(), []);

  return (
    <div className="app">
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [80, 80, 80], zoom: 20, near: -1000, far: 2000 }}
      >
        <color attach="background" args={['#0a0d13']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[40, 70, 25]} intensity={1.35} />
        <directionalLight position={[-30, 40, -35]} intensity={0.35} color="#8fb3ff" />
        <City />
        <MapControls
          enableRotate={false}
          screenSpacePanning
          minZoom={5}
          maxZoom={140}
          zoomSpeed={1.2}
        />
      </Canvas>
      <Hud />
      <Legend />
      <Inspector />
      {!ir && (
        <div className="overlay">
          <div className="overlay-card">
            <h1>SYSOPOLIS</h1>
            <p>
              {connection === 'offline'
                ? 'Collector unreachable — start it with "npm run demo" (retrying…)'
                : 'Building the city…'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
