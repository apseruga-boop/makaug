const themeColors = [
  'amber',
  'blue',
  'cyan',
  'emerald',
  'fuchsia',
  'gray',
  'green',
  'indigo',
  'orange',
  'pink',
  'purple',
  'red',
  'sky',
  'slate',
  'violet',
  'white',
  'yellow'
];

const themeShades = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950'
];

const colourUtilityPrefixes = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'via',
  'to',
  'placeholder'
];

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

module.exports = {
  content: ['./index.html', './assets/makaug-app.js'],
  safelist: [
    ...new Set(layoutSafelist),
    {
      pattern: new RegExp(`^(${colourUtilityPrefixes.join('|')})-(${themeColors.filter((color) => color !== 'white').join('|')})-(${themeShades.join('|')})$`),
      variants: ['hover', 'focus', 'focus-visible', 'active', 'disabled', 'group-hover']
    },
    {
      pattern: /^(bg|text|border|ring)-(white|black)$/,
      variants: ['hover', 'focus', 'focus-visible', 'active', 'disabled', 'group-hover']
    },
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
