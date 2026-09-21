const darkWalletSelectorCss = `
  .modal-container { background: rgba(0, 0, 0, 0.68) !important; }
  .modal-body {
    background: #101514 !important;
    color: #98a29f !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55) !important;
  }
  .modal-body > div > div:first-child > div:first-child,
  .modal-body li div { color: #f4f7f6 !important; }
  .modal-body li {
    position: relative !important;
    aspect-ratio: 1 / 1 !important;
    flex-direction: column !important;
    justify-content: center !important;
    gap: 12px !important;
    padding: 18px 12px !important;
    background: #151b1a !important;
    border-color: rgba(255, 255, 255, 0.12) !important;
    cursor: pointer !important;
    transition: border-color 150ms ease, background 150ms ease, transform 150ms ease !important;
  }
  .modal-body li:hover {
    background: #19221f !important;
    border-color: rgba(110, 231, 183, 0.42) !important;
    transform: translateY(-2px) !important;
  }
  .modal-body ul {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 12px !important;
  }
  .modal-body ul > li { margin: 0 !important; }
  .modal-body li > div:first-child {
    width: 56px !important;
    height: 56px !important;
    flex-basis: 56px !important;
  }
  .modal-body li > div:nth-child(2) {
    flex: none !important;
    text-align: center !important;
  }
  .modal-body li > div:nth-child(2) > div {
    font-size: 13px !important;
    line-height: 1.25 !important;
  }
  .modal-body li > div:nth-child(2) > a { display: none !important; }
  .modal-body li > button,
  .modal-body li > a:last-child {
    position: absolute !important;
    inset: 0 !important;
    z-index: 2 !important;
    width: 100% !important;
    height: 100% !important;
    padding: 0 !important;
    border: 0 !important;
    opacity: 0 !important;
  }
  .modal-body li:has(> button:focus-visible),
  .modal-body li:has(> a:last-child:focus-visible) {
    outline: 2px solid #6ee7b7 !important;
    outline-offset: 2px !important;
  }
  .modal-body a { color: #6ee7b7 !important; }
  .modal-body > div > div:first-child button:hover { background: rgba(255, 255, 255, 0.08) !important; }
  .modal-body > div > div:first-child button img { filter: invert(1); }
`;

export function enableDarkStacksWalletSelector(): () => void {
  const applyTheme = (modal: Element): boolean => {
    const shadowRoot = modal.shadowRoot;
    if (!shadowRoot) return false;
    if (shadowRoot.querySelector('[data-ossr-dark-theme]')) return true;
    const style = document.createElement('style');
    style.dataset.ossrDarkTheme = 'true';
    style.textContent = darkWalletSelectorCss;
    shadowRoot.appendChild(style);
    return true;
  };

  const existing = document.querySelector('connect-modal');
  if (existing && applyTheme(existing)) return () => undefined;

  const observer = new MutationObserver(() => {
    const modal = document.querySelector('connect-modal');
    if (modal && applyTheme(modal)) observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
  const timeout = window.setTimeout(() => observer.disconnect(), 5_000);
  return () => {
    window.clearTimeout(timeout);
    observer.disconnect();
  };
}
