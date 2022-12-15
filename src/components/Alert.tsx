import {h, RenderableProps} from 'preact';
import {Icon, IconName} from 'components/Icon';
import {Action, Actions} from 'components/Actions';

export type AlertProps = RenderableProps<{
	icon?: IconName;
	variant?: Variant;
	actions?: Action[];
}>;

export function Alert({icon, variant, children, actions}: AlertProps) {
	let classNames = 'Alert';
	if (variant) classNames += ` -${variant}`;

	return (
		<div class={classNames}>
			{icon && <Icon name={icon} />}
			<header>{children}</header>
			{actions && <Actions actions={actions} />}
		</div>
	);
}
