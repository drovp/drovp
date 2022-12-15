import {h, RenderableProps} from 'preact';
import {observer} from 'statin-preact';
import {prevented} from 'lib/utils';
import {useStore} from 'models/store';
import type {Processor} from 'models/processors';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';

type ProcessorCardProps = RenderableProps<{
	processor: Processor;
}>;

export const ProcessorCard = observer(function ProcessorCard({processor}: ProcessorCardProps) {
	const {history} = useStore();
	const profilesCount = processor.profiles().length;
	const isReady = processor.isReady();
	const issues = processor?.issues() || [];
	const hasIssues = issues.length > 0;

	function createAndGoToProfile() {
		if (isReady) processor.createAndGoToProfile();
	}

	const goToProcessor = () => history.push(`/processors/${encodeURIComponent(processor.id)}`);

	let classNames = `Card ProcessorCard ${hasIssues ? '-danger' : ''}`;

	// Only display plugin name when it differs from processor's name.
	const maybeSubtitle = processor.plugin.displayName !== processor.name ? processor.plugin.name : undefined;
	const profilesCountTitle = `${profilesCount} dependent ${profilesCount === 1 ? 'profile' : 'profiles'}`;
	const issuesTitle = isReady
		? ''
		: `\n${processor
				.issues()
				.map((issue) => issue.title)
				.join('\n')}`;

	return (
		<button
			class={classNames}
			onClick={goToProcessor}
			data-context-menu="processor"
			data-context-menu-payload={processor.id}
			title={`ID: ${processor.id}\n${profilesCountTitle}${issuesTitle}`}
		>
			<header>
				<h1>{processor.name}</h1>
				<h2>{maybeSubtitle}</h2>
			</header>
			{processor.description && <p>{processor.description}</p>}
			{hasIssues && (
				<div
					class="meta issues"
					title={`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}:\n${issuesTitle}`}
				>
					{issues.length} <Icon name="warning" />
				</div>
			)}
			<div class="meta profiles" title={profilesCountTitle}>
				{profilesCount} <Icon name="profile" />
			</div>
			<div class="actions">
				<Button
					variant="accent"
					multiline
					semitransparent
					disabled={!isReady}
					onClick={prevented(createAndGoToProfile)}
					tooltip={
						isReady ? `Create new profile` : issues.length ? `There are some issues` : `Staging in progress`
					}
				>
					<Icon name="profile-add" /> Profile
				</Button>
			</div>
		</button>
	);
});
