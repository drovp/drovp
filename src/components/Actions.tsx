import {h} from 'preact';
import {useRef, useEffect} from 'preact/hooks';
import {TargetedEvent} from 'lib/utils';
import {observer} from 'statin-preact';
import {Button} from 'components/Button';
import {Icon, IconName, Help} from 'components/Icon';
import {useStore} from 'models/store';

export type ClickEvent = TargetedEvent<HTMLButtonElement, PointerEvent>;

export interface Action {
	icon?: IconName;
	iconRight?: IconName;
	title?: string;
	variant?: Variant;
	tooltip?: string;
	help?: string;
	compact?: boolean;
	focused?: boolean;
	transparent?: boolean;
	semitransparent?: boolean;
	muted?: boolean;
	disableWhenStaging?: boolean;
	action: (event: ClickEvent) => void;
}

export interface ActionsProps {
	actions: Action[];
	class?: string;
	muted?: boolean;
	compact?: boolean;
	transparent?: boolean;
	/**
	 * Tells <Actions> that they are going to be left aligned, which will place
	 * help icons on the right of the button they are attached to.
	 */
	reversed?: boolean;
	large?: boolean;
	semitransparent?: boolean;
	disableWhenStaging?: boolean;
	variant?: Variant;
	multiline?: boolean;
	onAction?: (action: Action, event: ClickEvent) => void;
}

export const Actions = observer(function Actions({
	actions,
	class: className,
	variant,
	compact,
	muted,
	reversed,
	transparent,
	large,
	semitransparent,
	disableWhenStaging,
	multiline,
	onAction,
}: ActionsProps) {
	const {staging} = useStore();
	const isStaging = staging.isStaging();
	const actionToFocusRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		actionToFocusRef.current?.focus();
	}, []);

	function executeAction(action: Action, event: ClickEvent) {
		action.action(event);
		onAction?.(action, event);
	}

	let classNames = 'Actions';
	if (className) classNames += ` ${className}`;
	if (compact) classNames += ' -compact';
	if (reversed) classNames += ' -reversed';

	return (
		<div class={classNames}>
			{actions?.map((action) => {
				const isStagingDisabled = (action.disableWhenStaging || disableWhenStaging) && isStaging;
				const isCompact = action.compact || compact;

				return [
					action.help != null && !reversed && <Help tooltip={action.help} />,
					<Button
						innerRef={action.focused ? actionToFocusRef : undefined}
						muted={action.muted ?? muted}
						semitransparent={action.semitransparent ?? semitransparent}
						transparent={action.transparent ?? transparent}
						multiline={multiline}
						large={large}
						variant={action.variant ?? variant}
						disabled={isStagingDisabled}
						tooltip={isStagingDisabled ? `Staging in progress` : action.tooltip || action.title}
						onClick={(event) => executeAction(action, event)}
					>
						{action.icon && <Icon name={action.icon} />}
						{!isCompact && action.title}
						{action.iconRight && <Icon name={action.iconRight} />}
					</Button>,
					action.help != null && reversed && <Help tooltip={action.help} />,
				];
			})}
		</div>
	);
});
