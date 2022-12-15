import {h, RenderableProps} from 'preact';
import {Icon} from 'components/Icon';

export type PaginationProps = RenderableProps<{
	class?: string;
	page: number;
	total: number;
	onChange: (page: number) => void;
	disabled?: boolean;
}>;

export function Pagination({class: className, page, total, onChange, disabled}: PaginationProps) {
	let classNames = 'Pagination';
	if (className) classNames += ` ${className}`;
	if (disabled) classNames += ' -disabled';

	return (
		<div class={classNames}>
			<button
				class={page > 1 ? undefined : '-hidden'}
				onClick={disabled ? undefined : () => onChange(0)}
				title="First page"
			>
				<Icon name="to-start" />
			</button>
			<button
				class={page > 0 ? undefined : '-hidden'}
				onClick={disabled ? undefined : () => onChange(page - 1)}
				title="Previous page"
			>
				<Icon name="chevron-left" />
			</button>
			<input
				class="current"
				type="text"
				value={page + 1}
				onClick={(event) => event.currentTarget.select()}
				onKeyDown={
					disabled
						? undefined
						: (event) => {
								if (event.key !== 'Enter') return;
								const newPage = parseInt(event.currentTarget.value, 10);
								if (Number.isFinite(newPage) && newPage > 0 && newPage <= total) onChange(newPage - 1);
						  }
				}
			/>
			<span class="divider">/</span>
			<span class="total">{total + 1}</span>
			<button
				class={page < total ? undefined : '-hidden'}
				onClick={disabled ? undefined : () => onChange(page + 1)}
				title="Next page"
			>
				<Icon name="chevron-right" />
			</button>
			<button
				class={page < total - 1 ? undefined : '-hidden'}
				onClick={disabled ? undefined : () => onChange(total)}
				title="Last page"
			>
				<Icon name="to-end" />
			</button>
		</div>
	);
}
