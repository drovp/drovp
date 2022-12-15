import manifest from 'manifest';
import {h} from 'preact';
import {eem} from 'lib/utils';
import {pluginNameMeta} from 'lib/serialize';
import {Icon} from 'components/Icon';

export function PluginDisplayName({id, isExternal}: {id: string; isExternal: boolean}) {
	let nameMeta: PluginNameMeta | undefined;
	try {
		nameMeta = pluginNameMeta(id);
	} catch (error) {
		return (
			<span class="PluginDisplayName -danger">
				<Icon variant="danger" name="warning" tooltip={eem(error)} />
				<em>{id}</em>
			</span>
		);
	}

	return (
		<span class="PluginDisplayName" title={`Plugin ID: ${id}`}>
			{isExternal && nameMeta.isOfficial ? (
				<Icon
					class="stamp"
					variant="danger"
					name="logo"
					tooltip={`This is an externally installed plugin that pretends it belongs to @${manifest.name} organization. Official plugins will never need to be installed externally.`}
				/>
			) : nameMeta.isOfficial ? (
				<Icon class="stamp" name="logo" tooltip={`Official plugin by ${manifest.productName} developers`} />
			) : (
				nameMeta.isNonStandard && (
					<Icon
						class="stamp"
						name="warning"
						variant="warning"
						tooltip={`Plugin has a non-standard naming convention (missing drovp- prefix).\nIt might either be trying to impersonate other plugin, or developer is a rebel. Just be ware.`}
					/>
				)
			)}
			<span class="name">{nameMeta.displayName}</span>
		</span>
	);
}
