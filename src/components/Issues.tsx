import {h, RenderableProps} from 'preact';
import {Alert} from 'components/Alert';
import {Action} from 'components/Actions';

export interface Issue {
	variant?: Variant;
	title: string;
	message?: string;
	actions?: Action[];
}

type IssuesProps = RenderableProps<{
	issues: Issue[];
}>;

export function Issues({issues}: IssuesProps) {
	return issues.length === 0 ? null : (
		<section class="Issues">
			{issues.map((issue) => (
				<Alert icon="warning" variant={issue.variant || 'danger'} actions={issue.actions}>
					<h1>{issue.title}</h1>
					{issue.message && <p dangerouslySetInnerHTML={{__html: issue.message}} />}
				</Alert>
			))}
		</section>
	);
}
