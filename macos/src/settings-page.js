// The Settings window: the server's command, library, engine and port, each with where its value
// came from when it is not set here, and the app's own switches. It reaches the app only through
// `window.carrelApp` (settings-preload.cjs).

const api = window.carrelApp;
const fields = [...document.querySelectorAll('[data-field]')];
let home = '';
// A field's save, which Apply waits for.
let saving = Promise.resolve();

const short = (path) => (home && path?.startsWith(home) ? `~${path.slice(home.length)}` : path);

function draw(state) {
  home = state.home;
  for (const input of fields) {
    const key = input.dataset.field;
    const set = state.settings[key];
    if (document.activeElement !== input) input.value = key === 'port' ? (set > 0 ? String(set) : '') : set;
    const found = state.found[key];
    input.placeholder = found.value ? short(String(found.value)) : (input.dataset.missing ?? 'Not found');
    const source = document.querySelector(`[data-source="${key}"]`);
    source.textContent = found.source && found.source !== 'set here' ? found.source : '';
  }
  document.getElementById('status').textContent = state.status;
  document.getElementById('menu-bar').checked = state.settings.showInMenuBar;
  const login = document.getElementById('login');
  login.checked = state.openAtLogin;
  login.disabled = !state.canOpenAtLogin;
  document.getElementById('login-hint').textContent = state.canOpenAtLogin ? '' : '(only for the built app)';
}

for (const input of fields) {
  input.addEventListener('change', () => {
    const key = input.dataset.field;
    const value = key === 'port' ? Number.parseInt(input.value.replace(/\D/g, ''), 10) || 0 : input.value;
    saving = api.set({ [key]: value }).then(draw);
  });
}

for (const button of document.querySelectorAll('[data-choose]')) {
  button.addEventListener('click', async () => {
    const path = await api.choose(button.hasAttribute('data-folders'));
    if (path) draw(await api.set({ [button.dataset.choose]: path }));
  });
}

document.getElementById('apply').addEventListener('click', async () => {
  // A field still being typed in is saved first.
  document.activeElement?.blur();
  await saving;
  draw(await api.apply());
});
document.getElementById('log').addEventListener('click', () => api.showLog());
document.getElementById('menu-bar').addEventListener('change', async (event) => draw(await api.set({ showInMenuBar: event.target.checked })));
document.getElementById('login').addEventListener('change', async (event) => draw(await api.login(event.target.checked)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('apply').click();
});

api.onChange(draw);
api.get().then(draw);
