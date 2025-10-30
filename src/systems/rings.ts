import { Mesh, Quaternion, Vector3 } from 'three';

export type RingChild = { mesh: Mesh; qEq: Quaternion };

export type RingHost = {
  baseQuat?: Quaternion;
  spinAxis?: Vector3;
  ringsWorld?: RingChild[];
  ringsSpinRate?: number;   // rotations per second
  ringsSpinAngle?: number;  // radians, accumulated
};

// Update ring orientation for a single host (planet).
// Rings live in the host's local space (usually the non-rotating group).
// They should tilt with the axis (baseQuat) and optionally spin slowly around it.
export function updateRingsForHost(host: RingHost, dt: number) {
  if (!host.ringsWorld || !host.baseQuat) return;
  // Accumulate optional spin (separate from planet daily spin)
  const rate = host.ringsSpinRate ?? 0; // rotations per second
  host.ringsSpinAngle = (host.ringsSpinAngle ?? 0) + rate * dt * Math.PI * 2;
  let qSpinWorld: Quaternion | null = null;
  if ((host.ringsSpinAngle ?? 0) !== 0 && host.spinAxis) {
    qSpinWorld = new Quaternion().setFromAxisAngle(host.spinAxis.clone().normalize(), host.ringsSpinAngle!);
  }
  host.ringsWorld.forEach(r => {
    // base orientation: equatorial plane relative to axis
    const baseEq = new Quaternion().multiplyQuaternions(host.baseQuat as Quaternion, r.qEq);
    if (qSpinWorld) r.mesh.quaternion.multiplyQuaternions(qSpinWorld, baseEq);
    else r.mesh.quaternion.copy(baseEq);
  });
}

export function updateRingsForAll(hosts: RingHost[], dt: number) {
  hosts.forEach(h => updateRingsForHost(h, dt));
}

