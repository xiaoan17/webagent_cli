import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    renameProject,
} from './utils.js';

export const projectRenameCommand = cli({
    site: 'webagent',
    name: 'project-rename',
    access: 'write',
    description: 'Rename a WebAgent project',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent project ID' },
        { name: 'name', positional: true, required: true, help: 'New project name' },
    ],
    columns: ['status', 'project_id', 'name'],
    func: async (page, kwargs) => {
        const result = await renameProject(page, kwargs.id, kwargs.name);
        return [{ status: 'renamed', project_id: result.projectId, name: result.name }];
    },
});
