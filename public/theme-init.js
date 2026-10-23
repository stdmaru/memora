const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = systemTheme
document.documentElement.style.colorScheme = systemTheme
