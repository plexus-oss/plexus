import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat config (ESLint 9). eslint-config-next@16 ships native flat config,
// which is incompatible with the legacy .eslintrc.json format.
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript];

export default eslintConfig;
