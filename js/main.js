// App shell entry point: wires up the hash router and the Library/Projects
// views. The wizard (js/app.js) self-initialises independently and just
// lives inside the "new-pattern" view section, shown/hidden by the router
// like every other view.

import { startRouter, onRoute } from './router.js';
import { renderLibrary } from './views/library.js';
import './views/projects.js'; // registers its own 'projects' route handler

onRoute('library', renderLibrary);

startRouter();
