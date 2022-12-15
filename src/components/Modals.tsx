import {h, RenderableProps, Fragment} from 'preact';
import {useRef, useEffect} from 'preact/hooks';
import {useEventListener} from 'lib/hooks';
import {observer} from 'statin-preact';
import {useStore} from 'models/store';
import {Modal as ModalModel} from 'models/modals';
import {Actions} from 'components/Actions';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Tag} from 'components/Tag';
import {Pre} from 'components/Pre';
import {Scrollable} from 'components/Scrollable';

export type ModalProps = RenderableProps<{
	model: ModalModel;
	topmost: boolean;
}>;

export const Modal = observer(function Modal({model: modal, topmost}: ModalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	let {content, title, message, details, sideActions, actions, backgroundCancels} = modal;
	const cancellable = modal.cancellable();
	const variant = modal.variant();
	const hasAnyContent = message || details || content;

	function handleBackgroundClose(event: Event) {
		if (cancellable && backgroundCancels && event.target === event.currentTarget) modal.close({canceled: true});
	}

	useEventListener('keydown', (event: KeyboardEvent) => {
		if (cancellable && topmost && event.key === 'Escape') modal.close({canceled: true});
	});

	useEffect(
		() =>
			modal.registerCleaner(
				() =>
					new Promise<void>((resolve) => {
						if (!boxRef.current || !containerRef.current) return;
						boxRef.current.animate(
							{opacity: [1, 0], transform: ['translateY(0)', 'translateY(-50px)']},
							{duration: 100, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', fill: 'forwards'}
						);
						containerRef.current.animate({opacity: [1, 0]}, {duration: 100, fill: 'forwards'});
						setTimeout(resolve, 100);
					})
			),
		[]
	);

	let classNames = 'Modal';
	if (variant) classNames += ` -${variant}`;
	if (details && !message && !content) classNames += ' -details-only';
	if (title) classNames += ' -has-title';
	if (message) classNames += ' -has-message';
	if (details) classNames += ' -has-details';
	if (content) classNames += ' -has-content';
	if (hasAnyContent) classNames += ' -has-any-content';

	return (
		<div
			id={`id${modal.id}`}
			class={classNames}
			ref={containerRef}
			onWheel={(event) => event.stopPropagation()}
			onClick={handleBackgroundClose}
		>
			<div className="box" ref={boxRef}>
				{title && <h4 class="title">{title}</h4>}
				{(message || details || content) && (
					<Scrollable class="content -primary" auto>
						{message && <div class="message" dangerouslySetInnerHTML={{__html: message}} />}
						{details && <Pre class="details">{details}</Pre>}
						{content && (typeof content === 'function' ? content(modal) : content)}
					</Scrollable>
				)}
				{((actions && actions.length > 0) || (sideActions && sideActions.length > 0)) && (
					<div class="actions -primary">
						{sideActions && (
							<Actions class="side" large reversed actions={sideActions} onAction={() => modal.close()} />
						)}
						{actions && <Actions class="main" large actions={actions} onAction={() => modal.close()} />}
					</div>
				)}
			</div>
		</div>
	);
});

export const Modals = observer(function Modals() {
	const {modals} = useStore();
	const all = modals.all();

	return (
		<Fragment>
			{all.map((modal, index) => (
				<Modal key={modal.id} model={modal} topmost={index === all.length - 1} />
			))}
			{all.length > 1 && (
				<Button transparent class="CloseAllModals" onClick={modals.closeAndDeleteAll}>
					<Icon name="x" /> Close all <Tag>{all.length}</Tag> modals
				</Button>
			)}
		</Fragment>
	);
});
