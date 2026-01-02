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

let _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const styleEl = document.createElement('style');
  styleEl.textContent = `
  .ui-panel{position:fixed;padding:12px;background:rgba(0,0,0,0.6);border-radius:8px;color:#fff;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;backdrop-filter:blur(8px)}
  .ui-header{margin:0 0 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.7}
  .ui-chip,.ui-button{padding:4px 10px;border:1px solid rgba(255,255,255,.3);border-radius:12px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:11px;font-weight:500;transition:all .2s;user-select:none}
  .ui-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .ui-divider{border-top:1px solid rgba(255,255,255,.15);margin:10px 0 8px 0}
  .ui-readout{font-size:12px;opacity:.9;margin-top:6px;text-align:center}
  input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:6px;background:transparent;outline:none;padding:0;margin:8px 0;touch-action:none}
  input[type=range]::-webkit-slider-runnable-track{width:100%;height:6px;background:rgba(255,255,255,.6)!important;border-radius:3px;cursor:pointer}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;background:#fff;border-radius:50%;cursor:pointer;border:2px solid rgba(0,0,0,.3);margin-top:-11px;position:relative}
  input[type=range]::-moz-range-track{width:100%;height:6px;background:rgba(255,255,255,.6);border-radius:3px;cursor:pointer}
  input[type=range]::-moz-range-thumb{width:28px;height:28px;background:#fff;border:2px solid rgba(0,0,0,.3);border-radius:50%;cursor:pointer}
  @media(pointer:fine){input[type=range]::-webkit-slider-thumb{width:20px;height:20px;margin-top:-7px}input[type=range]::-moz-range-thumb{width:20px;height:20px}}
  @media(max-width:480px){.ui-panel{left:8px!important;right:8px!important;bottom:8px!important;min-width:auto!important}}
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
    function addText(opts: UITextOpts) { const d = document.createElement('div'); d.textContent = opts.text; d.style.opacity='0.9'; d.style.fontSize='12px'; d.style.textAlign='center'; panel.appendChild(d); return d; }
    function addButton(opts: UIButtonOpts) { const b = document.createElement('button'); b.className='ui-button'; b.textContent = opts.label; b.addEventListener('click', opts.onClick); panel.appendChild(b); return b; }
    function addChip(opts: UIChipOpts) { const b = document.createElement('button'); b.className='ui-chip'; b.textContent = opts.label; const setActive=(on:boolean)=>{ b.style.background = on? 'rgba(29,185,84,0.3)':'rgba(255,255,255,0.1)'; b.style.borderColor = on? 'rgba(29,185,84,0.6)':'rgba(255,255,255,0.3)'; }; let active = !!opts.active; setActive(active); b.addEventListener('click',(e)=>{ if (opts.toggle){ active=!active; setActive(active); opts.onToggle?.(active);} opts.onClick?.(e); }); panel.appendChild(b); return b; }
    function addSlider(opts: UISliderOpts) {
      const root = document.createElement('div');
      const labelEl = opts.label ? document.createElement('div') : undefined;
      if (labelEl) { labelEl.className='ui-header'; labelEl.style.margin='10px 0 6px 0'; labelEl.textContent = opts.label!; root.appendChild(labelEl); }
      const input = document.createElement('input'); input.type='range'; input.min=`${opts.min}`; input.max=`${opts.max}`; input.step=`${opts.step ?? 1}`; if (opts.value !== undefined) input.value = `${opts.value}`; input.addEventListener('input', ()=>{ const v = parseFloat(input.value); opts.onInput?.(v); }); root.appendChild(input); panel.appendChild(root); return { root, input, labelEl };
    }
    function addProfiler(getRows: ()=>Array<{system:string; avgMs:number}>, onEnable: (on:boolean)=>void) {
      const chip = document.createElement('button'); chip.className='ui-chip'; chip.style.width='100%'; chip.textContent='⚡ Profiler';
      const pre = document.createElement('pre'); pre.style.margin='6px 0 0 0'; pre.style.padding='8px'; pre.style.background='rgba(0,0,0,0.4)'; pre.style.borderRadius='6px'; pre.style.maxHeight='140px'; pre.style.overflow='auto'; pre.style.display='none'; pre.style.fontSize='10px'; pre.style.lineHeight='1.4'; pre.style.fontFamily='monospace';
      panel.appendChild(chip); panel.appendChild(pre);
      let on = false; let timer: number | null = null;
      const set = (v:boolean)=>{ on=v; chip.style.background = on?'rgba(252,211,77,0.3)':'rgba(255,255,255,0.1)'; chip.style.borderColor = on?'rgba(252,211,77,0.6)':'rgba(255,255,255,0.3)'; pre.style.display = on?'block':'none'; onEnable(on); if (timer){ clearInterval(timer); timer=null; } if (on){ const refresh=()=>{ const rows=getRows(); pre.textContent = rows.map(r=>`${r.system.padEnd(12)} ${r.avgMs.toFixed(2)}ms`).join('\n') || 'No data...'; }; refresh(); timer = window.setInterval(refresh, 1000) as unknown as number; }};
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

