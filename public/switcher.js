/* App switcher (top right): Homework · Typing Arcade · Comic Maker.
   Pages hold an empty <details class="switcher" data-current="homework|arcade|comic"> and this fills it in.
   data-summary-class adds classes to the button (the arcade uses its pixel button style). */
(() => {
  const APPS = [
    { id: 'homework', href: '/', name: 'Homework', note: 'Worksheets to type on' },
    { id: 'arcade', href: '/games/', name: 'Typing Arcade', note: 'Letter Lane · Meteor Words' },
    { id: 'comic', href: '/comic/', name: 'Comic Maker', note: 'Type a story, get a comic' },
  ];
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  for (const d of document.querySelectorAll('details.switcher')) {
    const cur = APPS.find(a => a.id === d.dataset.current) || APPS[0];
    const label = d.dataset.upper ? cur.name.toUpperCase() : cur.name;
    d.innerHTML = `<summary class="${d.dataset.summaryClass || ''}" aria-label="Switch app (now: ${cur.name})"><span>${label}</span>${CHEV}</summary>
      <nav class="switcher-menu">${APPS.map(a => `<a href="${a.href}"${a === cur ? ' aria-current="page"' : ''}><b>${a.name}</b><small>${a.note}</small></a>`).join('')}</nav>`;
  }
  const openOnes = () => document.querySelectorAll('details.switcher[open]');
  document.addEventListener('click', e => { openOnes().forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !openOnes().length) return;
    // Escape only closes the dropdown; don't let a game also treat it as pause/back.
    e.preventDefault(); e.stopPropagation();
    openOnes().forEach(d => { d.open = false; d.querySelector('summary')?.focus(); });
  }, true);
})();
