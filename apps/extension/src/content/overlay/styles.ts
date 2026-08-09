import { analysisOverlayStyles } from "./analysis-styles.js";
import { baseOverlayStyles } from "./base-styles.js";
import { toolbarOverlayStyles } from "./toolbar-styles.js";

export { overlayDesignTokens } from "./style-tokens.js";

export const overlayStyles = `${baseOverlayStyles}\n${toolbarOverlayStyles}\n${analysisOverlayStyles}`;
