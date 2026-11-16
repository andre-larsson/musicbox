// One effect at a time, with the chain's summaries acting as keyboard-accessible tabs.
export function createEffectTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => root.querySelector('#' + tab.getAttribute('aria-controls')));

  function select(stage, focus = false) {
    const index = tabs.findIndex(tab => tab.dataset.stage === stage);
    if (index < 0) return;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus({ preventScroll: true });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab.dataset.stage));
    tab.addEventListener('keydown', event => {
      const index = { ArrowLeft: (i + tabs.length - 1) % tabs.length, ArrowRight: (i + 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
      if (index == null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      select(tabs[index].dataset.stage, true);
    });
  });

  // A keyboard-focused control must stay below the pinned graph as the page scrolls.
  const monitor = root.querySelector('.master-monitor');
  root.querySelector('.master-controls').addEventListener('focusin', event => {
    const control = event.target.getBoundingClientRect();
    const graph = monitor.getBoundingClientRect();
    const overlaps = control.left < graph.right && control.right > graph.left;
    if (overlaps && graph.top >= 0 && control.top < graph.bottom + 8) window.scrollBy(0, control.top - graph.bottom - 8);
  });

  select(tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.stage || tabs[0].dataset.stage);
  return { select };
}
