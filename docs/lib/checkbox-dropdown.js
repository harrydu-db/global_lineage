/**
 * Compact dropdown that looks like a single select but supports
 * multi-select via checkboxes in the panel.
 */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * @param {HTMLElement} container
 * @param {{ placeholder?: string, allLabel?: string, ariaLabel?: string }} [options]
 */
export function createCheckboxDropdown(container, options = {}) {
  const placeholder = options.placeholder || 'All';
  const allLabel = options.allLabel || 'All';
  const ariaLabel = options.ariaLabel || '';
  const ALL_VALUE = '__all__';

  /** @type {string[]} */
  let items = [];
  /** @type {Set<string>} */
  let selected = new Set();
  /** @type {((values: string[]) => void) | null} */
  let onChangeFn = null;

  container.innerHTML = `
    <div class="stats-checkbox-dropdown">
      <button type="button" class="stats-checkbox-dropdown-trigger stats-filter-select" aria-haspopup="listbox" aria-expanded="false">
        <span class="stats-checkbox-dropdown-label"></span>
      </button>
      <div class="stats-checkbox-dropdown-panel" hidden role="listbox" aria-multiselectable="true"></div>
    </div>
  `;

  const dropdown = container.querySelector('.stats-checkbox-dropdown');
  const trigger = /** @type {HTMLButtonElement} */ (container.querySelector('.stats-checkbox-dropdown-trigger'));
  const labelEl = container.querySelector('.stats-checkbox-dropdown-label');
  const panel = container.querySelector('.stats-checkbox-dropdown-panel');

  if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);

  function getSelected() {
    return [...selected];
  }

  function isAllSelected() {
    return items.length > 0 && selected.size === items.length;
  }

  function selectAll() {
    selected = new Set(items);
  }

  function selectNone() {
    selected.clear();
  }

  function updateTriggerLabel() {
    if (!items.length || isAllSelected()) {
      labelEl.textContent = placeholder;
      return;
    }
    const vals = getSelected();
    if (vals.length === 1) {
      labelEl.textContent = vals[0];
    } else {
      labelEl.textContent = `${vals.length} selected`;
    }
  }

  function renderPanel() {
    if (!panel) return;
    const allChecked = isAllSelected();
    const someSelected = selected.size > 0 && selected.size < items.length;
    const allRow = `
      <label class="stats-checkbox-dropdown-item stats-checkbox-dropdown-item--all">
        <input type="checkbox" value="${ALL_VALUE}"${allChecked ? ' checked' : ''} />
        <span>${escapeHtml(allLabel)}</span>
      </label>
    `;
    const itemRows = items.map((value) => `
      <label class="stats-checkbox-dropdown-item">
        <input type="checkbox" value="${escapeAttr(value)}"${selected.has(value) ? ' checked' : ''} />
        <span>${escapeHtml(value)}</span>
      </label>
    `).join('');
    panel.innerHTML = allRow + itemRows;
    const allCb = /** @type {HTMLInputElement | null} */ (panel.querySelector(`input[value="${ALL_VALUE}"]`));
    if (allCb) allCb.indeterminate = someSelected;
  }

  // The dropdown never allows an empty selection — that state is
  // ambiguous (does it mean "no filter" or "no rows"?). Whenever a
  // caller tries to end up with nothing selected, we fall back to
  // "all selected", which is our "no filter" state.
  function normalizeSelection() {
    if (items.length > 0 && selected.size === 0) selectAll();
  }

  function setSelected(values) {
    selected = new Set(
      (Array.isArray(values) ? values : [])
        .filter((v) => v != null && v !== '' && items.includes(v))
    );
    normalizeSelection();
    renderPanel();
    updateTriggerLabel();
  }

  /** @param {string[]} values */
  function setOptions(values) {
    items = [...values];
    selected = new Set([...selected].filter((v) => items.includes(v)));
    normalizeSelection();
    renderPanel();
    updateTriggerLabel();
  }

  function open() {
    if (!panel) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.classList.add('stats-checkbox-dropdown--open');
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('stats-checkbox-dropdown--open');
  }

  function toggle() {
    if (panel?.hidden) open();
    else close();
  }

  function onDocClick(e) {
    if (!dropdown.contains(/** @type {Node} */ (e.target))) close();
  }

  function onDocKeydown(e) {
    if (e.key === 'Escape') close();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  panel?.addEventListener('change', (e) => {
    const cb = /** @type {HTMLInputElement | null} */ (e.target.closest('input[type="checkbox"]'));
    if (!cb) return;
    if (cb.value === ALL_VALUE) {
      // The "All" row is a select-all action. Clicking it — whether it was
      // checked or unchecked — always resolves to "select every item".
      // There's no useful "select none" state (see normalizeSelection).
      selectAll();
      renderPanel();
      updateTriggerLabel();
      if (onChangeFn) onChangeFn(getSelected());
      return;
    }
    if (cb.checked) selected.add(cb.value);
    else selected.delete(cb.value);
    normalizeSelection();
    renderPanel();
    updateTriggerLabel();
    if (onChangeFn) onChangeFn(getSelected());
  });

  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKeydown);

  updateTriggerLabel();

  return {
    getSelected,
    setSelected,
    setOptions,
    selectAll,
    selectNone,
    isAllSelected,
    onChange(fn) {
      onChangeFn = fn;
    },
    destroy() {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKeydown);
      container.innerHTML = '';
    },
  };
}
