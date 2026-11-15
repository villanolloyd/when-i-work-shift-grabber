(() => {
  const CARD_SELECTOR = "div.shift-card";
  const VALID_TYPES = new Set(["ondemand", "shrinkage", "review_agent", "triage_agent"]);
  const DEFAULT_TYPES = [...VALID_TYPES];
  const originalDisplay = new WeakMap();
  let selectedTypes = [...DEFAULT_TYPES];
  let filterReady = false;

  function normalize(text) { return (text || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function detectType(card) {
    const text = normalize(card?.innerText || card?.textContent);
    if (/\bon\s*[- ]?demand\b/.test(text)) return "ondemand";
    if (/\bshrinkage\b|\bshift\s*drop\b|\bshiftdrop\b/.test(text)) return "shrinkage";
    if (/\breview[_\s-]*agents?\b/.test(text)) return "review_agent";
    if (/\btriage[_\s-]*agents?\b/.test(text)) return "triage_agent";
    return "other";
  }
  function isAllowed(card) { return filterReady && selectedTypes.includes(detectType(card)); }
  function hide(card) {
    if (!originalDisplay.has(card)) originalDisplay.set(card, { value: card.style.getPropertyValue("display"), priority: card.style.getPropertyPriority("display") });
    card.style.setProperty("display", "none", "important");
    card.dataset.whShiftTypeFiltered = "true";
  }
  function show(card) {
    const original = originalDisplay.get(card);
    if (original) {
      if (original.value) card.style.setProperty("display", original.value, original.priority);
      else card.style.removeProperty("display");
      originalDisplay.delete(card);
    }
    delete card.dataset.whShiftTypeFiltered;
  }
  function applyFilter(root = document) {
    root.querySelectorAll?.(CARD_SELECTOR).forEach(card => isAllowed(card) ? show(card) : hide(card));
  }
  function loadFilter() {
    chrome.storage.local.get({ shiftTypes: DEFAULT_TYPES, shiftTypeFilter: "all" }, data => {
      if (Array.isArray(data.shiftTypes)) {
        // Migrate old empty/missing filter state to all categories so available shifts remain visible.
        selectedTypes = data.shiftTypes.length ? data.shiftTypes.filter(type => VALID_TYPES.has(type)) : [...DEFAULT_TYPES];
      } else if (data.shiftTypeFilter === "shrinkage" || data.shiftTypeFilter === "ondemand") {
        selectedTypes = [data.shiftTypeFilter];
      } else {
        selectedTypes = [...DEFAULT_TYPES];
      }
      filterReady = true;
      applyFilter();
    });
  }
  chrome.storage.onChanged.addListener(changes => { if (changes.shiftTypes || changes.shiftTypeFilter) loadFilter(); });
  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches?.(CARD_SELECTOR)) isAllowed(node) ? show(node) : hide(node);
      applyFilter(node);
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = target?.closest(`${CARD_SELECTOR} button, ${CARD_SELECTOR} .btn`);
    const card = button?.closest(CARD_SELECTOR);
    if (card && !isAllowed(card)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  loadFilter();
})();
