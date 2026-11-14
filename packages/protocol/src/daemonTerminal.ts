import { z } from 'zod';

export const DaemonTerminalErrorCodeSchema = z.enum([
  'terminal_disabled',
  'terminal_not_found',
  'terminal_cwd_denied',
  'terminal_spawn_failed',
  'terminal_invalid_request',
  'terminal_busy',
  'terminal_resize_unavailable',
  'terminal_repaint_unsupported',
]);
export type DaemonTerminalErrorCode = z.infer<typeof DaemonTerminalErrorCodeSchema>;

export const DaemonTerminalErrorSchema = z.object({
  ok: z.literal(false),
  errorCode: DaemonTerminalErrorCodeSchema,
  error: z.string().min(1),
}).passthrough();
export type DaemonTerminalError = z.infer<typeof DaemonTerminalErrorSchema>;

export const DaemonTerminalLaunchIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session_attach'),
    sessionId: z.string().trim().min(1).max(512),
    /**
     * The app install asking: each one gets its own attach, so tmux sizes the window for the device in use instead of
     * every device resizing one shared terminal (CLI 0.3.35+; older machines ignore it and share one).
     */
    viewerId: z.string().trim().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal('happier_cli'),
    args: z.array(z.string().min(1).max(1024)).min(1).max(64),
  }),
]);
export type DaemonTerminalLaunchIntent = z.infer<typeof DaemonTerminalLaunchIntentSchema>;

function buildDaemonTerminalLaunchRequestSchema() {
  return z.object({
  terminalKey: z.string().min(1).max(2000).optional(),
  cwd: z.string().min(1).max(10_000).optional(),
  cols: z.number().int().min(2).max(500).optional(),
  rows: z.number().int().min(2).max(500).optional(),
  initialCommand: z.string().max(100_000).optional(),
  launch: DaemonTerminalLaunchIntentSchema.optional(),
  }).passthrough().superRefine((value, ctx) => {
    if (!value.terminalKey && !value.launch) {
      ctx.addIssue({ code: 'custom', path: ['terminalKey'], message: 'terminalKey or launch is required' });
    }
    if (value.launch && value.initialCommand !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['initialCommand'], message: 'initialCommand cannot be combined with launch' });
    }
  });
}

export const DaemonTerminalEnsureRequestSchema = buildDaemonTerminalLaunchRequestSchema();
export type DaemonTerminalEnsureRequest = z.infer<typeof DaemonTerminalEnsureRequestSchema>;

export const DaemonTerminalEnsureResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    terminalId: z.string().min(1),
    reused: z.boolean(),
  }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalEnsureResponse = z.infer<typeof DaemonTerminalEnsureResponseSchema>;

/** Longest wait a terminal read may ask for (the relay forwards a request for 30 s by default). */
export const DAEMON_TERMINAL_READ_MAX_WAIT_MS = 25_000;

export const DaemonTerminalStreamReadRequestSchema = z.object({
  terminalId: z.string().min(1),
  cursor: z.number().int().min(0),
  maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  maxEvents: z.number().int().min(1).max(2048).optional(),
  /**
   * When there is nothing new yet, wait up to this long for output before answering, so output reaches
   * the app the moment it appears. Kept under the relay's 30 s request limit. Older daemons ignore it
   * and answer at once.
   */
  waitMs: z.number().int().min(0).max(DAEMON_TERMINAL_READ_MAX_WAIT_MS).optional(),
}).passthrough();
export type DaemonTerminalStreamReadRequest = z.infer<typeof DaemonTerminalStreamReadRequestSchema>;

export const DaemonTerminalStreamEventDataSchema = z.object({
  t: z.literal('data'),
  data: z.string(),
}).passthrough();
export type DaemonTerminalStreamEventData = z.infer<typeof DaemonTerminalStreamEventDataSchema>;

export const DaemonTerminalStreamEventUrlSchema = z.object({
  t: z.literal('url'),
  url: z.string().url(),
  kind: z.enum(['auth', 'generic']),
  suggestOpen: z.boolean().optional(),
}).passthrough();
export type DaemonTerminalStreamEventUrl = z.infer<typeof DaemonTerminalStreamEventUrlSchema>;

export const DaemonTerminalStreamEventGapSchema = z.object({
  t: z.literal('gap'),
  droppedBefore: z.number().int().min(0),
}).passthrough();
export type DaemonTerminalStreamEventGap = z.infer<typeof DaemonTerminalStreamEventGapSchema>;

export const DaemonTerminalStreamEventExitSchema = z.object({
  t: z.literal('exit'),
  exitCode: z.number().int().nullable(),
  signal: z.number().int().nullable(),
}).passthrough();
export type DaemonTerminalStreamEventExit = z.infer<typeof DaemonTerminalStreamEventExitSchema>;

export const DaemonTerminalStreamEventSchema = z.discriminatedUnion('t', [
  DaemonTerminalStreamEventDataSchema,
  DaemonTerminalStreamEventUrlSchema,
  DaemonTerminalStreamEventGapSchema,
  DaemonTerminalStreamEventExitSchema,
]);
export type DaemonTerminalStreamEvent = z.infer<typeof DaemonTerminalStreamEventSchema>;

export const DaemonTerminalStreamReadResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    terminalId: z.string().min(1),
    events: z.array(DaemonTerminalStreamEventSchema),
    nextCursor: z.number().int().min(0),
    done: z.boolean(),
    /** The daemon held this read open for `waitMs`: an empty answer means the wait ran out, ask again at once. */
    waited: z.boolean().optional(),
  }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalStreamReadResponse = z.infer<typeof DaemonTerminalStreamReadResponseSchema>;

export const DaemonTerminalInputRequestSchema = z.object({
  terminalId: z.string().min(1),
  data: z.string(),
}).passthrough();
export type DaemonTerminalInputRequest = z.infer<typeof DaemonTerminalInputRequestSchema>;

export const DaemonTerminalInputResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalInputResponse = z.infer<typeof DaemonTerminalInputResponseSchema>;

export const DaemonTerminalResizeRequestSchema = z.object({
  terminalId: z.string().min(1),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
}).passthrough();
export type DaemonTerminalResizeRequest = z.infer<typeof DaemonTerminalResizeRequestSchema>;

export const DaemonTerminalResizeResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalResizeResponse = z.infer<typeof DaemonTerminalResizeResponseSchema>;

export const DaemonTerminalCloseRequestSchema = z.object({
  terminalId: z.string().min(1),
}).passthrough();
export type DaemonTerminalCloseRequest = z.infer<typeof DaemonTerminalCloseRequestSchema>;

export const DaemonTerminalCloseResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalCloseResponse = z.infer<typeof DaemonTerminalCloseResponseSchema>;

export const DaemonTerminalRepaintRequestSchema = z.object({
  terminalId: z.string().min(1),
}).passthrough();
export type DaemonTerminalRepaintRequest = z.infer<typeof DaemonTerminalRepaintRequestSchema>;

export const DaemonTerminalRepaintResponseSchema = z.union([
  /** `cursor`: where the redrawn view starts in the terminal's output; a view reads on from there. */
  z.object({ ok: z.literal(true), cursor: z.number().int().min(0) }).passthrough(),
  DaemonTerminalErrorSchema,
]);
export type DaemonTerminalRepaintResponse = z.infer<typeof DaemonTerminalRepaintResponseSchema>;

export const DaemonTerminalRestartRequestSchema = buildDaemonTerminalLaunchRequestSchema();
export type DaemonTerminalRestartRequest = z.infer<typeof DaemonTerminalRestartRequestSchema>;

export const DaemonTerminalRestartResponseSchema = DaemonTerminalEnsureResponseSchema;
export type DaemonTerminalRestartResponse = z.infer<typeof DaemonTerminalRestartResponseSchema>;
