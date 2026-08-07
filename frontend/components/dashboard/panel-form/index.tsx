/**
 * panel-form — the shared sections of the panel editing surface, extracted
 * from panel-edit-sidebar so each is individually reusable (e.g. by a future
 * add-modal form) and independently reviewable.
 *
 * The sidebar composes: DataSection → QuerySection → ProcessingSection →
 * DisplaySection → SettingsSection.
 */

export { SectionHeader } from "./section-header";
export { DataSection } from "./data-section";
export { QuerySection } from "./query-section";
export { ProcessingSection } from "./processing-section";
export { DisplaySection } from "./display-section";
export { SettingsSection } from "./settings-section";
