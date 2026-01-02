Engine UI Toolkit
=================

Overview
- The engine exposes a lightweight UI toolkit for building overlay controls without any framework.
- Controls are created via panels that you can position on screen. Each panel supports headers, dividers, text, buttons, toggle chips, sliders, and a reusable profiler widget.
- Everything is plain DOM with a small, self-injected stylesheet; no runtime allocations in hot loops and easy teardown.

Entry Point
- `engine.ui: UIManager`
- File: `src/ui.ts`

UIManager API
- `createPanel(opts?): UIPanel`
  - `opts.position`: `'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'` (default `'bottom-left'`)
  - `opts.title`: optional panel title (string)
  - `opts.minWidth`: pixels (default 240)
  - `opts.zIndex`: integer (default 1000)
- `destroy()`: removes all panels and CSS (called automatically by `engine.dispose()`).

UIPanel API
- `el: HTMLDivElement` – panel root element (for custom layout if needed)
- `addHeader(text)` → `HTMLDivElement`
- `addDivider()` → `HTMLDivElement`
- `addText({ text })` → `HTMLDivElement`
- `addButton({ label, onClick })` → `HTMLButtonElement`
- `addChip({ label, toggle?, onToggle?, onClick? })` → `HTMLButtonElement`
  - If `toggle` is true, the chip toggles its active style and calls `onToggle(active)`.
- `addSlider({ min, max, step?, value?, onInput? })` → `{ root, input, labelEl? }`
  - `input` is the actual `<input type="range">`; add `'input'` listener for live updates.
- `addProfiler(getRows, onEnable)` → `{ chip, panel, set }`
  - `getRows()` returns array of `{ system: string, avgMs: number }`.
  - `onEnable(boolean)` toggles your profiler (e.g., `world.enableProfiler(on)`).
  - `set(on)` programmatically opens/closes the profiler widget.

Engine Integration
- `engine.ts` constructs the UI manager and exposes it on the `Engine` instance:
  - `const ui = createUI(document);`
  - `return { ..., ui, ... }`
- `engine.dispose()` calls `ui.destroy()` to remove panels and CSS.

Example: Basic Controls
```ts
// In your scene bootstrap:
const panel = engine.ui.createPanel({ position: 'top-right', title: 'Controls', minWidth: 260 });

// Text label
panel.addText({ text: 'Demo controls' });

// Toggle chip
panel.addChip({ label: 'Pause', toggle: true, onToggle: on => world.setPaused?.(on) });

// Slider
panel.addHeader('Speed');
const speed = panel.addSlider({ min: 0.5, max: 3, step: 0.1, value: 1.0, onInput: v => game.setSpeed(v) });

// Button
panel.addButton({ label: 'Reset', onClick: () => game.reset() });

// Profiler
panel.addProfiler(
  () => world.getProfilerSnapshot().map(r => ({ system: r.system, avgMs: r.avgMs })),
  on => world.enableProfiler(on)
);
```

Example: Time Controls (from Solar System)
- File: `src/solarSystem.ts` → `setupControls(...)`
- Demonstrates:
  - A main panel with title
  - Time speed slider + preset chips + reverse chip
  - Style toggle chips (Textured vs Low‑poly)
  - Detail slider with triangles readout
  - Profiler widget wired to the ECS world

Styling
- The toolkit injects a small CSS block once per page. If you need custom themes, swap colors in the stylesheet or add your own classes to `panel.el`.

Teardown
- All panels are removed by `engine.dispose()` automatically. You can also call `engine.ui.destroy()` directly if needed.

