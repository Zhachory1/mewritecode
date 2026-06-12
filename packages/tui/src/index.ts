// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.js";
// Chord (multi-key sequence) matcher — sits on top of KeybindingsManager
export { type ChordResult, type ChordSegment, ChordSession, parseChord } from "./chord.js";
// Color depth emission
export { type ColorDepth, detectColorDepth, hexToSgr, resetColorDepthCache, sgrReset } from "./color-depth.js";
// Activity monitor overlay (F2) — replaces the legacy SubagentOverlay.
export {
	type ActivityKind,
	ActivityOverlay,
	type ActivityOverlayOptions,
	type ActivityOverlayRegistry,
	type ActivityOverlayTheme,
	type ActivitySnapshot,
	type ActivityStatus,
	formatElapsed,
	NULL_ACTIVITY_REGISTRY,
} from "./components/ActivityOverlay.js";
// Components
export { Box } from "./components/box.js";
// Chapters (auto-folded transcript intent groups)
export {
	type Chapter,
	detectIntent,
	groupTurnsIntoChapters,
	type Intent,
	intentLabel,
	type Turn,
	toggleChapter,
} from "./components/Chapters.js";
export { CancellableLoader } from "./components/cancellable-loader.js";
// Diff view (side-by-side ≥ 100 cols)
export {
	type DiffLayout,
	type DiffLine,
	type DiffLineKind,
	DiffView,
	type DiffViewOptions,
	type DiffViewTheme,
	pairUpHunks,
	pickLayout,
	SIDE_BY_SIDE_MIN_WIDTH,
} from "./components/DiffView.js";
export { Editor, type EditorOptions, type EditorTheme } from "./components/editor.js";
export {
	type GroupedSelectGroup,
	type GroupedSelection,
	GroupedSelectList,
	type GroupedSelectListOptions,
} from "./components/grouped-select-list.js";
export { Image, type ImageOptions, type ImageTheme } from "./components/image.js";
export { Input } from "./components/input.js";
export { Loader } from "./components/loader.js";
export { type DefaultTextStyle, Markdown, type MarkdownTheme } from "./components/markdown.js";
// Status line (Claude Code v2.1.119 schema)
export {
	parseStatusLineSettings,
	renderDefault as renderStatusLineDefault,
	renderDetailed as renderStatusLineDetailed,
	renderStatusLineSync,
	StatusLine,
	type StatusLineComponentTheme,
	type StatusLineContext,
	type StatusLineRenderer,
	type StatusLineResult,
	type StatusLineSettings,
	sanitizeOneLine,
	tailPath,
} from "./components/StatusLine.js";
// Legacy subagent overlay — kept as a backward-compat published-API surface for
// one release (N4). Existing consumers importing SubagentOverlay /
// SubagentSnapshot / SubagentRegistry / NULL_SUBAGENT_REGISTRY keep working.
export {
	NULL_SUBAGENT_REGISTRY,
	SubagentOverlay,
	type SubagentOverlayOptions,
	type SubagentOverlayTheme,
	type SubagentRegistry,
	type SubagentSnapshot,
} from "./components/SubagentOverlay.js";
export {
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SelectListTruncatePrimaryContext,
} from "./components/select-list.js";
export { type SettingItem, SettingsList, type SettingsListTheme } from "./components/settings-list.js";
export { Spacer } from "./components/spacer.js";
export { Spinner, type SpinnerOptions } from "./components/spinner.js";
export { balancePartial, StreamingMarkdown } from "./components/streaming-markdown.js";
export { Text } from "./components/text.js";
export { TruncatedText } from "./components/truncated-text.js";
// Editor component interface (for custom editors)
export type { EditorComponent } from "./editor-component.js";
// Fuzzy matching
export { type FuzzyMatch, fuzzyFilter, fuzzyMatch } from "./fuzzy.js";
// Keybindings
export {
	getKeybindings,
	type Keybinding,
	type KeybindingConflict,
	type KeybindingDefinition,
	type KeybindingDefinitions,
	type Keybindings,
	type KeybindingsConfig,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "./keybindings.js";
// Keyboard input handling
export {
	decodeKittyPrintable,
	isKeyRelease,
	isKeyRepeat,
	isKittyProtocolActive,
	Key,
	type KeyEventType,
	type KeyId,
	matchesKey,
	parseKey,
	setKittyProtocolActive,
} from "./keys.js";
// Terminal notifications (OSC 9 + bell)
export { bell, type NotifyOptions, notify } from "./notifications.js";
// OSC-52 clipboard write
export { encodeOsc52, OSC52_MAX_BYTES, writeOsc52 } from "./osc52.js";
// Scroll buffer (in-app scrollback)
export { ScrollBuffer, type ScrollBufferOptions, type ScrollMode } from "./scroll-buffer.js";
// Spinner frame data
export {
	getSpinner,
	SPINNERS,
	type SpinnerName,
	type SpinnerVariant,
	THINKING_SPINNERS,
	TOOL_SPINNERS,
} from "./spinners.js";
// Input buffering for batch splitting
export { StdinBuffer, type StdinBufferEventMap, type StdinBufferOptions } from "./stdin-buffer.js";
// Synchronized output (DEC private mode 2026)
export {
	classifySyncOutputSupport,
	emitSyncOutputBegin,
	emitSyncOutputEnd,
	SYNC_OUTPUT_BEGIN,
	SYNC_OUTPUT_END,
	type SyncOutputCapabilityInput,
	type SyncOutputSupport,
	wrapSyncOutput,
} from "./sync-output.js";
// Terminal interface and implementations
export { ProcessTerminal, type Terminal } from "./terminal.js";
// Terminal identity + background detection
export {
	type BackgroundClassification,
	detectTerminalIdentity,
	type Multiplexer,
	type ProbeResult,
	probeTerminal,
	queryOsc11Standalone,
	queryTerminalBackground,
	relativeLuminance,
	type TerminalBackground,
	type TerminalIdentity,
	type TerminalProgram,
} from "./terminal-detect.js";
// Terminal image support
export {
	allocateImageId,
	type CellDimensions,
	calculateImageRows,
	deleteAllKittyImages,
	deleteKittyImage,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	resetCapabilitiesCache,
	setCellDimensions,
	type TerminalCapabilities,
} from "./terminal-image.js";
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	isFocusable,
	type OverlayAnchor,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type SidePanelHandle,
	type SidePanelOptions,
	type SizeValue,
	TUI,
} from "./tui.js";
// Utilities
export { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils.js";
