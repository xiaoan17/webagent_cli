import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './send.js';
import './read.js';
import './history.js';
import './detail.js';
import './new.js';
import './status.js';
import './cancel.js';
import './projects.js';

describe('webagent command registration', () => {
    it('registers WebAgent browser commands with persistent cookie sessions', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            history: 'read',
            detail: 'read',
            new: 'write',
            status: 'read',
            cancel: 'write',
            projects: 'read',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`webagent/${name}`);
            expect(cmd, `webagent/${name}`).toBeDefined();
            expect(cmd.site).toBe('webagent');
            expect(cmd.domain).toBe('agent.famou.com');
            expect(cmd.strategy).toBe('cookie');
            expect(cmd.browser).toBe(true);
            expect(cmd.siteSession).toBe('persistent');
            expect(cmd.navigateBefore).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('keeps runtime-visible arguments for ask', () => {
        const ask = getRegistry().get('webagent/ask');
        expect(ask.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'prompt', positional: true, required: true }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'id' }),
            expect.objectContaining({ name: 'project-id' }),
            expect.objectContaining({ name: 'agent-type', default: 'opencode' }),
            expect.objectContaining({ name: 'file', valueRequired: true }),
            expect.objectContaining({ name: 'data', valueRequired: true }),
            expect.objectContaining({ name: 'data-file', valueRequired: true }),
        ]));
        expect(ask.columns).toEqual(['response', 'session_id', 'url', 'files']);
    });

    it('keeps runtime-visible arguments for projects', () => {
        const projects = getRegistry().get('webagent/projects');
        expect(projects.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'limit', type: 'int', default: 100 }),
            expect.objectContaining({ name: 'page', type: 'int', default: 1 }),
        ]));
        expect(projects.columns).toEqual(['index', 'name', 'id', 'file_count', 'skill_count', 'task_count', 'created_at', 'file_limit', 'size_limit']);
    });
});
