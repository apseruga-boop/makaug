const responsivePrefixes = ['', 'sm:', 'md:', 'lg:', 'xl:', '2xl:'];

const layoutSafelist = [
  'block',
  'hidden',
  'inline',
  'inline-block',
  'inline-flex',
  'flex',
  'inline-grid',
  'grid',
  'table',
  'contents',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'static',
  'inset-0',
  'top-0',
  'top-1/2',
  'top-16',
  'bottom-0',
  'left-0',
  'left-3',
  'left-3.5',
  'left-4',
  'right-0',
  'right-2',
  'z-10',
  'z-20',
  'z-30',
  'z-40',
  'z-50',
  'overflow-hidden',
  'overflow-visible',
  'overflow-y-auto',
  'overflow-x-auto',
  'object-cover',
  'object-contain',
  'aspect-video',
  'aspect-square',
  'sr-only',
  'line-clamp-1',
  'line-clamp-2',
  'line-clamp-3',
  'backdrop-blur',
  'backdrop-blur-xl',
  'transition',
  'transition-colors',
  'transition-all',
  'animate-pulse',
  '-translate-y-1/2',
  'translate-y-0',
  'scale-100'
];

for (const prefix of responsivePrefixes) {
  for (const display of ['block', 'hidden', 'flex', 'grid', 'inline-flex']) {
    if (prefix) layoutSafelist.push(`${prefix}${display}`);
  }
}

// Every file that writes class names into the page must be listed here, or
// its classes are missing from the build. The old colour × shade × variant
// safelist made tailwind.css 1.5 MB; with full content coverage it isn't
// needed. Class names are never assembled from pieces (no `bg-${colour}`), so
// a scan of whole strings finds them all.
module.exports = {
  content: [
    './index.html',
    './assets/*.js',
    './server.js',
    './config/**/*.js',
    './routes/**/*.js',
    './services/**/*.js',
    './utils/**/*.js',
    './packages/shared-country-core/**/*.{html,js}'
  ],
  safelist: [
    ...new Set(layoutSafelist),
    {
      pattern: /^(rounded|rounded-t|rounded-b|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-(sm|md|lg|xl|2xl|3xl|full)$/
    },
    {
      pattern: /^(grid-cols|sm:grid-cols|md:grid-cols|lg:grid-cols|xl:grid-cols)-(1|2|3|4|5|6|7|8|9|10|11|12)$/
    }
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        serif: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif']
      }
    }
  }
};
