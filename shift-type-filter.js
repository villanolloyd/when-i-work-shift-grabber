(() => {
  const CARD_SELECTOR = "div.shift-card";
  const VALID_TYPES = new Set(["ondemand", "shrinkage", "review_agent", "triage_agent"]);
  const DEFAULT_TYPES = [...VALID_TYPES];
  const originalDisplay = new WeakMap();
  let selectedTypes = [...DEFAULT_TYPES];
  let filterReady = false;

  function normalizedText(card) {
    return (card?.innerText || card?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\s\u200b]+/g, " ")
      .trim()
      .toLowerCase();
  }

  // Return every recognized category on the card. Do not select only the first
  // match: a card mentioning multiple categories is allowed only if all of its
  // recognized categories are enabled.
  function detectTypes(card) {
    const text = normalizedText(card);
    const found = new Set();

    if (/\bon\s*[- ]?demand\b/.test(text)) found.add("ondemand");
    if (/\bshrinkage\b|\bshift\s*drop\b|\bshiftdrop\b/.test(text)) found.add("shrinkage");
    if (/\breview[_\s-]*agents?\b/.test(text)) found.add("review_agent");
    if (/\btriage[_\s-]*agents?\b/.test(text)) found.add("triage_agent");

    return found;
  }

  function isAllowed(card) {
    if (!filterReady || selectedTypes.length === 0) return false;
    const detected = detectTypes(card);
    if (detected.size === 0) return false;
    return [...detected].every(type => selectedTypes.includes(type));
  }

  function hide(card) {
    if (!originalDisplay.has(card)) {
      originalDisplay.set(card, {
        value: card.style.getPropertyValue("display"),
        priority: card.style.getPropertyPriority("display")
      });
    }
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

  function filterCard(card) {
    if (!(card instanceof Element) || !card.matches(CARD_SELECTOR)) return;
    if (isAllowed(card)) show(card);
    else hide(card);
  }

  function applyFilter(root = document) {
    if (root.matches?.(CARD_SELECTOR)) filterCard(root);
    root.querySelectorAll?.(CARD_SELECTOR).forEach(filterCard);
  }

  function loadFilter() {
    // Missing preference (first install) defaults to all categories. An explicitly
    // saved empty array remains empty and therefore safely allows no shift types.
    chrome.storage.local.get({ shiftTypes: DEFAULT_TYPES }, data => {
      const stored = Array.isArray(data.shiftTypes) ? data.shiftTypes : DEFAULT_TYPES;
      selectedTypes = stored.filter(type => VALID_TYPES.has(type));
      filterReady = true;
      applyFilter();
    });
  }

  chrome.storage.onChanged.addListener(changes => {
    if (changes.shiftTypes) loadFilter();
  });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target.parentElement;
      const containingCard = target?.closest?.(CARD_SELECTOR);
      if (containingCard) filterCard(containingCard);
      for (const node of record.addedNodes || []) {
        if (node.nodeType === Node.ELEMENT_NODE) applyFilter(node);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Final safeguard before the page's click handlers run.
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = target?.closest(`${CARD_SELECTOR} button, ${CARD_SELECTOR} .btn`);
    const card = button?.closest(CARD_SELECTOR);
    if (card && !isAllowed(card)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  loadFilter();
})();
