// Minimal hash-based router for the top-level app shell (Home / New Pattern /
// Library / Designer / Projects). Each top-level view is a `.view` section in
// index.html with id `view-<route>`; the router just toggles visibility and
// calls a registered handler with any extra hash segments as params.

const handlers = new Map();
let currentRoute = 'home';

function parseHash() {
  const clean = location.hash.replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  return { route: parts[0] || 'home', params: parts.slice(1) };
}

function render() {
  const { route, params } = parseHash();
  currentRoute = route;

  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  const viewEl = document.getElementById(`view-${route}`) || document.getElementById('view-home');
  viewEl.classList.add('active');

  document.querySelectorAll('.main-nav [data-route]').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });

  const handler = handlers.get(route);
  if (handler) handler(params);

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/** Register a callback invoked whenever `route` becomes active. */
export function onRoute(route, handler) {
  handlers.set(route, handler);
}

export function getRoute() {
  return currentRoute;
}

/** Navigate to a route, e.g. navigate('projects/abc-123'). */
export function navigate(path) {
  const target = `#/${path}`;
  if (location.hash === target) {
    render();
  } else {
    location.hash = target;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
