import {h, RenderableProps, ComponentChildren} from 'preact';
import {Action, Actions} from 'components/Actions';
import {Icon, IconName} from 'components/Icon';
import {Pre} from 'components/Pre';
import {Spinner} from 'components/Spinner';

export type VacantProps = RenderableProps<{
	class?: string;
	variant?: Variant;
	loading?: boolean;
	icon?: IconName;
	title?: ComponentChildren;
	details?: string;
	actions?: Action[];
}>;

export function Vacant({class: className, variant, loading, icon, title, children, details, actions}: VacantProps) {
	let classNames = 'Vacant';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<div class={classNames}>
			{loading && <Spinner />}
			{!loading && icon && <Icon name={icon} />}
			{title && <h1>{title}</h1>}
			{children && <div class="content TextContent">{children}</div>}
			{details && (
				<Pre class="details" variant={variant}>
					{details}
				</Pre>
			)}
			{actions && <Actions actions={actions} semitransparent />}
		</div>
	);
}
