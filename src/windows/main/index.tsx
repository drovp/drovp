import Path from 'path';
import {shell, ipcRenderer} from 'electron';
import {h, render} from 'preact';
import {
	eem,
	isOfType,
	debounce,
	throttle,
	prevented,
	isTextInputElement,
	isInteractiveElement,
	setAppPath,
	idModifiers,
	isDragRequiringElement,
	getPointToPointDistance,
	rafThrottle,
} from 'lib/utils';
import {action, createAction, reaction} from 'statin';
import {createStore, Store} from 'models/store';
import {Router} from 'poutr';
import {App} from 'components/App';
import {Pre} from 'components/Pre';
import {makeToast} from 'components/Toast';
import {IconName} from 'components/Icon';
import {Item} from '@drovp/types';

const appContainer = document.querySelector('#app-container') as HTMLDivElement;

// Add platform class to HTML so styles can work with it.
document.documentElement.classList.add(process.platform);

// Prevent default drag & drop actions.
addEventListener('dragover', prevented());
addEventListener('drop', prevented());

// Prevent body from scrolling
document.body.addEventListener('scroll', () => {
	document.body.scrollTop = document.body.scrollLeft = 0;
});

// Render a rude app wide error
function appError(error: any) {
	appContainer.innerHTML = '';
	render(<Pre variant="danger">{error?.stack || error?.message || `${error}`}</Pre>, appContainer);
	console.error(error);
}

// Load store and render the app
ipcRenderer.invoke('get-paths').then(async (paths) => {
	const {userData: userDataPath, app: appPath, isWindowsPortable} = paths || {};

	// Validate paths
	if (typeof userDataPath !== 'string' || typeof appPath !== 'string' || typeof isWindowsPortable !== 'boolean') {
		throw new Error(
			`Invalid app paths returned: ${typeof paths === 'object' && paths ? JSON.stringify(paths) : `${paths}`}`
		);
	}

	// I hate I have to do this, but can't see how utils used by renderer can
	// get access to this path otherwise
	setAppPath(appPath);

	// Create store
	const store = await createStore({userDataPath, appPath, isWindowsPortable});
	const {settings} = store;

	// Catch errors
	addEventListener('unhandledrejection', (event) => store.app.handleError(event.reason));
	addEventListener('error', (event) => store.app.handleError(event.error));

	// Development features
	if (process.env.NODE_ENV === 'development') {
		// Listen for build changes and reload the appropriate parts of the app
		const watch = require('fs').watch;

		const reloadStyles = debounce(() => {
			for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
				if (!(link instanceof HTMLLinkElement)) continue;
				const href = link.getAttribute('href') ?? '';
				link.href =
					href.indexOf('?id=') > -1
						? href.replace(/(\?id=)(\d+)/, (m, str, id) => `${str}${Number(id) + 1}`)
						: href + '?id=0';
			}
		}, 300);

		try {
			const reloadApp = debounce(() => ipcRenderer.send('reload-window'), 500);

			watch(appPath, {recursive: true}, (type: string, filename: string) => {
				const ext = filename && Path.extname(filename);
				if (['.css', '.ttf'].includes(ext)) reloadStyles();
				else if (['.js', '.json'].includes(ext)) reloadApp();
			});
		} catch (error) {
			console.log(`couldn't start development file watcher: ${eem(error)}`);
		}

		/**
		 * Log path changes.
		 */
		store.history.subscribe(({location}) => console.log(location.href));

		/**
		 * Development shortcuts.
		 */
		const variants = ['info', 'warning', 'danger', 'success'];
		function addRandomEvent(icon?: IconName) {
			const message =
				Array(Math.round(Math.random() * 10 + 5))
					.fill(0)
					.map(() =>
						Number(
							Math.random()
								.toFixed(Math.round(Math.random() * 16))
								.replace(/^0\./, '')
						).toString(36)
					)
					.join(' ') + '.';
			const variant = variants[Math.floor(Math.random() * variants.length)];
			store.events.create({
				icon,
				title: `${variant} notification`,
				message,
				variant: variant as any,
				details: Math.random() > 0.5 ? new Error('Message').stack : undefined,
				actions:
					Math.random() > 0.6
						? [
								{
									icon: 'refresh',
									title: 'Update',
									variant: 'success',
									action: () => console.log('update'),
								},
						  ]
						: undefined,
			});
		}

		async function mockStaging(duration: number, errorOut = false, manual = false) {
			let staging = store.staging.start({
				title: 'Mock staging',
				target: 'development',
				action: 'mocking',
			});

			const wait = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

			async function stage(name: string, duration: number, progress: boolean = false) {
				let timeLeft = duration;
				staging.stage(name);

				while (timeLeft > 0) {
					await wait(50);
					timeLeft -= 100;
					action(() => {
						if (Math.random() > 0.3) staging.log(`${name} log line`);
						if (progress) {
							staging.progress({completed: Math.max(0, 1 - timeLeft / duration), total: 1});
						}
					});
					await wait(50);
				}
				action(() => {
					staging.progress(null);
				});
			}

			function done() {
				action(() => {
					if (errorOut) staging.error('Mocked error');
					staging.done();
				});
			}

			if (manual) {
				action(() => {
					staging.stage('stage name');
					staging.progress({completed: 0.5, total: 1});
				});
				const handleKeydown = (event: KeyboardEvent) => {
					if (event.key !== ' ') return;
					done();
					removeEventListener('keydown', handleKeydown);
				};
				addEventListener('keydown', handleKeydown);
			} else {
				await stage('stage 1', duration / 3, true);
				await stage('stage 2', duration / 3, false);
				await stage('stage 3', duration / 3, true);
				done();
			}
		}

		const mountAnimation = [{backgroundColor: 'red'}, {backgroundColor: '#eee'}];
		const mountObserver = new MutationObserver((mutations) => {
			for (const {addedNodes} of mutations) {
				for (const node of addedNodes) {
					(node as HTMLElement).animate?.(mountAnimation, {duration: 500, fill: 'backwards'});
				}
			}
		});
		let isObservingMounts = false;

		addEventListener('keydown', (event) => {
			// Ignore keys from interactive elements
			if (isTextInputElement(event.target)) return;

			switch (event.key) {
				case 'ArrowUp':
					makeToast({
						message: 'A random toast appeared',
						variant: event.shiftKey
							? (variants[Math.floor(Math.random() * variants.length)] as Variant)
							: undefined,
						action: event.shiftKey ? {title: 'Undo', action: () => {}} : undefined,
					});
					break;
				// Generate random notifications
				case 'e':
					addRandomEvent(event.altKey ? 'check' : undefined);
					break;
				case 'E':
					Array(10)
						.fill(0)
						.forEach(() => addRandomEvent());
					break;
				// Create a dummy modal
				case 'm':
				case 'M':
					store.modals.create({
						variant: event.ctrlKey ? 'danger' : undefined,
						title: 'Dummy modal',
						message: event.shiftKey
							? `A dummy modal message that should be somewhat longer than the title. A dummy modal message that should be somewhat longer than the title. A dummy modal message that should be somewhat longer than the title. A dummy modal message that should be somewhat longer than the title. A dummy modal message that should be somewhat longer than the title. A dummy modal message that should be somewhat longer than the title.`
							: 'A dummy modal message that should be somewhat longer than the title.',
						details: event.altKey
							? event.shiftKey
								? `[17:29:01] Starting 'buildStyles'...
[17:29:04] Finished 'buildStyles' after 3.33 s
[17:29:14] Starting 'buildStyles'...
Error in plugin "sass"
Message:
    src\\components\\Modals\\Modal.sass
Error: Undefined mixin.
   ╷
46 │             +scrollable()
   │             ^^^^^^^^^^^^^
  src\\components\\About\\About.sass 7:2  @import
  src\\windows\\main\\index.sass 10:9     root stylesheet
[17:30:13] Finished 'buildStyles' after 279 ms
[17:30:24] Starting 'buildStyles'...
[17:30:25] Finished 'buildStyles' after 1.22 s
[17:30:58] Starting 'buildStyles'...
Error in plugin "sass"
Message:
    src\\components\\Modals\\Modal.sass
Error: Only 0 arguments allowed, but 1 was passed.
    ┌──> src\\components\\Modals\\Modal.sass
57  │                 +selectable(var(--spacing-half))
    │                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ invocation
    ╵

[20:14:22] Starting 'buildScripts'...
[20:14:22] Finished 'buildScripts' after 61 ms`
								: 'Some details\nthere might be more of them, pre-formatted.'
							: undefined,
						actions: [
							{
								title: 'Primary',
								icon: 'trash',
								focused: true,
								action: () => {},
							},
						],
					});
					break;
				// Toggle DOM mounting visualization
				case 'o':
					if (isObservingMounts) {
						isObservingMounts = false;
						mountObserver.disconnect();
					} else {
						isObservingMounts = true;
						mountObserver.observe(document.body, {subtree: true, childList: true});
					}
					break;
				// Reload
				case 'r':
					// @ts-ignore
					if (event.ctrlKey) window.location.reload(true);
					break;
				// Mock staging
				// modifiers:
				// - shift: longer
				// - alt: paused until any other key is pressed
				// - ctrl: errors out
				case 's':
					mockStaging(3000, event.ctrlKey, event.altKey);
					break;
				case 'S':
					mockStaging(10000, event.ctrlKey, event.altKey);
					break;
				// Drop test item
				case 'i':
				case 'I':
				case '0':
				case '1':
				case '2':
				case '3':
				case '4':
				case '5':
				case '!':
				case '@':
				case '#':
				case '$':
				case '%':
				case ')':
					// Get currently opened, or first profile
					const profileId = store.history.location.path.match(/\/profiles\/([^\/]+)/)?.[1];
					const profile = profileId
						? store.profiles.byId().get(profileId)
						: store.profiles.categories.byId().get(store.settings.profileCategory())?.profiles()[0] ||
						  store.profiles.all()[0];
					if (!profile) throw new Error(`no profile ${profileId}`);
					const key =
						({'!': '1', '@': '2', '#': '3', $: '4', '%': '5', ')': '0'} as any)[event.key] || event.key;
					action(() => {
						const makeItem = () =>
							({
								id: (Math.random() * 1e20).toString(36),
								created: Date.now(),
								kind: 'file',
								type: 'jpg',
								path: 'F:\\Downloads\\test\\test.jpg',
								size: 468591,
							} as Item);
						// Bulk
						if (key === '0') {
							profile.dropItems(
								Array(100)
									.fill(0)
									.map(() => makeItem()),
								{modifiers: idModifiers(event), action: 'drop'}
							);
						} else {
							const count = key.toLowerCase() === 'i' ? 1 : Math.pow(10, parseInt(key, 10));
							for (let i = 0; i < count; i++) {
								profile.dropItems([makeItem()], {
									modifiers: count === 1 ? idModifiers(event) : '',
									action: 'drop',
								});
							}
						}
					});
					break;
			}
		});
	}

	// User shortcuts
	addEventListener(
		'keydown',
		createAction((event: KeyboardEvent) => {
			// Ignore keys from interactive elements
			if (isTextInputElement(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;

			let fellThrough = false;
			switch (event.key) {
				// Play pause queue
				case ' ':
					if (!isInteractiveElement(event.target)) store.worker.toggle();
					else fellThrough = true;
					break;
				// Toggle theme
				case 'd':
					settings.theme(settings.theme() === 'light' ? 'dark' : 'light');
					break;
				// Toggle compact mode
				case 'c':
					settings.compact(!settings.compact());
					break;
				// Toggle always on top
				case 't':
					settings.alwaysOnTop(!settings.alwaysOnTop());
					break;
				// Increase/Decrease font size
				case '+':
				case '=':
				case '-':
					try {
						settings.fontSize(settings.fontSize() + (event.key === '-' ? -1 : 1));
					} catch {}
					break;
				case 'F5':
					store.plugins.reload();
					break;
				default:
					fellThrough = true;
			}

			if (!fellThrough) event.preventDefault();
		})
	);

	// Window dragging
	addEventListener('mousedown', function (event) {
		const {target} = event;
		if (
			!store.app.isWindowTitleBarHidden() ||
			!isOfType<HTMLElement>(target, target != null) ||
			isDragRequiringElement(target) ||
			getComputedStyle(target).userSelect !== 'none'
		) {
			return;
		}

		let $overlay: HTMLDivElement | undefined;
		let initialized = false;
		let distance = 0;
		let deltaX = 0;
		let deltaY = 0;
		let startPos: [number, number] | null = null;
		const flushMove = rafThrottle(() => {
			if (startPos) ipcRenderer.send('move-window-to', startPos[0] + deltaX, startPos[1] + deltaY);
		});

		ipcRenderer.invoke('get-window-position').then((pos) => {
			if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
				startPos = pos as any;
			}
		});

		function handleMove(event: MouseEvent) {
			if (!initialized) {
				distance += getPointToPointDistance(0, 0, event.movementX, event.movementY);
				if (distance > 6) {
					initialized = true;

					// Prevents click and other cursor actions on release
					$overlay = document.createElement('div');
					Object.assign($overlay.style, {position: 'fixed', inset: 0, zIndex: 10000});
					document.body.appendChild($overlay);
				}
			}
			deltaX += event.movementX;
			deltaY += event.movementY;
			flushMove();
		}

		function handleUp() {
			removeEventListener('mouseup', handleUp);
			removeEventListener('mousemove', handleMove);
			setTimeout(() => $overlay?.remove(), 100);
		}

		addEventListener('mousemove', handleMove);
		addEventListener('mouseup', handleUp);
	});

	// Expose store
	reaction(() => {
		(window as any).store = settings.developerMode() ? store : undefined;
	});

	// Update window progress bar
	// STOP putting this into app model, it can't be there, the profiles and
	// worker are not created when app constructor runs!
	reaction(
		() => {
			return !settings.taskbarProgress()
				? {progress: 0, isPaused: false}
				: {
						progress: store.operations.isPending() ? store.profiles.progress() : -1,
						isPaused: store.worker.isPaused(),
				  };
		},
		throttle(
			({progress, isPaused}: {progress: number; isPaused: boolean}) =>
				ipcRenderer.send(`set-progress`, progress, isPaused ? 'paused' : 'normal'),
			100
		)
	);

	// Window title
	reaction(() => {
		document.title = store.app.title();
	});

	// Anchor links opening
	addEventListener('click', (event) => {
		if (!isOfType<HTMLElement>(event.target, event.target != null)) return;
		const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
		const href = anchor?.href;
		if (!href) return;
		event.preventDefault();
		const routeName = href.match(/^route:\/\/(.*)/)?.[1];
		const routePath = routeName && `/${routeName}`;
		if (routePath) store.history.push(routePath);
		else if (href.indexOf('http') === 0) shell.openExternal(href);
		if (anchor.dataset.closeModals) store.modals.closeAndDeleteAll();
	});

	// Render the app
	try {
		// Clean up loading indicator
		appContainer.innerHTML = '';

		// Styling settings
		document.documentElement.dataset.os = ({win32: 'win', darwin: 'mac'} as any)[process.platform] ?? 'linux';
		reaction(() => {
			document.documentElement.dataset.theme = store.app.theme();
			document.documentElement.dataset.uimode = settings.compact() ? 'compact' : '';
			document.documentElement.style.setProperty('--font-size', `${settings.fontSize()}px`);
			document.documentElement.dataset.freezeAnimations = store.app.isModalWindowOpen() ? 'true' : 'false';
		});

		// Render app
		render(
			<Store.Provider value={store}>
				<Router history={store.history}>
					<App />
				</Router>
			</Store.Provider>,
			appContainer
		);
	} catch (error) {
		appError(error);
	}

	// Re-open devtools
	if (store.settings.openDevTools()) ipcRenderer.send('open-devtools');

	// Check for update errors
	store.app.checkUpdateError();
}, appError);
