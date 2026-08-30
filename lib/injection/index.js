/**
 * @file Injection module public API
 * @module injection
 */

import { buildInjection, buildSignalInjection } from './builder.js';
export { buildInjection, buildSignalInjection };

import { calculatePhase, getPacingDirective } from './pacing.js';
export { calculatePhase, getPacingDirective };

import { stampPromptMessages } from './stamping.js';
export { stampPromptMessages };

import { parseSignals, stripSignalsFromMessage, processSignalResults, scrubArcInternals, promoteNextBeats } from './signals.js';
export { parseSignals, stripSignalsFromMessage, processSignalResults, scrubArcInternals, promoteNextBeats };
