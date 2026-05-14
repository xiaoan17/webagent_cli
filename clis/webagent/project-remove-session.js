import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    removeSessionFromProject,
} from './utils.js';

export const projectRemoveSessionCommand = cli({
    site: 'webagent',
    name: 'project-remove-session',
    access: 'write',
    description: 'Remove a WebAgent session from a project without deleting the session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'project-id', valueRequired: true, help: 'Current WebAgent project ID' },
    ],
    columns: ['status', 'session_id', 'project_id'],
    func: async (page, kwargs) => {
        const result = await removeSessionFromProject(page, kwargs.id, {
            projectId: kwargs['project-id'],
        });
        return [{
            status: 'removed',
            session_id: result.sessionId,
            project_id: result.projectId,
        }];
    },
});
