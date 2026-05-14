import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    moveSessionToProject,
} from './utils.js';

export const moveCommand = cli({
    site: 'webagent',
    name: 'move',
    access: 'write',
    description: 'Move a WebAgent session to a project',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'project-id', valueRequired: true, help: 'Destination WebAgent project ID' },
        { name: 'from-project-id', valueRequired: true, help: 'Current project ID, if the session is already in a project' },
    ],
    columns: ['status', 'session_id', 'from_project_id', 'project_id'],
    func: async (page, kwargs) => {
        const result = await moveSessionToProject(page, kwargs.id, {
            projectId: kwargs['project-id'],
            fromProjectId: kwargs['from-project-id'],
        });
        return [{
            status: 'moved',
            session_id: result.sessionId,
            from_project_id: result.fromProjectId || null,
            project_id: result.projectId,
        }];
    },
});
