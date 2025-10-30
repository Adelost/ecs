# ECS Solar System Demo

This project showcases a minimal ECS (Entity Component System) architecture, rendered with Three.js, featuring a stylized solar system.

Highlights
- Clean ECS world (`src/ecs/world.ts`) with cached queries and optional profiler
- Systems: orbit, rotation, rings, clouds, material baking, labels, render
- Imphenzia‑style palette baking and a realistic textured mode (toggle at runtime)
- Engine utilities: grid, lines, labels, and a reusable UI toolkit

Quick Start
- npm i
- npm run dev

Docs
- UI Toolkit: docs/UI.md
- Coordinates/Rotation: docs/COORDINATES_AND_ROTATION.md
- Cross-reference writeup: docs/CROSS_REF.md

UI Toolkit (engine.ui)
- The engine exposes a reusable overlay UI manager for panels, sliders, buttons, chips (toggle), and a profiler.
- See docs/UI.md for full API and usage examples.

License
- For internal/demo use. Do not redistribute textures without permission.
