// usage-status — a Command Code mod that keeps a live usage readout under the prompt:
//
//   Model: Opus 5 | 5h:[#-------]14%(1h30m) wk:[########]97%(2d11h) | session:18m | ctx:[#---------]9%
//
// Model and context come from the live harness (cmd.getModel / cmd.getContextUsage); the
// 5h/weekly windows come from the same account usage API the built-in `/usage` command
// reads (`/alpha/billing/credits`), authenticated with your own Command Code key.

import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {ModApi} from '@commandcode/harness';

const POLL_MS = 60_000;
const TICK_MS = 10_000;
const BAR_WIDTH = 8;
const CTX_BAR_WIDTH = 10;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

interface UsageWindow {
	used: number;
	cap: number;
	resetAt: number;
}

interface WindowLimits {
	limited?: boolean;
	fiveHour?: UsageWindow;
	weekly?: UsageWindow;
}

type ApiEnv = 'local' | 'staging' | 'prod';

function resolveApiEnv(): ApiEnv {
	const fromEnv = process.env.COMMANDCODE_API_ENV;
	if (fromEnv === 'local' || fromEnv === 'staging' || fromEnv === 'prod')
		return fromEnv;
	if (process.argv.includes('--local')) return 'local';
	if (process.argv.includes('--staging')) return 'staging';
	return 'prod';
}

function resolveBaseUrl(): string {
	const custom = process.env.COMMANDCODE_API_URL;
	if (custom) return custom.replace(/\/+$/, '');
	const env = resolveApiEnv();
	if (env === 'local') return 'http://localhost:9090';
	if (env === 'staging') return 'https://staging-api.commandcode.ai';
	return 'https://api.commandcode.ai';
}

function resolveAuthFile(): string {
	const env = resolveApiEnv();
	const file =
		env === 'local'
			? 'auth.local.json'
			: env === 'staging'
				? 'auth.staging.json'
				: 'auth.json';
	return join(homedir(), '.commandcode', file);
}

function resolveApiKey(): string | null {
	const fromEnv = process.env.COMMAND_CODE_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	try {
		const parsed = JSON.parse(readFileSync(resolveAuthFile(), 'utf8'));
		return typeof parsed?.apiKey === 'string' && parsed.apiKey
			? parsed.apiKey
			: null;
	} catch {
		return null;
	}
}

async function getJson(url: string, apiKey: string): Promise<any> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8000);
	try {
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			signal: controller.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

async function fetchWindowLimits(): Promise<WindowLimits | null> {
	if (process.env.CMD_LOCAL_ONLY === '1') return null;
	const apiKey = resolveApiKey();
	if (!apiKey) return null;
	const base = resolveBaseUrl();
	const who = await getJson(`${base}/alpha/whoami?limits=1`, apiKey);
	const orgId = who?.org?.id ?? null;
	const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
	const credits = await getJson(
		`${base}/alpha/billing/credits${query}`,
		apiKey,
	);
	return credits?.windowLimits ?? null;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function usageColor(percent: number): string {
	if (percent >= 80) return RED;
	if (percent >= 50) return YELLOW;
	return GREEN;
}

function blockBar(percent: number, width: number): {filled: string; empty: string} {
	const clamped = clampPercent(percent);
	let filled = Math.round((clamped / 100) * width);
	if (clamped > 0.5 && filled === 0) filled = 1;
	if (clamped < 99.5 && filled === width) filled = width - 1;
	return {filled: '#'.repeat(filled), empty: '-'.repeat(width - filled)};
}

function formatDuration(ms: number): string {
	const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
	if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
	return `${minutes}m`;
}

function formatSessionAge(ms: number): string {
	if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s`;
	return formatDuration(ms);
}

function windowSegment(
	label: string,
	window: UsageWindow | undefined,
	now: number,
): string {
	if (!window || !Number.isFinite(window.cap) || window.cap <= 0)
		return `${DIM}${label}:--${RESET}`;
	const percent = clampPercent((window.used / window.cap) * 100);
	const color = usageColor(percent);
	const {filled, empty} = blockBar(percent, BAR_WIDTH);
	const remaining =
		Number.isFinite(window.resetAt) && window.resetAt > now
			? `(${formatDuration(window.resetAt - now)})`
			: '';
	return (
		`${DIM}${label}:${RESET}` +
		`[${color}${filled}${RESET}${DIM}${empty}${RESET}]` +
		`${color}${BOLD}${Math.round(percent)}%${RESET}` +
		`${DIM}${remaining}${RESET}`
	);
}

function contextSegment(cmd: ModApi): string {
	const usage = cmd.getContextUsage();
	if (!usage || usage.percent === null || usage.percent === undefined)
		return `${DIM}ctx:--${RESET}`;
	const used = clampPercent(usage.percent);
	const color = usageColor(used);
	const {filled, empty} = blockBar(used, CTX_BAR_WIDTH);
	return (
		`${DIM}ctx:${RESET}` +
		`[${color}${filled}${RESET}${DIM}${empty}${RESET}]` +
		`${color}${BOLD}${Math.round(used)}%${RESET}`
	);
}

function shortModel(cmd: ModApi): string {
	const model = cmd.getModel();
	if (!model) return 'unknown';
	const slash = model.lastIndexOf('/');
	return slash === -1 ? model : model.slice(slash + 1);
}

export default function (cmd: ModApi): void {
	let limits: WindowLimits | null = null;
	let lastFetch = 0;
	let fetching = false;
	let sessionStart = Date.now();

	const render = (): readonly string[] => {
		const now = Date.now();
		const header = `${DIM}Model:${RESET} ${BOLD}${shortModel(cmd)}${RESET}`;
		const windows =
			`${windowSegment('5h', limits?.fiveHour, now)} ` +
			`${windowSegment('wk', limits?.weekly, now)}`;
		const session = `${DIM}session:${RESET}${CYAN}${formatSessionAge(now - sessionStart)}${RESET}`;
		const separator = `${DIM}|${RESET}`;
		return [
			`${header} ${separator} ${windows} ${separator} ${session} ${separator} ${contextSegment(cmd)}`,
		];
	};

	const refresh = async (): Promise<void> => {
		if (fetching) return;
		fetching = true;
		lastFetch = Date.now();
		try {
			limits = await fetchWindowLimits();
		} catch {
			// keep the last known windows; a failed poll should not blank the line
		} finally {
			fetching = false;
			cmd.ui.refreshWidgets();
		}
	};

	if (cmd.ui.capabilities?.surface !== false) {
		cmd.ui.widget({placement: 'below-editor', render});
	}

	cmd.clock.every(TICK_MS, () => {
		void maybeFetch();
		cmd.ui.refreshWidgets();
	});

	async function maybeFetch(): Promise<void> {
		if (Date.now() - lastFetch >= POLL_MS) await refresh();
	}

	cmd.on('session_start', () => {
		sessionStart = Date.now();
		void refresh();
	});

	void refresh();
}
