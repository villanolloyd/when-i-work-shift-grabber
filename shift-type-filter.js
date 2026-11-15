(() => {
  const CARD_SELECTOR = "div.shift-card";
  const VALID_TYPES = new Set(["ondemand", "shrinkage", "review_agent", "triage_agent"]);
  const originalDisplay = new WeakMap();
  let selectedTypes = [];
  let filterReady = false;

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function detectType(card) {
    const text = normalize(card?.innerText || card?.textContent);
    if (/\bon\s*[- ]?demand\b/.test(text)) return "ondemand";
    if (/\bshrinkage\b|\bshift\s*drop\b|\bshiftdrop\b/.test(text)) return "shrinkage";
    if (/\breview[_\s-]*agent\b/.test(text)) return "review_agent";
    if (/\btriage[_\s-]*agent\b/.test(text)) return "triage_agent";
    return "other";
  }

  function isAllowed(card) {
    // Fail closed: with no category selected, do not expose any cards to the grabber.
    return filterReady && selectedTypes.length > 0 && selectedTypes.includes(detectType(card));
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

  function applyFilter(root = document) {
    root.querySelectorAll?.(CARD_SELECTOR).forEach(card => {
      if (isAllowed(card)) show(card);
      else hide(card);
    });
  }

  function loadFilter() {
    chrome.storage.local.get({ shiftTypes: [], shiftTypeFilter: "all" }, data => {
      if (Array.isArray(data.shiftTypes)) {
        selectedTypes = data.shiftTypes.filter(type => VALID_TYPES.has(type));
      } else if (data.shiftTypeFilter === "shrinkage" || data.shiftTypeFilter === "ondemand") {
        selectedTypes = [data.shiftTypeFilter];
      } else {
        selectedTypes = [];
      }
      filterReady = true;
      applyFilter();
    });
  }

  chrome.storage.onChanged.addListener(changes => {
    if (changes.shiftTypes || changes.shiftTypeFilter) loadFilter();
  });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.(CARD_SELECTOR)) {
          if (isAllowed(node)) show(node);
          else hide(node);
        }
        applyFilter(node);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Backstop: even if another script attempts to click a filtered card, prevent the site action.
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
