// Real Vite compilation reached 26.31s on macOS CI; Windows also exceeded the
// default 10s hook deadline. Allow headroom per build without changing assertion
// deadlines or treating compilation speed as a product performance requirement.
export const BUILD_FIXTURE_TIMEOUT_MS = 60_000;
