// Lightweight UI toolkit for in-engine overlays: panels, sliders, buttons, chips, and a profiler widget.
// Goals: minimal dependencies, reusable across demos, simple callback API.

export type UIPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export type UIButtonOpts = { id?: string; label: string; onClick: (ev: MouseEvent) => void };
export type UIChipOpts = { id?: string; label: string; active?: boolean; toggle?: boolean; onToggle?: (active: boolean) => void; onClick?: (ev: MouseEvent) => void };
export type UISliderOpts = { id?: string; label?: string; min: number; max: number; step?: number; value?: number; onInput?: (value: number) => void };
export type UITextOpts = { id?: string; text: string };

export interface UIPanel {
  el: HTMLDivElement;
  addHeader(text: string): HTMLDivElement;
  addDivider(): HTMLDivElement;
  addText(opts: UITextOpts): HTMLDivElement;
  addButton(opts: UIButtonOpts): HTMLButtonElement;
  addChip(opts: UIChipOpts): HTMLButtonElement;
  addSlider(opts: UISliderOpts): { root: HTMLDivElement; input: HTMLInputElement; labelEl?: HTMLDivElement };
  addProfiler(getRows: () => Array<{ system: string; avgMs: number }>, onEnable: (on: boolean) => void): { chip: HTMLButtonElement; panel: HTMLPreElement; set(on: boolean): void };
}

export interface UIManager {
  createPanel(opts?: { position?: UIPosition; title?: string; minWidth?: number; zIndex?: number }): UIPanel;
  destroy(): void;
}

// Catppuccin Mocha palette
const C = {
  base: '#1e1e2e',
  surface0: '#313244',
  surface1: '#45475a',
  surface2: '#585b70',
  overlay0: '#6c7086',
  text: '#cdd6f4',
  subtext0: '#a6adc8',
  subtext1: '#bac2de',
  blue: '#89b4fa',
  green: '#a6e3a1',
  peach: '#fab387',
  mauve: '#cba6f7',
};

let _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const styleEl = document.createElement('style');
  styleEl.textContent = `
  .ui-panel{position:fixed;padding:16px;background:${C.base}ee;border:1px solid ${C.surface1};border-radius:12px;color:${C.text};font:14px/1.5 'Inter',system-ui,-apple-system,sans-serif;backdrop-filter:blur(12px);box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:320px}
  .ui-header{margin:0 0 10px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${C.subtext0}}
  .ui-chip,.ui-button{padding:10px 16px;border:1px solid ${C.surface2};border-radius:10px;background:${C.surface0};color:${C.text};cursor:pointer;font-size:14px;font-weight:500;transition:all .15s ease;user-select:none;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
  .ui-chip:hover,.ui-button:hover{background:${C.surface1};border-color:${C.overlay0}}
  .ui-chip:active,.ui-button:active{transform:scale(0.97)}
  .ui-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .ui-row>.ui-chip{flex:1 1 auto;min-width:0;padding:8px 10px}
  .ui-divider{border:none;border-top:1px solid ${C.surface1};margin:14px 0}
  .ui-readout{font-size:13px;color:${C.subtext1};margin-top:10px;text-align:center}
  input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:8px;background:${C.surface1};border-radius:4px;outline:none;padding:0;margin:14px 0;touch-action:none}
  input[type=range]::-webkit-slider-runnable-track{width:100%;height:8px;background:${C.surface1};border-radius:4px;cursor:pointer}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;background:${C.text};border-radius:50%;cursor:pointer;border:none;margin-top:-10px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
  input[type=range]::-moz-range-track{width:100%;height:8px;background:${C.surface1};border-radius:4px;cursor:pointer}
  input[type=range]::-moz-range-thumb{width:28px;height:28px;background:${C.text};border:none;border-radius:50%;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}
  @media(pointer:coarse){
    input[type=range]::-webkit-slider-thumb{width:24px;height:24px;margin-top:-8px}
    input[type=range]::-moz-range-thumb{width:24px;height:24px}
    input[type=range]{height:6px;margin:10px 0}
    .ui-chip,.ui-button{min-height:32px;padding:6px 10px;font-size:12px}
    .ui-panel{padding:10px}
    .ui-header{margin:0 0 6px 0;font-size:9px}
    .ui-divider{margin:8px 0}
    .ui-row{gap:4px}
  }
  @media(max-width:480px){
    .ui-panel{max-width:calc(100vw - 24px)}
  }
  `;
  document.head.appendChild(styleEl);
}

export function createUI(root: HTMLElement | Document = document): UIManager {
  ensureCSS();
  const panels = new Set<HTMLDivElement>();

  function posToStyle(p: UIPosition, el: HTMLDivElement) {
    el.style.left = ''; el.style.right=''; el.style.top=''; el.style.bottom='';
    switch(p){
      case 'bottom-left': el.style.left='12px'; el.style.bottom='12px'; break;
      case 'bottom-right': el.style.right='12px'; el.style.bottom='12px'; break;
      case 'top-left': el.style.left='12px'; el.style.top='12px'; break;
      case 'top-right': el.style.right='12px'; el.style.top='12px'; break;
    }
  }

  function createPanel(opts?: { position?: UIPosition; title?: string; minWidth?: number; zIndex?: number }): UIPanel {
    const panel = document.createElement('div');
    panel.className = 'ui-panel';
    posToStyle(opts?.position ?? 'bottom-left', panel);
    panel.style.minWidth = `${opts?.minWidth ?? 240}px`;
    panel.style.zIndex = String(opts?.zIndex ?? 1000);
    const hdr = document.createElement('div');
    hdr.className = 'ui-header';
    if (opts?.title) hdr.textContent = opts.title;
    panel.appendChild(hdr);
    (root instanceof Document ? document.body : root).appendChild(panel);
    panels.add(panel);

    function addHeader(text: string) { const d = document.createElement('div'); d.className='ui-header'; d.textContent=text; panel.appendChild(d); return d; }
    function addDivider() { const d = document.createElement('div'); d.className='ui-divider'; panel.appendChild(d); return d; }
    function addText(opts: UITextOpts) { const d = document.createElement('div'); d.textContent = opts.text; d.style.color=C.subtext1; d.style.fontSize='12px'; d.style.textAlign='center'; panel.appendChild(d); return d; }
    function addButton(opts: UIButtonOpts) { const b = document.createElement('button'); b.className='ui-button'; b.textContent = opts.label; b.addEventListener('click', opts.onClick); panel.appendChild(b); return b; }
    function addChip(opts: UIChipOpts) { const b = document.createElement('button'); b.className='ui-chip'; b.textContent = opts.label; const setActive=(on:boolean)=>{ b.style.background = on? C.surface1 : C.surface0; b.style.borderColor = on? C.mauve : C.surface2; b.style.color = on? C.mauve : C.text; }; let active = !!opts.active; setActive(active); b.addEventListener('click',(e)=>{ if (opts.toggle){ active=!active; setActive(active); opts.onToggle?.(active);} opts.onClick?.(e); }); panel.appendChild(b); return b; }
    function addSlider(opts: UISliderOpts) {
      const root = document.createElement('div');
      const labelEl = opts.label ? document.createElement('div') : undefined;
      if (labelEl) { labelEl.className='ui-header'; labelEl.style.margin='10px 0 6px 0'; labelEl.textContent = opts.label!; root.appendChild(labelEl); }
      const input = document.createElement('input'); input.type='range'; input.min=`${opts.min}`; input.max=`${opts.max}`; input.step=`${opts.step ?? 1}`; if (opts.value !== undefined) input.value = `${opts.value}`; input.addEventListener('input', ()=>{ const v = parseFloat(input.value); opts.onInput?.(v); }); root.appendChild(input); panel.appendChild(root); return { root, input, labelEl };
    }
    function addProfiler(getRows: ()=>Array<{system:string; avgMs:number}>, onEnable: (on:boolean)=>void) {
      const chip = document.createElement('button'); chip.className='ui-chip'; chip.style.width='100%'; chip.textContent='Profiler';
      const pre = document.createElement('pre'); pre.style.margin='8px 0 0 0'; pre.style.padding='10px'; pre.style.background=C.surface0; pre.style.border=`1px solid ${C.surface1}`; pre.style.borderRadius='8px'; pre.style.maxHeight='140px'; pre.style.overflow='auto'; pre.style.display='none'; pre.style.fontSize='11px'; pre.style.lineHeight='1.5'; pre.style.fontFamily=`'JetBrains Mono','Fira Code',monospace`; pre.style.color=C.subtext1;
      panel.appendChild(chip); panel.appendChild(pre);
      let on = false; let timer: number | null = null;
      const set = (v:boolean)=>{ on=v; chip.style.background = on? C.surface1 : C.surface0; chip.style.borderColor = on? C.peach : C.surface2; chip.style.color = on? C.peach : C.text; pre.style.display = on?'block':'none'; onEnable(on); if (timer){ clearInterval(timer); timer=null; } if (on){ const refresh=()=>{ const rows=getRows(); pre.textContent = rows.map(r=>`${r.system.padEnd(12)} ${r.avgMs.toFixed(2)}ms`).join('\n') || 'No data...'; }; refresh(); timer = window.setInterval(refresh, 1000) as unknown as number; }};
      chip.addEventListener('click', (e)=>{ e.stopPropagation(); set(!on); });
      return { chip, panel: pre, set };
    }

    return { el: panel, addHeader, addDivider, addText, addButton, addChip, addSlider, addProfiler };
  }

  function destroy() {
    panels.forEach(p => p.remove()); panels.clear();
  }

  return { createPanel, destroy };
}

