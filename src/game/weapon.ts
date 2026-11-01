import * as THREE from 'three'

/** A restrained, non-cartoon USP silhouette built from matte metal and polymer parts. */
export function createUSP(): THREE.Group {
  const group = new THREE.Group()
  const metal = new THREE.MeshStandardMaterial({ color: '#252827', roughness: 0.62, metalness: 0.78 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#111413', roughness: 0.72, metalness: 0.66 })
  const polymer = new THREE.MeshStandardMaterial({ color: '#181b1a', roughness: 0.94, metalness: 0.08 })
  const brass = new THREE.MeshStandardMaterial({ color: '#a07c45', roughness: 0.42, metalness: 0.65 })

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.92), metal)
  slide.position.z = -0.18
  slide.castShadow = true
  group.add(slide)

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.7), darkMetal)
  frame.position.set(0, -0.08, 0.02)
  frame.castShadow = true
  group.add(frame)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.48, 0.22), polymer)
  grip.position.set(0, -0.32, 0.24)
  grip.rotation.x = -0.16
  grip.castShadow = true
  group.add(grip)

  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), metal)
  triggerGuard.rotation.set(Math.PI / 2, 0, 0)
  triggerGuard.position.set(0, -0.13, 0.13)
  group.add(triggerGuard)

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.025), brass)
  trigger.position.set(0, -0.13, 0.13)
  trigger.rotation.x = -0.2
  group.add(trigger)

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.07), darkMetal)
  sight.position.set(0, 0.1, -0.56)
  group.add(sight)

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), darkMetal)
  muzzle.rotation.x = Math.PI / 2
  muzzle.position.z = -0.66
  group.add(muzzle)

  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  return group
}

export function createMuzzleFlash(): THREE.Mesh {
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.28, 8),
    new THREE.MeshBasicMaterial({ color: '#e3b66b', transparent: true, opacity: 0.92 }),
  )
  flash.rotation.x = -Math.PI / 2
  flash.visible = false
  return flash
}
