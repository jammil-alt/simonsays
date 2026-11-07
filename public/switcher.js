/* App switcher (top right): Homework ⇄ Typing Arcade. A <details> dropdown, so it works without
   this script; this just closes it on an outside tap or Escape. */
(() => {
  const openOnes = () => document.querySelectorAll('details.switcher[open]');
  document.addEventListener('click', e => { openOnes().forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !openOnes().length) return;
    // Escape only closes the dropdown; don't let the game also treat it as pause/back.
    e.preventDefault(); e.stopPropagation();
    openOnes().forEach(d => { d.open = false; d.querySelector('summary')?.focus(); });
  }, true);
})();
