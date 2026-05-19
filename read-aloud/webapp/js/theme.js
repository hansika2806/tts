export const THEMES = [
  { id: 'theme-midnight', name: 'Midnight', icon: '🌙' },
  { id: 'theme-sepia', name: 'Sepia', icon: '📜' },
  { id: 'theme-light', name: 'Light', icon: '☀️' }
];

export function initThemeManager() {
  const savedTheme = localStorage.getItem('app-theme') || 'theme-midnight';
  applyTheme(savedTheme);

  // Expose for UI
  window.appThemeManager = {
    current: savedTheme,
    setTheme: (themeId) => {
      applyTheme(themeId);
      localStorage.setItem('app-theme', themeId);
      window.appThemeManager.current = themeId;
    },
    getThemes: () => THEMES
  };

  // Bind UI dropdown
  const select = document.getElementById('theme-select');
  if (select) {
    select.value = savedTheme;
    select.addEventListener('change', (e) => {
      window.appThemeManager.setTheme(e.target.value);
    });
  }
}

function applyTheme(themeId) {
  // Remove existing theme classes
  document.documentElement.classList.remove('theme-midnight', 'theme-sepia', 'theme-light');
  // Add new theme class
  document.documentElement.classList.add(themeId);
}
