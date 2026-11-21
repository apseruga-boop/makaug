'use strict';
(function () {
  var W = window.VibeCitySkinWindow;
  if (!W || !W.isVibeCitySkinActive({
    search: window.location.search,
    pathname: window.location.pathname
  })) return;

  var VERSION = '20261121';
  var base = '/assets/vibe-city-skin/';
  if (!document.querySelector('link[data-vibe-city-skin]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = base + 'vibe-city-skin.css?v=' + VERSION;
    link.setAttribute('data-vibe-city-skin', 'css');
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-vibe-city-skin]')) {
    var script = document.createElement('script');
    script.src = base + 'vibe-city-skin.js?v=' + VERSION;
    script.defer = true;
    script.setAttribute('data-vibe-city-skin', 'js');
    document.head.appendChild(script);
  }
})();
