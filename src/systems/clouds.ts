import { Mesh, Quaternion, Vector3 } from 'three';

export type CloudChild = { mesh: Mesh; driftRate: number; driftAngle: number };

export type CloudHost = {
  // Clouds are local children of the planet mesh and inherit the planet's base orientation.
  // We only apply an extra local +Y drift here.
  cloudsWorld?: CloudChild[];
};

export function updateCloudsForHost(host: CloudHost, dt: number) {
  if (!host.cloudsWorld || host.cloudsWorld.length === 0) return;
  host.cloudsWorld.forEach(c => {
    if (!c.driftRate) return;
    c.driftAngle = (c.driftAngle + c.driftRate * dt * Math.PI * 2) % (Math.PI * 2);
    // Local +Y rotation for gentle drift; parent provides the axis tilt.
    c.mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), c.driftAngle);
  });
}

export function updateCloudsForAll(hosts: CloudHost[], dt: number) {
  hosts.forEach(h => updateCloudsForHost(h, dt));
}

