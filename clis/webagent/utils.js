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
const MAX_INLINE_DATA_BYTES = 64 * 1024;
const INLINE_DATA_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'md', 'json', 'jsonl', 'log', 'yaml', 'yml']);
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
        const searchParams = fetchOptions.searchParams || null;
        const qs = searchParams && Object.keys(searchParams).length
            ? '?' + new URLSearchParams(Object.entries(searchParams)
                .filter(([, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => [key, String(value)])).toString()
            : '';
        const url = apiPath.startsWith('http')
            ? apiPath + qs
            : '/proxyApi/' + apiPath.replace(/^\/+/, '') + qs;
        const headers = {
            'Accept': 'application/json',
            'x-bce-request-id': (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
            'x-cookie': document.cookie || '',
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
        : Array.isArray(data?.list)
            ? data.list
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
    const payload = await browserJsonFetch(page, 'console/v1/sessions/list', {
        searchParams: { page: pageIndex, page_size: pageSize },
    });
    const data = payload?.data ?? payload;
    const list = Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.sessions)
            ? data.sessions
            : Array.isArray(data?.items)
                ? data.items
                : Array.isArray(data)
                    ? data
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
    const promptWithData = appendInlineDataToPrompt(prompt, upload.inlineData);
    const body = {
        id,
        config: { agent_type: options.agentType || 'opencode' },
        messages: buildMessages(promptWithData, upload.files),
        ...(options.projectId ? { project_id: String(options.projectId).trim() } : {}),
    };
    const result = await postStream(page, 'console/v1/sessions/create', body, options.timeoutSeconds || 120, id, upload.files);
    return { ...result, files: upload.files };
}

export async function sendToSession(page, id, prompt, options = {}) {
    const sessionId = parseSessionId(id);
    const upload = await prepareUploadAttachments(page, sessionId, options);
    const promptWithData = appendInlineDataToPrompt(prompt, upload.inlineData);
    const body = { messages: buildMessages(promptWithData, upload.files) };
    await registerSessionFiles(page, sessionId, upload.files);
    const result = await postStream(page, `console/v1/sessions/${encodeURIComponent(sessionId)}/events`, body, options.timeoutSeconds || 120, sessionId);
    return { ...result, files: upload.files };
}

export async function postStream(page, path, body, timeoutSeconds = 120, knownSessionId = '', filesToRegister = []) {
    await ensureOnWebAgent(page);
    const result = await page.evaluate(async (apiBase, apiPath, requestBody, timeoutMs, suppliedSessionId, registerFiles) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const url = apiBase.replace(/\/+$/, '') + '/' + apiPath.replace(/^\/+/, '');
        const requestId = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const authHeaders = () => ({
            'x-bce-request-id': requestId(),
            'x-cookie': document.cookie || '',
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
            const sessionId = response.headers.get('X-Session-ID') || suppliedSessionId || '';
            const serverId = response.headers.get('X-Server-ID') || '';
            let raw = '';
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
                return { ok: false, aborted: true, message: 'timeout', sessionId: suppliedSessionId || '' };
            }
            return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err), sessionId: suppliedSessionId || '' };
        } finally {
            clearTimeout(timer);
        }
    }, WEBAGENT_API_BASE, path, body, timeoutSeconds * 1000, knownSessionId, filesToRegister);

    if (result?.aborted) {
        throw new TimeoutError('webagent response', timeoutSeconds);
    }
    if (!result?.ok) {
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
    const { inputs, inlineData } = collectUploadInputs(options);
    if (!inputs.length) return { files: [], inlineData };

    const uploaded = [];
    try {
        for (const input of inputs) {
            uploaded.push(await uploadWebAgentFile(page, uploadId, input));
        }
        return { files: uploaded, inlineData };
    } finally {
        for (const input of inputs) {
            if (input.temp) fs.rmSync(input.path, { force: true });
        }
    }
}

function collectUploadInputs(options = {}) {
    const inputs = [];
    const inlineData = [];
    for (const filePath of normalizeArrayOption(options.files)) {
        inputs.push({ ...requireReadableFile(filePath, '--file'), source: '--file' });
    }
    for (const dataPath of normalizeArrayOption(options.dataFiles)) {
        const input = { ...requireReadableFile(dataPath, '--data-file'), source: '--data-file' };
        inputs.push(input);
        const inline = readInlineDataFile(input);
        if (inline) inlineData.push(inline);
    }
    for (const [index, data] of normalizeArrayOption(options.data).entries()) {
        const text = normalizeInlineDataText(data);
        if (!text.trim()) continue;
        const input = writeTempDataFile(text, index);
        inputs.push(input);
        inlineData.push({ name: input.name, source: '--data', text });
    }
    return { inputs, inlineData };
}

async function uploadWebAgentFile(page, uploadId, input) {
    await ensureOnWebAgent(page);
    const data = fs.readFileSync(input.path);
    const base64 = data.toString('base64');
    const mimeType = mimeTypeForFile(input.name);
    const result = await page.evaluate(async (apiBase, jobId, fileName, fileType, fileSize, b64) => {
        const apiJson = async (apiPath, options = {}) => {
            const url = apiPath.startsWith('http')
                ? apiPath
                : '/proxyApi/' + apiPath.replace(/^\/+/, '');
            const response = await fetch(url, {
                method: options.method || 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'x-bce-request-id': (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
                    'x-cookie': document.cookie || '',
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
        const role = await apiJson(`console/v1/sessions/assume_role/${encodeURIComponent(jobId)}?source=1`);
        if (!role.ok) return { ok: false, stage: 'assume_role', ...role };
        const roleData = role.data?.data || role.data || {};
        const endpoint = roleData.endpoint || 'https://bj.bcebos.com';
        const bucket = roleData.bucketName || 'fm-online';
        const prefix = roleData.prefix || 'fm-console';
        if (!globalThis.baidubce?.sdk?.BosClient) {
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
    return result;
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

function readInlineDataFile(input) {
    if (!input?.path || input.size > MAX_INLINE_DATA_BYTES) return null;
    if (!INLINE_DATA_EXTENSIONS.has(fileExtension(input.name))) return null;
    let text = '';
    try {
        text = fs.readFileSync(input.path, 'utf8');
    } catch {
        return null;
    }
    if (!text.trim()) return null;
    return { name: input.name, source: input.source || '--data-file', text };
}

function normalizeInlineDataText(value) {
    const text = String(value ?? '');
    if (!text.includes('\n') && text.includes('\\n')) {
        return text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    return text;
}

function appendInlineDataToPrompt(prompt, inlineData = []) {
    const snippets = inlineData
        .filter((item) => item && String(item.text || '').trim())
        .map((item) => formatInlineDataBlock(item));
    if (!snippets.length) return prompt;
    return [
        prompt,
        '',
        'The following data was supplied through OpenCLI. Use it as part of the user request:',
        '',
        snippets.join('\n\n'),
    ].join('\n');
}

function formatInlineDataBlock(item) {
    const name = sanitizeInlineDataLabel(item.name || 'data');
    const source = sanitizeInlineDataLabel(item.source || 'data');
    return [
        `----- BEGIN CLI DATA: ${name} (${source}) -----`,
        String(item.text || '').trimEnd(),
        `----- END CLI DATA: ${name} -----`,
    ].join('\n');
}

function sanitizeInlineDataLabel(value) {
    return String(value || '').replace(/[\r\n]/g, ' ').slice(0, 160);
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
    appendInlineDataToPrompt,
    normalizeInlineDataText,
};
