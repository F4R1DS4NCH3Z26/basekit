export interface SyncOptions {
  dir?: string;
  agents?: string;
  externalSkills: boolean;
  /** The raw value of `--external-skills` (S4): replaces the persisted choice. */
  externalChoice?: string;
  dryRun: boolean;
}
