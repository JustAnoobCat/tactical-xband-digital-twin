/**
 * Strictly CSP-compliant external entry script for standalone Research & Mathematical
 * Reference documentation (`docs.html`).
 *
 * Works 100% offline in both browser popup windows and Tauri v2 secondary WebviewWindow.
 * Zero inline scripts, zero inline event attributes, zero external network dependencies.
 */

function initDocsWindow(): void {
  const filterInput = document.getElementById('docs-filter-input') as HTMLInputElement | null;
  const filterCount = document.getElementById('docs-filter-count');
  const clearBtn = document.getElementById('btn-docs-clear-filter');
  const printBtn = document.getElementById('btn-docs-print');
  const topBtn = document.getElementById('btn-docs-top');
  const tocLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('.docs-toc-link[href^="#"]')
  );
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.docs-main .report-section[id]'));

  const setActiveToc = (activeId: string): void => {
    for (const link of tocLinks) {
      const targetId = link.getAttribute('href')?.slice(1) ?? '';
      const isMatch = targetId === activeId;
      link.classList.toggle('is-active', isMatch);
      if (isMatch) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  const applyFilter = (): void => {
    const query = (filterInput?.value ?? '').trim().toLowerCase();
    let visibleCount = 0;
    let firstVisibleId = '';

    for (const section of sections) {
      const haystack = (section.textContent ?? '').toLowerCase();
      const matched = query.length === 0 || haystack.includes(query);
      section.classList.toggle('is-hidden-by-filter', !matched);
      if (matched) {
        visibleCount++;
        if (!firstVisibleId) firstVisibleId = section.id;
      }
    }

    for (const link of tocLinks) {
      const targetId = link.getAttribute('href')?.slice(1) ?? '';
      const targetSec = targetId ? document.getElementById(targetId) : null;
      const hidden = Boolean(targetSec?.classList.contains('is-hidden-by-filter'));
      link.style.display = hidden ? 'none' : 'block';
    }

    if (filterCount) {
      filterCount.textContent = `${visibleCount} / ${sections.length} sections`;
    }
    if (clearBtn) {
      clearBtn.hidden = query.length === 0;
    }
    if (firstVisibleId) {
      setActiveToc(firstVisibleId);
    }
  };

  for (const link of tocLinks) {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const target = document.getElementById(href.slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveToc(target.id);
      if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        history.replaceState(null, '', href);
      }
    });
  }

  filterInput?.addEventListener('input', applyFilter);

  clearBtn?.addEventListener('click', () => {
    if (filterInput) {
      filterInput.value = '';
      applyFilter();
      filterInput.focus();
    }
  });

  printBtn?.addEventListener('click', () => {
    window.print();
  });

  topBtn?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (sections[0]?.id) setActiveToc(sections[0].id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== filterInput) {
      event.preventDefault();
      filterInput?.focus();
      filterInput?.select();
    } else if (event.key === 'Escape' && filterInput && filterInput.value.length > 0) {
      filterInput.value = '';
      applyFilter();
    }
  });

  if (typeof IntersectionObserver !== 'undefined' && sections.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveToc((entry.target as HTMLElement).id);
            break;
          }
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0.05 }
    );
    for (const sec of sections) {
      observer.observe(sec);
    }
  }

  applyFilter();
  if (window.location.hash && window.location.hash.length > 1) {
    const hashId = window.location.hash.slice(1);
    const target = document.getElementById(hashId);
    if (target) {
      setActiveToc(hashId);
      target.scrollIntoView({ block: 'start' });
    }
  } else if (sections[0]?.id) {
    setActiveToc(sections[0].id);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocsWindow);
} else {
  initDocsWindow();
}
