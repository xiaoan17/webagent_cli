import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    deleteProject,
} from './utils.js';

export const projectDeleteCommand = cli({
    site: 'webagent',
    name: 'project-delete',
    access: 'write',
    description: 'Delete a WebAgent project',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent project ID' },
    ],
    columns: ['status', 'project_id'],
    func: async (page, kwargs) => {
        const id = await deleteProject(page, kwargs.id);
        return [{ status: 'deleted', project_id: id }];
    },
});
