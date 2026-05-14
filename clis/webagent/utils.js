import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const WEBAGENT_DOMAIN = 'agent.famou.com';
export const WEBAGENT_URL = 'https://agent.famou.com/';
export const WEBAGENT_API_BASE = 'https://pro-service.famou.com';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_BROWSER_UPLOAD_BYTES = 25 * 1024 * 1024;
const SESSION_DONE_STATUSES = new Set(['idle', 'ended', 'failed', 'cancelled']);
const EVENT_TYPE_MAP = {
    thinking: 'agent/thinking',
    text: 'agent/text',
    status: 'session/status',
    tool_use: 'agent/tool_use',
    tool_result: 'agent/tool_result',
    usage: 'agent/usage',
    plan: 'agent/plan',
    error: 'session/error',
    session_meta: 'session/meta',
};

export function authRequired(message) {
    return new AuthRequiredError(
        WEBAGENT_DOMAIN,
        message || 'Sign in to agent.famou.com in Chrome, then retry.',
    );
}

export function parseBoolFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

export function requireNonEmptyPrompt(value, commandName = 'webagent') {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new ArgumentError(
            `${commandName} prompt cannot be empty`,
            `Example: opencli ${commandName} ask "hello"`,
        );
    }
    return text;
}

export function requirePositiveInt(value, flagLabel, hint) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) {
        throw new ArgumentError(`${flagLabel} must be a positive integer`, hint);
    }
    return num;
}

export function requireReadableFile(filePath, flagLabel = 'file') {
    const raw = String(filePath || '').trim();
    if (!raw) {
        throw new ArgumentError(`${flagLabel} must be a non-empty file path`);
    }
    const resolved = path.resolve(raw);
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch {
        throw new ArgumentError(`${flagLabel} not found: ${resolved}`, `Provide an existing local file path for ${flagLabel}.`);
    }
    if (!stat.isFile()) {
        throw new ArgumentError(`${flagLabel} is not a file: ${resolved}`);
    }
    if (stat.size > MAX_BROWSER_UPLOAD_BYTES) {
        throw new ArgumentError(
            `${flagLabel} is too large for browser-side upload: ${formatBytes(stat.size)}`,
            `Current CLI upload limit is ${formatBytes(MAX_BROWSER_UPLOAD_BYTES)} per file.`,
        );
    }
    return { path: resolved, name: path.basename(resolved), size: stat.size };
}

export function parseSessionId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('id must be a non-empty WebAgent session ID or URL');
    }
    let candidate = raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new ArgumentError(`not a valid WebAgent URL (got "${input}")`);
        }
        const host = parsed.hostname.toLowerCase();
        const match = parsed.pathname.match(/^\/chat\/([^/?#]+)\/?$/);
        if (parsed.protocol !== 'https:' || host !== WEBAGENT_DOMAIN || !match) {
            throw new ArgumentError(
                `not a valid WebAgent chat URL (got "${input}"); expected https://agent.famou.com/chat/<id>`,
            );
        }
        candidate = decodeURIComponent(match[1]);
    } else {
        const pathMatch = raw.match(/^\/?chat\/([^/?#]+)\/?$/);
        if (pathMatch) candidate = decodeURIComponent(pathMatch[1]);
    }
    if (!SESSION_ID_RE.test(candidate)) {
        throw new ArgumentError(
            `not a valid WebAgent session ID (got "${input}"); expected an ID from https://agent.famou.com/chat/<id>`,
        );
    }
    return candidate;
}

export function sessionUrl(id) {
    const sessionId = String(id || '').trim();
    return sessionId ? `${WEBAGENT_URL}chat/${encodeURIComponent(sessionId)}` : WEBAGENT_URL;
}

export async function isOnWebAgent(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === WEBAGENT_DOMAIN;
    } catch {
        return false;
    }
}

export async function ensureOnWebAgent(page) {
    if (await isOnWebAgent(page)) return false;
    await page.goto(WEBAGENT_URL, { waitUntil: 'load', settleMs: 2000 });
    return true;
}

export async function getCurrentSessionId(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname.toLowerCase() !== WEBAGENT_DOMAIN) return '';
        const match = parsed.pathname.match(/^\/chat\/([^/?#]+)\/?$/);
        return match ? parseSessionId(match[1]) : '';
    } catch {
        return '';
    }
}

async function browserJsonFetch(page, path, options = {}) {
    await ensureOnWebAgent(page);
    const result = await page.evaluate(async (apiPath, fetchOptions) => {
        const safeCookie = () => {
            try {
                return document.cookie || '';
            } catch {
                return '';
            }
        };
        const searchParams = fetchOptions.searchParams || null;
        const qs = searchParams && Object.keys(searchParams).length
            ? '?' + new URLSearchParams(Object.entries(searchParams)
                .filter(([, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => [key, String(value)])).toString()
            : '';
        const proxyUrl = (apiPath) => {
            const origin = (location.origin && location.origin !== 'null')
                ? location.origin
                : 'https://agent.famou.com';
            return `${origin}/proxyApi/${apiPath.replace(/^\/+/, '')}`;
        };
        const url = apiPath.startsWith('http')
            ? apiPath + qs
            : proxyUrl(apiPath) + qs;
        const headers = {
            'Accept': 'application/json',
            'x-bce-request-id': (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
            'x-cookie': safeCookie(),
            ...(fetchOptions.headers || {}),
        };
        const init = {
            method: fetchOptions.method || 'GET',
            credentials: 'include',
            headers,
        };
        if (fetchOptions.body !== undefined) {
            init.body = JSON.stringify(fetchOptions.body);
            init.headers['Content-Type'] = 'application/json';
        }
        const response = await fetch(url, init);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { raw: text };
        }
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            data,
            text,
        };
    }, path, options);
    return mapFetchResult(result, path);
}

function mapFetchResult(result, label) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError(`WebAgent request failed for ${label}: empty browser response`);
    }
    const status = Number(result.status || 0);
    const body = result.data;
    const errorMessage = body?.error?.message || body?.message || body?.msg || body?.error || result.statusText;
    if (status === 401 || status === 403 || body?.code === 401 || body?.code === 403) {
        throw authRequired(String(errorMessage || 'WebAgent login is required.'));
    }
    if (!result.ok || body?.success === false || (body?.error && typeof body.error === 'object')) {
        throw new CommandExecutionError(
            `WebAgent request failed for ${label}: ${errorMessage || `HTTP ${status}`}`,
        );
    }
    return body;
}

function ensureWebAgentSuccess(payload, commandName) {
    const code = payload?.code;
    if (code === undefined || code === null || code === '0' || code === 0) return;
    const message = payload?.message || payload?.msg || payload?.error?.message || payload?.error || `${commandName} failed with code ${code}`;
    throw new CommandExecutionError(String(message));
}

export async function checkLoginStatus(page) {
    const payload = await browserJsonFetch(page, 'console/v1/oauth/is_login');
    return Boolean(payload?.data?.isLogin ?? payload?.data?.is_login ?? payload?.isLogin);
}

export async function getUserInfo(page) {
    const payload = await browserJsonFetch(page, 'console/v1/users/userinfo');
    return payload?.data || payload || {};
}

export async function listProjects(page, { pageNo = 1, pageSize = 100 } = {}) {
    const pageIndex = requirePositiveInt(pageNo, 'webagent projects --page', 'Example: opencli webagent projects --page 1');
    const size = requirePositiveInt(pageSize, 'webagent projects --limit', 'Example: opencli webagent projects --limit 100');
    const payload = await browserJsonFetch(page, 'console/v1/project/list', {
        searchParams: { p: pageIndex, s: size },
    });
    const data = payload?.data ?? payload;
    const list = Array.isArray(data?.projects)
        ? data.projects
        : Array.isArray(data?.data?.projects)
            ? data.data.projects
        : Array.isArray(data?.list)
            ? data.list
            : Array.isArray(data?.data)
                ? data.data
            : Array.isArray(data?.items)
                ? data.items
                : Array.isArray(data)
                    ? data
                    : [];
    return list.map(normalizeProjectSummary).filter((item) => item.id);
}

export async function listSessions(page, { limit = 20, pageNo = 1 } = {}) {
    const pageSize = requirePositiveInt(limit, 'webagent history --limit', 'Example: opencli webagent history --limit 20');
    const pageIndex = requirePositiveInt(pageNo, 'webagent history --page', 'Example: opencli webagent history --page 1');
    const offset = (pageIndex - 1) * pageSize;
    const payload = await browserJsonFetch(page, 'console/v1/sessions/list', {
        searchParams: { limit: pageSize, offset },
    });
    const data = payload?.data ?? payload;
    const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
            ? data.data
        : Array.isArray(data?.sessions)
            ? data.sessions
            : Array.isArray(data?.list)
                ? data.list
            : Array.isArray(data?.items)
                ? data.items
                : [];
    return list.map(normalizeSessionSummary).filter((item) => item.id);
}

export async function getSession(page, id, options = {}) {
    const sessionId = parseSessionId(id);
    const searchParams = {};
    if (options.turns !== undefined) searchParams.turns = requirePositiveInt(
        Number(options.turns),
        'webagent detail --turns',
        'Example: opencli webagent detail <id> --turns 10',
    );
    if (options.beforeTurnId) searchParams.before_turn_id = options.beforeTurnId;
    if (options.excludeEvents !== undefined) searchParams.exclude_events = parseBoolFlag(options.excludeEvents);
    const payload = await browserJsonFetch(page, `console/v1/sessions/${encodeURIComponent(sessionId)}`, {
        searchParams,
    });
    const data = payload?.data ?? payload;
    return normalizeSessionDetail(data, sessionId);
}

export async function cancelSession(page, id) {
    const sessionId = parseSessionId(id);
    await browserJsonFetch(page, `console/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {
        method: 'POST',
        body: {},
    });
    return sessionId;
}

export async function checkEvolution(page, id) {
    const sessionId = parseSessionId(id);
    let payload;
    try {
        payload = await browserJsonFetch(page, `console/v1/sessions/${encodeURIComponent(sessionId)}/evolve/check`, {
            method: 'POST',
            body: {},
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\b404\b/.test(message)) {
            return {
                sessionId,
                status: 'check_unavailable',
                canStart: true,
                message: 'Evolution credit check endpoint was unavailable; WebAgent UI starts evolution without this check.',
            };
        }
        throw error;
    }
    const code = String(payload?.code ?? '');
    const data = payload?.data || {};
    if (code === '-1' && data) {
        return {
            sessionId,
            status: 'insufficient_credits',
            canStart: false,
            requiredCredits: data.required_credits ?? data.requiredCredits ?? 80,
            availableCredits: data.available_credits ?? data.availableCredits ?? 0,
            message: payload?.message || payload?.msg || '余额不足，无法启动演化',
        };
    }
    ensureWebAgentSuccess(payload, 'webagent evolve check');
    return {
        sessionId,
        status: 'available',
        canStart: true,
        message: payload?.message || payload?.msg || '',
    };
}

export async function renameSession(page, id, title) {
    const sessionId = parseSessionId(id);
    const text = requireNonEmptyPrompt(title, 'webagent rename');
    const payload = await browserJsonFetch(page, `console/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        body: { title: text },
    });
    ensureWebAgentSuccess(payload, 'webagent rename');
    return { sessionId, title: text };
}

export async function deleteSession(page, id) {
    const sessionId = parseSessionId(id);
    const payload = await browserJsonFetch(page, `console/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
    });
    ensureWebAgentSuccess(payload, 'webagent delete');
    return sessionId;
}

export async function shareSession(page, id, options = {}) {
    const sessionId = parseSessionId(id);
    let title = String(options.title || '').trim();
    if (!title) {
        const session = await getSession(page, sessionId, { turns: 1, excludeEvents: true }).catch(() => null);
        title = session?.title || '';
    }
    const expireDays = requirePositiveInt(options.expireDays ?? 7, 'webagent share --expire-days', 'Example: opencli webagent share <id> --expire-days 7');
    const payload = await browserJsonFetch(page, 'console/v1/share/create', {
        method: 'POST',
        body: {
            session_id: sessionId,
            title,
            expire_days: expireDays,
        },
    });
    ensureWebAgentSuccess(payload, 'webagent share');
    const data = payload?.data ?? payload;
    const shareUrl = String(data?.share_url || data?.shareUrl || data?.url || data?.link || '').trim();
    if (!shareUrl) {
        throw new EmptyResultError('webagent share', `No share URL returned for WebAgent session ${sessionId}.`);
    }
    return { sessionId, title, expireDays, shareUrl };
}

export async function moveSessionToProject(page, id, options = {}) {
    const sessionId = parseSessionId(id);
    const toProjectId = String(options.projectId || options.toProjectId || '').trim();
    if (!toProjectId) {
        throw new ArgumentError('webagent move --project-id is required', 'Example: opencli webagent move <session_id> --project-id <project_id>');
    }
    const fromProjectId = String(options.fromProjectId || options.project_id || '').trim();
    const payload = await browserJsonFetch(page, 'console/v1/project/moveTask', {
        method: 'POST',
        body: {
            projectId: fromProjectId,
            toProjectId,
            sessionId,
        },
    });
    ensureWebAgentSuccess(payload, 'webagent move');
    return { sessionId, fromProjectId, projectId: toProjectId };
}

export async function removeSessionFromProject(page, id, options = {}) {
    const sessionId = parseSessionId(id);
    const projectId = String(options.projectId || '').trim();
    if (!projectId) {
        throw new ArgumentError('webagent project-remove-session --project-id is required', 'Example: opencli webagent project-remove-session <session_id> --project-id <project_id>');
    }
    const payload = await browserJsonFetch(page, 'console/v1/project/edit', {
        method: 'POST',
        body: {
            projectId,
            delete: [{ type: 'task', id: sessionId }],
        },
    });
    ensureWebAgentSuccess(payload, 'webagent project-remove-session');
    return { sessionId, projectId };
}

export async function createProject(page, name) {
    const projectName = requireNonEmptyPrompt(name, 'webagent project-create');
    const payload = await browserJsonFetch(page, 'console/v1/project/create', {
        method: 'POST',
        body: { projectName },
    });
    ensureWebAgentSuccess(payload, 'webagent project-create');
    const data = payload?.data ?? payload;
    return normalizeProjectSummary({ ...data, projectName: data?.projectName || data?.name || projectName });
}

export async function getProject(page, id) {
    const projectId = requireNonEmptyPrompt(id, 'webagent project-detail');
    const payload = await browserJsonFetch(page, 'console/v1/project/detail', {
        searchParams: { projectId },
    });
    ensureWebAgentSuccess(payload, 'webagent project-detail');
    const data = payload?.data ?? payload;
    return normalizeProjectDetail({ ...data, projectId: data?.projectId || data?.id || projectId });
}

export async function renameProject(page, id, name) {
    const projectId = requireNonEmptyPrompt(id, 'webagent project-rename');
    const rename = requireNonEmptyPrompt(name, 'webagent project-rename');
    const payload = await browserJsonFetch(page, 'console/v1/project/edit', {
        method: 'POST',
        body: { projectId, rename },
    });
    ensureWebAgentSuccess(payload, 'webagent project-rename');
    return { projectId, name: rename };
}

export async function deleteProject(page, id) {
    const projectId = requireNonEmptyPrompt(id, 'webagent project-delete');
    const payload = await browserJsonFetch(page, `console/v1/project/delete?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
    });
    ensureWebAgentSuccess(payload, 'webagent project-delete');
    return projectId;
}

function buildMessages(prompt, files = []) {
    return [{
        role: 'user',
        content: [
            { type: 'text', text: prompt },
            ...files.map(fileToMessageContent),
        ],
    }];
}

export async function createSession(page, prompt, options = {}) {
    const id = String(options.uploadId || '').trim() || createUploadId();
    const upload = await prepareUploadAttachments(page, id, options);
    const body = {
        id,
        config: { agent_type: options.agentType || 'opencode' },
        messages: buildMessages(prompt, upload.files),
        ...(options.projectId ? { project_id: String(options.projectId).trim() } : {}),
    };
    const result = await postStream(page, 'console/v1/sessions/create', body, options.timeoutSeconds || 120, id, upload.files);
    return { ...result, files: upload.files };
}

export async function sendToSession(page, id, prompt, options = {}) {
    const sessionId = parseSessionId(id);
    const upload = await prepareUploadAttachments(page, sessionId, options);
    const body = { messages: buildMessages(prompt, upload.files) };
    await registerSessionFiles(page, sessionId, upload.files);
    const result = await postStream(page, `console/v1/sessions/${encodeURIComponent(sessionId)}/events`, body, options.timeoutSeconds || 120, sessionId);
    return { ...result, files: upload.files };
}

export async function getSessionReceipt(page, id, options = {}) {
    const turns = options.turns === undefined ? 10 : requirePositiveInt(
        Number(options.turns),
        'webagent receipt --turns',
        'Example: opencli webagent receipt <id> --turns 10',
    );
    const session = await getSession(page, id, { turns });
    const latest = latestAssistantMessage(session);
    if (!latest) {
        throw new EmptyResultError('webagent receipt', `No assistant receipt found in WebAgent session ${session.id}.`);
    }
    const feedback = parseWebAgentFeedback(latest.text);
    return {
        session,
        feedback,
        message: latest,
        ...receiptOutputFields(session.id, feedback),
    };
}

export async function startEvolution(page, id, options = {}) {
    const sessionId = parseSessionId(id);
    const turns = options.turns === undefined ? 10 : requirePositiveInt(
        Number(options.turns),
        'webagent evolve --turns',
        'Example: opencli webagent evolve <id> --turns 10',
    );
    const timeoutSeconds = requirePositiveInt(
        Number(options.timeoutSeconds ?? 300),
        'webagent evolve --timeout',
        'Example: opencli webagent evolve <id> --timeout 300',
    );
    const force = parseBoolFlag(options.force, false);
    const skipCheck = parseBoolFlag(options.skipCheck, false);
    const session = await getSession(page, sessionId, { turns }).catch(() => null);
    const latestText = latestAssistantMessage(session)?.text || '';
    const feedback = parseWebAgentFeedback(latestText);
    if (!feedback.evolution.available && !force) {
        throw new EmptyResultError(
            'webagent evolve',
            `No deep-evolution suggestion found in WebAgent session ${sessionId}. Re-run with --force to send /evolve anyway.`,
        );
    }
    const creditCheck = skipCheck ? null : await checkEvolution(page, sessionId);
    if (creditCheck && !creditCheck.canStart) {
        return {
            sessionId,
            status: creditCheck.status,
            creditCheck,
            response: '',
            feedback,
            submitMode: 'check',
        };
    }
    const previousUserCount = session ? normalizeSessionMessages(session).filter((message) => message.role === 'user').length : 0;
    const uiResult = await clickEvolutionActionInPage(page, sessionId, 'start')
        .catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
    if (uiResult?.ok) {
        const response = await waitForPromptFollowup(page, sessionId, '/evolve', timeoutSeconds, previousUserCount);
        return {
            sessionId,
            status: response?.response ? 'submitted' : 'submitted_pending',
            response: response?.response || '',
            feedback: parseWebAgentFeedback(response?.response || ''),
            creditCheck,
            submitMode: 'ui',
        };
    }
    const result = await sendToSession(page, sessionId, '/evolve', { timeoutSeconds });
    return {
        ...result,
        sessionId: result.sessionId || sessionId,
        response: cleanWebAgentText(result.response || ''),
        feedback: parseWebAgentFeedback(result.response || ''),
        creditCheck,
        submitMode: 'api',
    };
}

export async function dismissEvolutionSuggestion(page, id) {
    const sessionId = parseSessionId(id);
    const uiResult = await clickEvolutionActionInPage(page, sessionId, 'later')
        .catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
    return {
        sessionId,
        status: uiResult?.ok ? 'dismissed' : 'dismiss_unavailable',
        message: uiResult?.ok
            ? 'Evolution suggestion was dismissed in the current WebAgent page.'
            : (uiResult?.reason || 'Evolution suggestion dismiss button was not found.'),
    };
}

export async function submitClarification(page, id, options = {}) {
    const session = await getSession(page, id, { turns: options.turns ?? 20 });
    const pending = findLatestClarification(session);
    if (!pending?.clarification) {
        throw new EmptyResultError('webagent clarify', `No clarification card found in WebAgent session ${session.id}.`);
    }
    if (pending.submitted && !parseBoolFlag(options.force, false)) {
        return {
            sessionId: session.id,
            status: 'already_submitted',
            clarification: pending.clarification,
            submittedText: pending.nextUserText || '',
            response: '',
        };
    }
    const answers = parseClarificationAnswerOverrides(options.answers, pending.clarification);
    const submittedText = buildClarificationSubmission(pending.clarification, answers, options.note);
    const previousUserCount = normalizeSessionMessages(session).filter((message) => message.role === 'user').length;
    const uiResult = await submitClarificationInPage(page, session.id, pending.clarification, answers, options.note)
        .catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
    if (uiResult?.ok) {
        const response = await waitForClarificationFollowup(
            page,
            session.id,
            submittedText,
            options.timeoutSeconds || 120,
            previousUserCount,
        );
        return {
            sessionId: session.id,
            status: response?.response ? 'submitted' : 'submitted_pending',
            submittedText: response?.submittedText || uiResult.submittedText || submittedText,
            response: response?.response || '',
            events: [],
            clarification: pending.clarification,
            submitMode: 'ui',
        };
    }
    const result = await sendToSession(page, session.id, submittedText, {
        timeoutSeconds: options.timeoutSeconds || 120,
    });
    return {
        ...result,
        clarification: pending.clarification,
        submittedText,
        submitMode: 'api',
    };
}

async function submitClarificationInPage(page, sessionId, clarification, answers = {}, note = '') {
    await page.goto(`${WEBAGENT_URL}chat/${encodeURIComponent(sessionId)}`, { waitUntil: 'load', settleMs: 2000 });
    await page.wait(1);
    return page.evaluate((clarificationData, answerData, noteText) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const visible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const shortNeedle = (value) => {
            const text = normalize(value);
            return text.length > 28 ? text.slice(0, 28) : text;
        };
        const clickElement = (el) => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
        };
        const candidateButtons = Array.from(document.querySelectorAll('button,[role="button"]'))
            .filter(visible)
            .filter((el) => {
                const text = normalize(el.textContent || el.getAttribute('aria-label') || '');
                return text === '提交' || text.includes('提交');
            });
        if (!candidateButtons.length) return { ok: false, reason: 'clarification submit button not found' };

        const questions = Array.isArray(clarificationData?.questions) ? clarificationData.questions : [];
        const markers = [
            clarificationData?.title,
            ...questions.flatMap((question) => [question.label, question.default, ...(question.options || [])]),
        ].map(shortNeedle).filter((item) => item.length >= 4);
        let best = null;
        for (const button of candidateButtons) {
            let node = button;
            let bestNode = button;
            let bestScore = 0;
            for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
                const text = normalize(node.textContent);
                const score = markers.reduce((total, marker) => total + (text.includes(marker) ? 1 : 0), 0);
                if (score >= bestScore) {
                    bestScore = score;
                    bestNode = node;
                }
            }
            if (!best || bestScore > best.score) best = { button, container: bestNode, score: bestScore };
        }
        if (!best?.button) return { ok: false, reason: 'clarification submit button not resolved' };

        const container = best.container || document.body;
        for (const question of questions) {
            const key = String(question.id ?? '');
            const oneBased = String(Number(key) + 1);
            const raw = answerData?.[key] ?? answerData?.[oneBased];
            const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
            for (const value of values.map(shortNeedle).filter(Boolean)) {
                const option = Array.from(container.querySelectorAll('button,[role="button"],label,[aria-label]'))
                    .filter(visible)
                    .find((el) => normalize(el.textContent || el.getAttribute('aria-label') || '').includes(value));
                if (option) clickElement(option);
            }
        }
        const note = normalize(noteText);
        if (note) {
            const noteTarget = Array.from(container.querySelectorAll('textarea,input,[contenteditable="true"]'))
                .filter(visible)
                .find((el) => /补充|说明|描述|其他|备注|note/i.test(normalize(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '')))
                || Array.from(container.querySelectorAll('textarea,input,[contenteditable="true"]')).filter(visible).pop();
            if (noteTarget) {
                noteTarget.focus();
                if (noteTarget instanceof HTMLTextAreaElement || noteTarget instanceof HTMLInputElement) {
                    noteTarget.value = note;
                } else {
                    noteTarget.textContent = note;
                }
                noteTarget.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: note }));
                noteTarget.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        clickElement(best.button);
        return { ok: true, submittedText: '' };
    }, clarification, answers, note);
}

async function waitForClarificationFollowup(page, sessionId, submittedText, timeoutSeconds, previousUserCount = 0) {
    const timeoutMs = Math.max(1, Number(timeoutSeconds) || 120) * 1000;
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        await page.wait(2);
        const session = await getSession(page, sessionId, { turns: 8 }).catch(() => null);
        if (!session) continue;
        last = findClarificationFollowup(session, submittedText, previousUserCount);
        if (last?.response) return last;
    }
    return last;
}

export async function postStream(page, path, body, timeoutSeconds = 120, knownSessionId = '', filesToRegister = []) {
    await ensureOnWebAgent(page);
    const result = await page.evaluate(async (apiBase, apiPath, requestBody, timeoutMs, suppliedSessionId, registerFiles) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let raw = '';
        let sessionId = suppliedSessionId || '';
        let serverId = '';
        const proxyUrl = (apiPath) => {
            const origin = (location.origin && location.origin !== 'null')
                ? location.origin
                : 'https://agent.famou.com';
            return `${origin}/proxyApi/${apiPath.replace(/^\/+/, '')}`;
        };
        const url = apiPath.startsWith('http')
            ? apiPath
            : proxyUrl(apiPath);
        const requestId = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const safeCookie = () => {
            try {
                return document.cookie || '';
            } catch {
                return '';
            }
        };
        const authHeaders = () => ({
            'x-bce-request-id': requestId(),
            'x-cookie': safeCookie(),
        });
        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                signal: controller.signal,
                headers: {
                    'Accept': 'text/event-stream',
                    'Content-Type': 'application/json',
                    ...authHeaders(),
                },
                body: requestBody ? JSON.stringify(requestBody) : undefined,
            });
            sessionId = response.headers.get('X-Session-ID') || suppliedSessionId || '';
            serverId = response.headers.get('X-Server-ID') || '';
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
                return { ok: false, status: response.status, statusText: response.statusText, sessionId, serverId, data, raw: text };
            }
            if (!response.body) {
                return { ok: false, status: response.status, statusText: 'ReadableStream unavailable', sessionId, serverId, data: null, raw: '' };
            }
            if (sessionId && Array.isArray(registerFiles) && registerFiles.length) {
                const files = registerFiles
                    .filter((file) => file && file.url && file.path)
                    .map((file) => ({ url: file.url, objectKey: file.path, fileName: file.name }));
                if (files.length) {
                    const uploadResponse = await fetch('/proxyApi/console/v1/file/upload', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            ...authHeaders(),
                        },
                        body: JSON.stringify({
                            sessionId,
                            bucket: registerFiles.find((file) => file?.bucket)?.bucket || 'fm-online',
                            files,
                        }),
                    });
                    if (!uploadResponse.ok) {
                        const text = await uploadResponse.text().catch(() => '');
                        let data = null;
                        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
                        return { ok: false, status: uploadResponse.status, statusText: uploadResponse.statusText, sessionId, serverId, data, raw: text };
                    }
                }
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const terminalStatuses = new Set(['idle', 'ended', 'failed', 'cancelled']);
            const isTerminalBlock = (block) => {
                let rawEventType = '';
                const dataLines = [];
                for (const line of block.split(/\r?\n/)) {
                    if (line.startsWith('event_type:')) rawEventType = line.slice('event_type:'.length).trim();
                    else if (line.startsWith('event:')) rawEventType = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
                }
                if (!dataLines.length) return false;
                let parsed = null;
                try { parsed = JSON.parse(dataLines.join('\n')); } catch { return false; }
                const type = rawEventType || parsed?.event_type || parsed?.type || '';
                const payload = parsed?.payload || {};
                const status = String(payload.status || payload.state || '').trim();
                return type === 'error'
                    || type === 'session/error'
                    || ((type === 'status' || type === 'session/status') && terminalStatuses.has(status));
            };
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                raw += chunk;
                buffer += chunk;
                const blocks = buffer.split(/\r?\n\r?\n/);
                buffer = blocks.pop() || '';
                if (blocks.some((block) => block.trim() && isTerminalBlock(block))) {
                    await reader.cancel().catch(() => {});
                    break;
                }
            }
            raw += decoder.decode();
            return { ok: true, status: response.status, statusText: response.statusText, sessionId, serverId, raw };
        } catch (err) {
            if (err && err.name === 'AbortError') {
                return { ok: false, aborted: true, message: 'timeout', sessionId, serverId, raw };
            }
            return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err), sessionId, serverId, raw };
        } finally {
            clearTimeout(timer);
        }
    }, WEBAGENT_API_BASE, path, body, timeoutSeconds * 1000, knownSessionId, filesToRegister);

    if (result?.aborted) {
        throw new TimeoutError('webagent response', timeoutSeconds);
    }
    if (!result?.ok) {
        const interruptedEvents = parseSseEvents(result.raw || '', result.sessionId || knownSessionId);
        const interruptedText = extractAssistantTextFromEvents(interruptedEvents);
        if (interruptedText || interruptedEvents.length) {
            return {
                sessionId: result.sessionId || knownSessionId,
                serverId: result.serverId || '',
                events: interruptedEvents,
                response: interruptedText,
                status: lastSessionStatus(interruptedEvents) || 'interrupted',
            };
        }
        mapStreamFailure(result, path);
    }
    const events = parseSseEvents(result.raw || '', result.sessionId || knownSessionId);
    const status = lastSessionStatus(events);
    if (status && ['failed', 'cancelled'].includes(status)) {
        const errorText = extractErrorText(events);
        throw new CommandExecutionError(errorText || `WebAgent session ${status}`);
    }
    return {
        sessionId: result.sessionId || knownSessionId,
        serverId: result.serverId || '',
        events,
        response: extractAssistantTextFromEvents(events),
        status,
    };
}

function mapStreamFailure(result, label) {
    const status = Number(result?.status || 0);
    const body = result?.data || {};
    const message = body?.error?.message || body?.message || body?.msg || body?.error || result?.message || result?.statusText;
    if (status === 401 || status === 403 || body?.code === 401 || body?.code === 403) {
        throw authRequired(String(message || 'WebAgent login is required.'));
    }
    throw new CommandExecutionError(`WebAgent stream request failed for ${label}: ${message || `HTTP ${status || 'unknown'}`}`);
}

export async function prepareUploadAttachments(page, uploadId, options = {}) {
    const inputs = collectUploadInputs(options);
    if (!inputs.length) return { files: [] };

    const uploaded = [];
    try {
        for (const input of inputs) {
            uploaded.push(await uploadWebAgentFile(page, uploadId, input));
        }
        return { files: uploaded };
    } finally {
        for (const input of inputs) {
            if (input.temp) fs.rmSync(input.path, { force: true });
        }
    }
}

function collectUploadInputs(options = {}) {
    const inputs = [];
    for (const filePath of normalizeArrayOption(options.files)) {
        inputs.push({ ...requireReadableFile(filePath, '--file'), source: '--file' });
    }
    for (const dataPath of normalizeArrayOption(options.dataFiles)) {
        inputs.push({ ...requireReadableFile(dataPath, '--data-file'), source: '--data-file' });
    }
    for (const [index, data] of normalizeArrayOption(options.data).entries()) {
        const text = normalizeInlineDataText(data);
        if (!text.trim()) continue;
        const input = writeTempDataFile(text, index);
        inputs.push(input);
    }
    return inputs;
}

async function uploadWebAgentFile(page, uploadId, input) {
    await ensureOnWebAgent(page);
    const data = fs.readFileSync(input.path);
    const base64 = data.toString('base64');
    const mimeType = mimeTypeForFile(input.name);
    const result = await page.evaluate(async (apiBase, jobId, fileName, fileType, fileSize, b64) => {
        const safeCookie = () => {
            try {
                return document.cookie || '';
            } catch {
                return '';
            }
        };
        const apiJson = async (apiPath, options = {}) => {
            const proxyUrl = (apiPath) => {
                const origin = (location.origin && location.origin !== 'null')
                    ? location.origin
                    : 'https://agent.famou.com';
                return `${origin}/proxyApi/${apiPath.replace(/^\/+/, '')}`;
            };
            const url = apiPath.startsWith('http')
                ? apiPath
                : proxyUrl(apiPath);
            const response = await fetch(url, {
                method: options.method || 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'x-bce-request-id': (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
                    'x-cookie': safeCookie(),
                    ...(options.headers || {}),
                },
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });
            const text = await response.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
            if (!response.ok || data?.code === 401 || data?.code === 403 || data?.success === false) {
                return { ok: false, status: response.status, statusText: response.statusText, data };
            }
            return { ok: true, status: response.status, data };
        };
        const waitForBosSdk = async () => {
            if (globalThis.baidubce?.sdk?.BosClient) return true;
            const src = 'https://bce.bdstatic.com/lib/@baiducloud/sdk/1.0.8-beta.2/baidubce-sdk.bundle.min.js';
            try {
                await new Promise((resolve, reject) => {
                    const existing = document.querySelector(`script[src="${src}"]`);
                    if (existing) {
                        existing.addEventListener('load', resolve, { once: true });
                        existing.addEventListener('error', reject, { once: true });
                    } else {
                        const script = document.createElement('script');
                        script.src = src;
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    }
                    const started = Date.now();
                    const poll = () => {
                        if (globalThis.baidubce?.sdk?.BosClient) {
                            resolve();
                            return;
                        }
                        if (Date.now() - started > 10000) {
                            reject(new Error('Baidu BOS SDK load timed out'));
                            return;
                        }
                        setTimeout(poll, 100);
                    };
                    poll();
                });
            } catch {
                return false;
            }
            return Boolean(globalThis.baidubce?.sdk?.BosClient);
        };
        const role = await apiJson(`console/v1/sessions/assume_role/${encodeURIComponent(jobId)}?source=1`);
        if (!role.ok) return { ok: false, stage: 'assume_role', ...role };
        const roleData = role.data?.data || role.data || {};
        const endpoint = roleData.endpoint || 'https://bj.bcebos.com';
        const bucket = roleData.bucketName || 'fm-online';
        const prefix = roleData.prefix || 'fm-console';
        if (!await waitForBosSdk()) {
            return { ok: false, stage: 'sdk', message: 'Baidu BOS SDK is not loaded on WebAgent page' };
        }
        const client = new globalThis.baidubce.sdk.BosClient({
            credentials: {
                ak: roleData.accessKeyId,
                sk: roleData.secretAccessKey,
            },
            sessionToken: roleData.sessionToken,
            endpoint,
        });
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        const blob = new Blob([bytes], { type: fileType || 'application/octet-stream' });
        const safeName = String(fileName || 'data.txt').replace(/[\\/]/g, '_');
        const key = `${prefix ? `${prefix}/` : ''}${jobId}/${safeName}`;
        try {
            await client.putObjectFromBlob(bucket, key, blob);
            const expiresAt = Math.floor(Date.now() / 1000) + 3600;
            const url = client.generatePresignedUrl(bucket, key, expiresAt, -1);
            return { ok: true, path: key, name: safeName, size: fileSize, url, bucket, fileType };
        } catch (err) {
            return {
                ok: false,
                stage: 'bos_upload',
                message: err instanceof Error ? err.message : String(err),
                code: err?.code || err?.body?.code,
                status: err?.status_code || err?.statusCode || err?.response?.status,
            };
        }
    }, WEBAGENT_API_BASE, uploadId, input.name, mimeType, input.size, base64);

    if (!result?.ok) {
        const message = result?.data?.message || result?.data?.msg || result?.message || result?.statusText || 'unknown error';
        if (result?.status === 401 || result?.status === 403 || result?.data?.code === 401 || result?.data?.code === 403) {
            throw authRequired(String(message || 'WebAgent login is required.'));
        }
        throw new CommandExecutionError(`WebAgent file upload failed for ${input.name}: ${message}`);
    }
    return {
        ...result,
        source: input.source || '',
    };
}

async function registerSessionFiles(page, sessionId, files = []) {
    const registered = files
        .filter((file) => file?.url && file?.path)
        .map((file) => ({
            url: file.url,
            objectKey: file.path,
            fileName: file.name,
        }));
    if (!registered.length) return;
    await browserJsonFetch(page, 'console/v1/file/upload', {
        method: 'POST',
        body: {
            sessionId,
            bucket: files.find((file) => file?.bucket)?.bucket || 'fm-online',
            files: registered,
        },
    });
}

export function parseSseEvents(raw, fallbackSessionId = '') {
    const events = [];
    const blocks = String(raw || '').split(/\r?\n\r?\n/);
    for (const block of blocks) {
        if (!block.trim()) continue;
        let id = '';
        let eventType = '';
        const dataLines = [];
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('id:')) id = line.slice(3).trim();
            else if (line.startsWith('event_type:')) eventType = line.slice('event_type:'.length).trim();
            else if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        let parsed;
        try {
            parsed = JSON.parse(dataLines.join('\n'));
        } catch {
            continue;
        }
        const payload = parsed?.payload ?? {};
        const type = EVENT_TYPE_MAP[eventType] || EVENT_TYPE_MAP[parsed?.event_type] || parsed?.type || eventType;
        events.push({
            event_id: String(parsed?.event_id ?? id ?? ''),
            session_id: String(parsed?.session_id ?? fallbackSessionId ?? ''),
            turn_id: String(parsed?.turn_id ?? ''),
            type,
            payload,
            seq: typeof parsed?.seq === 'number'
                ? parsed.seq
                : typeof payload?.seq === 'number'
                    ? payload.seq
                    : -1,
            ts: String(parsed?.created_at ?? parsed?.ts ?? ''),
        });
    }
    return events;
}

export function extractAssistantTextFromEvents(events) {
    const finalChunks = [];
    const fallbackChunks = [];
    for (const event of events || []) {
        if (event?.type !== 'agent/text') continue;
        const payload = event.payload || {};
        if (payload.partial === false && payload.content) {
            finalChunks.push(String(payload.content));
            fallbackChunks.push(String(payload.content));
        } else if (payload.partial !== true && payload.text) {
            finalChunks.push(String(payload.text));
            fallbackChunks.push(String(payload.text));
        } else if (payload.partial !== true && typeof payload === 'string') {
            finalChunks.push(payload);
            fallbackChunks.push(payload);
        } else if (payload.content) {
            fallbackChunks.push(String(payload.content));
        }
    }
    return stripSuggestions((finalChunks.length ? finalChunks : fallbackChunks).join('')).trim();
}

export function extractErrorText(events) {
    for (let i = (events || []).length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event?.type !== 'session/error') continue;
        const payload = event.payload || {};
        return String(payload.message || payload.error || payload.content || '').trim();
    }
    return '';
}

export function lastSessionStatus(events) {
    for (let i = (events || []).length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event?.type !== 'session/status') continue;
        const status = String(event.payload?.status || event.payload?.state || '').trim();
        if (status) return status;
    }
    return '';
}

export function isSessionDoneStatus(status) {
    return SESSION_DONE_STATUSES.has(String(status || '').trim());
}

export function normalizeSessionMessages(session) {
    if (Array.isArray(session?.messages) && session.messages.length) {
        return session.messages
            .map((message) => ({
                role: String(message?.role || '').toLowerCase(),
                text: String(message?.text ?? message?.content ?? '').trim(),
            }))
            .filter((message) => ['user', 'assistant'].includes(message.role) && message.text);
    }
    const events = Array.isArray(session?.events) ? session.events : [];
    const mapped = events.map((event) => ({
        id: event.event_id ?? event.id,
        type: event.type ?? event.payload?.type ?? '',
        payload: event.payload ?? {},
        created_at: event.created_at,
        seq: event.seq,
        turn_id: event.turn_id,
    }));
    const normalized = [];
    let currentAssistant = [];
    const flushAssistant = () => {
        if (!currentAssistant.length) return;
        const text = extractAssistantTextFromEvents(currentAssistant);
        if (text) normalized.push({ role: 'assistant', text });
        currentAssistant = [];
    };
    for (const event of mapped) {
        const type = eventTypeForHistory(event.type, event.payload);
        if (type === 'prompt') {
            flushAssistant();
            const text = extractPromptText(event.payload);
            if (text) normalized.push({ role: 'user', text });
            continue;
        }
        if (type === 'text') {
            currentAssistant.push({ type: 'agent/text', payload: event.payload });
        }
    }
    flushAssistant();
    return normalized;
}

export function parseWebAgentFeedback(value) {
    const text = String(value || '');
    const artifacts = extractArtifactsFromText(text);
    const evolution = extractEvolutionSuggestionFromText(text);
    return {
        cleanText: cleanWebAgentText(text),
        artifacts,
        evolution,
    };
}

export function cleanWebAgentText(value) {
    return stripSuggestions(String(value || '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<evolve>[\s\S]*?<\/evolve>/gi, '')
        .replace(/<artifacts>[\s\S]*?<\/artifacts>/gi, '')
        .trim());
}

export function extractEvolutionSuggestionFromText(value) {
    const data = extractTaggedJson(value, 'evolve');
    const rawReasons = data && (data.reasons ?? data.result ?? data.suggestions ?? []);
    const reasons = Array.isArray(rawReasons)
        ? rawReasons.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    return {
        available: reasons.length > 0,
        reasons,
    };
}

export function extractArtifactsFromText(value) {
    const data = extractTaggedJson(value, 'artifacts');
    const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.artifacts)
            ? data.artifacts
            : Array.isArray(data?.files)
                ? data.files
                : [];
    return list.map(normalizeArtifact).filter((item) => item.name || item.url);
}

export function receiptOutputFields(sessionId, feedback) {
    const parsed = feedback || parseWebAgentFeedback('');
    return {
        response: parsed.cleanText || null,
        session_id: sessionId || null,
        url: sessionId ? sessionUrl(sessionId) : null,
        receipt: summarizeReceipt(parsed),
        artifacts: formatArtifactsForOutput(parsed.artifacts),
        evolve: formatEvolutionForOutput(parsed.evolution),
        next_actions: formatNextActions(sessionId, parsed),
    };
}

export function extractClarificationFromText(value) {
    const text = String(value || '');
    const match = text.match(/<clarify>([\s\S]*?)<\/clarify>/i);
    if (!match) return null;
    const raw = match[1].trim();
    let data = null;
    try {
        const normalized = normalizeClarificationJson(raw
            .replace(/^```(?:json)?\s*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim());
        const parsed = JSON.parse(normalized);
        if (parsed?.title && Array.isArray(parsed.questions)) {
            data = {
                title: String(parsed.title),
                questions: parsed.questions.map((question, index) => normalizeClarificationQuestion(question, index)),
            };
        }
    } catch {
        data = fallbackParseClarification(raw);
    }
    if (!data?.questions?.length) return null;
    return {
        data,
        raw,
        cleanContent: text.replace(/<clarify>[\s\S]*?<\/clarify>/gi, '').trim(),
    };
}

export function buildClarificationSubmission(clarification, answers = {}, note = '') {
    if (!clarification?.questions?.length) {
        throw new ArgumentError('clarification data is missing questions');
    }
    const lines = clarification.questions.map((question) => {
        const answer = answers[question.id] ?? answers[String(Number(question.id) + 1)] ?? defaultClarificationAnswers(question);
        const selected = normalizeClarificationAnswer(answer, question.multi);
        return `${question.label}：${selected.length ? selected.join('、') : '（跳过）'}`;
    });
    const extra = String(note || '').trim();
    if (extra) lines.push(`补充说明：${extra}`);
    return lines.join('\n');
}

export function findLatestClarification(session) {
    const messages = normalizeSessionMessages(session);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;
        const parsed = extractClarificationFromText(message.text);
        if (!parsed?.data) continue;
        const nextUser = messages.slice(index + 1).find((item) => item.role === 'user');
        const submitted = Boolean(nextUser?.text && parseClarificationSubmittedAnswers(nextUser.text, parsed.data.questions));
        return {
            clarification: parsed.data,
            assistantIndex: index,
            submitted,
            nextUserText: nextUser?.text || '',
        };
    }
    return null;
}

function findClarificationFollowup(session, submittedText, previousUserCount = 0) {
    const messages = normalizeSessionMessages(session);
    const target = normalizeSubmittedClarificationText(submittedText);
    let userIndex = -1;
    const userIndexes = messages
        .map((message, index) => ({ message, index }))
        .filter((item) => item.message.role === 'user');
    if (previousUserCount > 0 && userIndexes.length > previousUserCount) {
        userIndex = userIndexes[previousUserCount].index;
    }
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (userIndex >= 0) break;
        const message = messages[index];
        if (message.role !== 'user') continue;
        const normalized = normalizeSubmittedClarificationText(message.text);
        if (normalized === target || normalized === '已提交') {
            userIndex = index;
            break;
        }
    }
    if (userIndex < 0) {
        const pending = findLatestClarification(session);
        if (pending?.submitted) userIndex = messages.findIndex((message) => message.text === pending.nextUserText);
    }
    if (userIndex < 0) return null;
    const response = messages.slice(userIndex + 1)
        .filter((message) => message.role === 'assistant')
        .map((message) => message.text)
        .filter(Boolean)
        .join('\n')
        .trim();
    return { response, submittedText: messages[userIndex]?.text || submittedText };
}

async function waitForPromptFollowup(page, sessionId, promptPrefix, timeoutSeconds, previousUserCount = 0) {
    const timeoutMs = Math.max(1, Number(timeoutSeconds) || 120) * 1000;
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        await page.wait(2);
        const session = await getSession(page, sessionId, { turns: 12 }).catch(() => null);
        if (!session) continue;
        last = findPromptFollowup(session, promptPrefix, previousUserCount);
        if (last?.response) return last;
    }
    return last;
}

function findPromptFollowup(session, promptPrefix, previousUserCount = 0) {
    const messages = normalizeSessionMessages(session);
    const userIndexes = messages
        .map((message, index) => ({ message, index }))
        .filter((item) => item.message.role === 'user');
    let userIndex = -1;
    if (previousUserCount > 0 && userIndexes.length > previousUserCount) {
        userIndex = userIndexes[previousUserCount].index;
    }
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (userIndex >= 0) break;
        const message = messages[index];
        if (message.role === 'user' && message.text.trim().startsWith(promptPrefix)) {
            userIndex = index;
            break;
        }
    }
    if (userIndex < 0) return null;
    const response = messages.slice(userIndex + 1)
        .filter((message) => message.role === 'assistant')
        .map((message) => cleanWebAgentText(message.text))
        .filter(Boolean)
        .join('\n')
        .trim();
    return { response, submittedText: messages[userIndex]?.text || promptPrefix };
}

async function clickEvolutionActionInPage(page, sessionId, action) {
    await page.goto(`${WEBAGENT_URL}chat/${encodeURIComponent(sessionId)}`, { waitUntil: 'load', settleMs: 2000 });
    await page.wait(1);
    const label = action === 'later' ? '稍后再说' : '启动伐谋深度演化';
    return page.evaluate((buttonLabel) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const visible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const clickElement = (el) => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
        };
        const candidates = Array.from(document.querySelectorAll('button,[role="button"]'))
            .filter(visible)
            .filter((el) => normalize(el.textContent || el.getAttribute('aria-label') || '').includes(buttonLabel));
        if (!candidates.length) return { ok: false, reason: `${buttonLabel} button not found` };
        clickElement(candidates[candidates.length - 1]);
        return { ok: true };
    }, label);
}

function normalizeSubmittedClarificationText(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function parseClarificationSubmittedAnswers(text, questions) {
    const parsed = {};
    const lines = String(text || '').split(/\r?\n/);
    for (const question of questions || []) {
        const line = lines.find((line) => line.includes(`${question.label}：`) || line.includes(`${question.label}:`));
        if (!line) continue;
        const zhIndex = line.indexOf(`${question.label}：`);
        const enIndex = line.indexOf(`${question.label}:`);
        const offset = zhIndex === -1
            ? enIndex + `${question.label}:`.length
            : zhIndex + `${question.label}：`.length;
        const value = line.slice(offset).trim();
        parsed[question.id] = value && value !== '（跳过）'
            ? normalizeClarificationAnswer(value, question.multi)
            : [];
    }
    return Object.keys(parsed).length ? parsed : null;
}

function normalizeClarificationJson(value) {
    let text = '';
    let inString = false;
    let escaped = false;
    for (const char of String(value || '')) {
        if (escaped) {
            text += char;
            escaped = false;
        } else if (inString && char === '\\') {
            text += char;
            escaped = true;
        } else if (char === '"') {
            text += char;
            inString = !inString;
        } else if (!inString && char === '，') {
            text += ',';
        } else {
            text += char;
        }
    }
    return text;
}

function normalizeClarificationQuestion(question, index) {
    return {
        id: String(question?.id ?? index),
        label: String(question?.label || '').trim(),
        hint: question?.hint ? String(question.hint) : undefined,
        multi: Boolean(question?.multi),
        options: Array.isArray(question?.options) ? question.options.map((item) => String(item)) : [],
        default: question?.default == null ? undefined : String(question.default),
    };
}

function fallbackParseClarification(raw) {
    const text = String(raw || '');
    const title = extractJsonLikeStringBeforeField(text, 'title', 'questions')
        || text.match(/"title"\s*[：:]\s*"([^"]+)"/)?.[1];
    if (!title) return null;
    const questions = [];
    const blocks = splitJsonLikeQuestionBlocks(text);
    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        const label = extractJsonLikeStringBeforeField(block, 'label', 'multi')
            || extractJsonLikeStringBeforeField(block, 'label', 'options')
            || block.match(/"label"\s*[：:]\s*"([^"]+)"/)?.[1];
        if (!label) continue;
        questions.push({
            id: String(index),
            label: unescapeJsonLikeString(label),
            multi: block.match(/"multi"\s*[：:]\s*true/) != null,
            options: extractJsonLikeStringArray(block, 'options'),
            default: unescapeJsonLikeString(
                extractJsonLikeStringBeforeField(block, 'default', null)
                || block.match(/"default"\s*[：:]\s*"([^"]*)"/)?.[1]
                || '',
            ) || undefined,
        });
    }
    return questions.length ? { title: unescapeJsonLikeString(title), questions } : null;
}

function splitJsonLikeQuestionBlocks(raw) {
    const text = String(raw || '');
    const starts = [];
    const labelRe = /"label"\s*[：:]\s*"/g;
    let match;
    while ((match = labelRe.exec(text)) !== null) {
        starts.push(match.index);
    }
    return starts.map((start, index) => {
        const end = index + 1 < starts.length ? starts[index + 1] : text.length;
        return text.slice(start, end);
    });
}

function latestAssistantMessage(session) {
    const messages = normalizeSessionMessages(session);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'assistant' && messages[index].text) return messages[index];
    }
    return null;
}

function extractJsonLikeStringBeforeField(raw, field, nextField) {
    const text = String(raw || '');
    const fieldMatch = new RegExp(`"${escapeRegExp(field)}"\\s*[：:]\\s*"`).exec(text);
    if (!fieldMatch) return '';
    const start = fieldMatch.index + fieldMatch[0].length;
    if (nextField) {
        const nextMatch = new RegExp(`"\\s*[,，]\\s*\\r?\\n?\\s*"${escapeRegExp(nextField)}"\\s*[：:]`).exec(text.slice(start));
        if (nextMatch) return text.slice(start, start + nextMatch.index);
    }
    const tail = text.slice(start);
    const endMatch = /"\s*(?:[,，]\s*\r?\n?\s*"|[}\]])/.exec(tail);
    if (!endMatch) return '';
    return tail.slice(0, endMatch.index);
}

function extractJsonLikeStringArray(raw, field) {
    const text = String(raw || '');
    const arrayMatch = new RegExp(`"${escapeRegExp(field)}"\\s*[：:]\\s*\\[([\\s\\S]*?)\\]`).exec(text);
    if (!arrayMatch) return [];
    const options = [];
    const optionRe = /"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = optionRe.exec(arrayMatch[1])) !== null) {
        options.push(unescapeJsonLikeString(match[1]));
    }
    return options;
}

function unescapeJsonLikeString(value) {
    return String(value || '').trim()
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultClarificationAnswers(question) {
    if (question.default) return [question.default];
    return question.multi ? [] : question.options?.[0] ? [question.options[0]] : [];
}

function normalizeClarificationAnswer(answer, multi = false) {
    if (answer == null || answer === '') return [];
    const values = Array.isArray(answer)
        ? answer
        : multi
            ? String(answer).split(/[、,]/)
            : [answer];
    return values.map((item) => String(item).trim()).filter(Boolean);
}

function parseClarificationAnswerOverrides(rawAnswers, clarification) {
    const parsed = {};
    for (const raw of normalizeArrayOption(rawAnswers)) {
        const text = String(raw || '').trim();
        if (!text) continue;
        const match = text.match(/^(\d+|[^=：:]+)\s*[=：:]\s*([\s\S]+)$/);
        if (!match) {
            throw new ArgumentError(
                `Invalid --answer value: ${text}`,
                'Use --answer 1=选项文本 or --answer "完整问题=选项文本".',
            );
        }
        const key = match[1].trim();
        const value = match[2].trim();
        const question = resolveClarificationQuestion(clarification, key);
        parsed[question.id] = normalizeClarificationAnswer(value, question.multi);
    }
    return parsed;
}

function resolveClarificationQuestion(clarification, key) {
    const questions = clarification?.questions || [];
    const numeric = Number(key);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= questions.length) {
        return questions[numeric - 1];
    }
    const found = questions.find((question) => question.id === key || question.label === key || question.label.includes(key));
    if (found) return found;
    throw new ArgumentError(`Unknown clarification question: ${key}`);
}

function eventTypeForHistory(type, payload) {
    const mapped = {
        'agent/text': 'text',
        'agent/thinking': 'thinking',
        'agent/tool_use': 'tool_use',
        'agent/tool_result': 'tool_result',
        'agent/usage': 'usage',
        'agent/plan': 'plan',
        'session/status': 'status',
        'session/error': 'status',
        'user/message': 'prompt',
        'agent/user_message': 'prompt',
    };
    return mapped[type] || mapped[payload?.type] || type || payload?.type || '';
}

function extractPromptText(payload) {
    const messages = payload?.messages;
    if (Array.isArray(messages)) {
        const user = messages.find((message) => message && typeof message === 'object' && message.role === 'user');
        const content = Array.isArray(user?.content) ? user.content : [];
        const parts = content
            .map((item) => promptContentPartText(item))
            .filter(Boolean);
        if (parts.length) return parts.join('\n').trim();
    }
    return String(payload?.content ?? payload?.prompt ?? '').trim();
}

function promptContentPartText(item) {
    if (!item || typeof item !== 'object') return '';
    const type = String(item.type || '').toLowerCase();
    if (type === 'text') return String(item.text || '').trim();
    if (type === 'file' || type === 'image') {
        const name = String(item.name || item.fileName || item.url || '').trim();
        return name ? `[Attached ${type}: ${name}]` : `[Attached ${type}]`;
    }
    return '';
}

export function normalizeSessionDetail(data, fallbackId = '') {
    const session = data || {};
    const id = String(session.id || session.session_id || fallbackId || '');
    const title = String(session.title || session.name || '').trim();
    const status = String(session.status || '').trim();
    return {
        id,
        title,
        status,
        project_id: String(session.projectId || session.project_id || '').trim(),
        created_at: String(session.created_at || session.createdAt || session.started_at || '').trim(),
        updated_at: String(session.updated_at || session.updatedAt || session.completed_at || '').trim(),
        url: id ? `${WEBAGENT_URL}chat/${id}` : WEBAGENT_URL,
        messages: normalizeSessionMessages(session),
        raw: session,
    };
}

function normalizeSessionSummary(item) {
    const id = String(item?.id || item?.session_id || item?.sessionId || '').trim();
    return {
        id,
        title: String(item?.title || item?.name || '').trim(),
        status: String(item?.status || '').trim(),
        projectId: String(item?.projectId || item?.project_id || '').trim(),
        createdAt: String(item?.created_at || item?.createdAt || item?.started_at || '').trim(),
        updatedAt: String(item?.updated_at || item?.updatedAt || item?.completed_at || '').trim(),
        url: id ? `${WEBAGENT_URL}chat/${id}` : '',
    };
}

export function normalizeProjectSummary(item) {
    const id = String(item?.projectId || item?.id || '').trim();
    const name = String(item?.projectName || item?.name || 'untitled').trim();
    const knowledge = Array.isArray(item?.knowledge) ? item.knowledge : [];
    return {
        id,
        name,
        file_count: knowledge.length,
        skill_count: Array.isArray(item?.skills) ? item.skills.length : 0,
        task_count: Array.isArray(item?.tasks) ? item.tasks.length : 0,
        created_at: String(item?.createTime || item?.created_at || item?.createdAt || '').trim(),
        file_limit: item?.limit?.fileCount ?? null,
        size_limit: item?.limit?.fileSize ? formatBytes(item.limit.fileSize) : null,
    };
}

export function normalizeProjectDetail(item) {
    const summary = normalizeProjectSummary(item);
    const tasks = Array.isArray(item?.tasks) ? item.tasks : [];
    const knowledge = Array.isArray(item?.knowledge) ? item.knowledge : [];
    return {
        ...summary,
        task_ids: tasks
            .map((task) => String(task?.sessionId || task?.session_id || task?.id || '').trim())
            .filter(Boolean)
            .join(', '),
        files: knowledge
            .map((file) => String(file?.fileName || file?.filename || file?.name || '').trim())
            .filter(Boolean)
            .join(', '),
    };
}

function extractTaggedJson(value, tagName) {
    const tag = escapeRegExp(tagName);
    const match = String(value || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!match) return null;
    const raw = match[1].trim()
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function normalizeArtifact(item) {
    const url = String(item?.path || item?.url || item?.download_url || item?.downloadUrl || item?.link || '').trim();
    const name = String(item?.name || item?.fileName || item?.filename || item?.title || '').trim()
        || path.basename(url.split('?')[0] || '');
    const size = Number(item?.size || 0);
    return {
        name,
        url,
        size: Number.isFinite(size) && size > 0 ? size : null,
        size_text: Number.isFinite(size) && size > 0 ? formatBytes(size) : '',
        file_id: String(item?.fileId || item?.file_id || item?.id || '').trim(),
    };
}

function summarizeReceipt(feedback) {
    const parts = [];
    if (feedback.artifacts?.length) parts.push(`${feedback.artifacts.length} artifacts`);
    if (feedback.evolution?.available) parts.push('deep_evolution_available');
    return parts.join(', ') || null;
}

function formatArtifactsForOutput(artifacts = []) {
    if (!artifacts.length) return null;
    return artifacts
        .map((artifact) => {
            const size = artifact.size_text ? ` (${artifact.size_text})` : '';
            return artifact.url ? `${artifact.name || 'artifact'}${size}: ${artifact.url}` : `${artifact.name}${size}`;
        })
        .join('\n');
}

function formatEvolutionForOutput(evolution) {
    if (!evolution?.available) return null;
    return evolution.reasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n');
}

function formatNextActions(sessionId, feedback) {
    if (!sessionId) return null;
    const actions = [`webagent receipt ${sessionId}`];
    if (feedback?.evolution?.available) {
        actions.push(`webagent evolve ${sessionId}`);
        actions.push(`webagent evolve ${sessionId} --later`);
    }
    return actions.join('\n');
}

function fileToMessageContent(file) {
    const name = file?.name || 'file';
    const extension = fileExtension(name);
    const isImage = String(file?.fileType || '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension);
    if (isImage) {
        return {
            type: 'image',
            name,
            size: file?.size || 0,
            mimeType: file?.fileType || mimeTypeForFile(name),
            url: file?.url || file?.path || '',
        };
    }
    return {
        type: 'file',
        name,
        size: file?.size || 0,
        url: file?.url || file?.path || '',
    };
}

function normalizeArrayOption(value) {
    if (value == null || value === '') return [];
    return Array.isArray(value) ? value.filter((item) => item != null && item !== '') : [value];
}

function normalizeInlineDataText(value) {
    const text = String(value ?? '');
    if (!text.includes('\n') && text.includes('\\n')) {
        return text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    return text;
}

function writeTempDataFile(text, index) {
    const name = `webagent-data-${Date.now()}-${index + 1}.txt`;
    const filePath = path.join(os.tmpdir(), name);
    fs.writeFileSync(filePath, text, 'utf8');
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BROWSER_UPLOAD_BYTES) {
        fs.rmSync(filePath, { force: true });
        throw new ArgumentError(
            `--data is too large for browser-side upload: ${formatBytes(stat.size)}`,
            `Current CLI upload limit is ${formatBytes(MAX_BROWSER_UPLOAD_BYTES)} per generated file.`,
        );
    }
    return { path: filePath, name, size: stat.size, temp: true };
}

function fileExtension(fileName) {
    const ext = path.extname(String(fileName || '')).replace(/^\./, '').toLowerCase();
    return ext || 'file';
}

function mimeTypeForFile(fileName) {
    const ext = fileExtension(fileName);
    const map = {
        csv: 'text/csv',
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json',
        pdf: 'application/pdf',
        html: 'text/html',
        htm: 'text/html',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
    };
    return map[ext] || 'application/octet-stream';
}

function formatBytes(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return '';
    if (num < 1024) return `${num}B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(0)}KB`;
    return `${(num / 1024 / 1024).toFixed(2)}MB`;
}

function stripSuggestions(value) {
    return String(value || '').replace(/<sag>[\s\S]*?<\/sag>/g, '').trim();
}

function createUploadId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

export function ensureAssistantResponse(result, commandName) {
    if (result.response) return result.response;
    if (!result.events?.length) {
        throw new EmptyResultError(commandName, 'The WebAgent stream ended without events.');
    }
    throw new EmptyResultError(commandName, 'The WebAgent stream ended without assistant text.');
}

export const __test__ = {
    EVENT_TYPE_MAP,
    normalizeSessionSummary,
    normalizeProjectSummary,
    fileToMessageContent,
    buildMessages,
    normalizeInlineDataText,
    latestAssistantMessage,
};
