import type { GitHubGraphQlClient } from "../github/graphql-client.js";
import { listProjectFields } from "../github/projects.js";
import { projectIdOf, type ProjectService } from "../core/projects/project-service.js";
import type { AuthenticatedPrincipal } from "../core/identity/principal.js";
import type { WritePolicy } from "../core/policy/write-policy.js";

/**
 * K-Beauty WBS template derived from the second sheet ("WBS 작업목록") of
 * KBeauty_WBS_1.4(1).xlsx. Project #2 is intentionally NOT a valid target.
 * Future project templates can reuse the planner without changing this boundary.
 */
export const KBEAUTY_WBS_PROJECT = {
  owner: "gyuniverse-hq",
  number: 3,
  id: "PVT_kwDOEzfCi84BoBZc",
} as const;

type CustomType = "SINGLE_SELECT" | "DATE" | "NUMBER" | "TEXT";
type OptionColor = "GRAY" | "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE" | "PURPLE" | "PINK";
interface SelectOption {
  name: string;
  color: OptionColor;
  description: string;
}
export interface WbsFieldSpec {
  name: string;
  dataType: CustomType;
  options?: readonly SelectOption[];
}

const option = (name: string, color: OptionColor = "GRAY"): SelectOption =>
  ({ name, color, description: name });

export const KBEAUTY_WBS_FIELDS: readonly WbsFieldSpec[] = [
  {
    name: "Priority", dataType: "SINGLE_SELECT",
    options: [option("P0", "RED"), option("P1", "ORANGE"), option("P2", "YELLOW"), option("P3", "GRAY")],
  },
  { name: "Start date", dataType: "DATE" },
  { name: "Target date", dataType: "DATE" },
  { name: "Effort", dataType: "NUMBER" },
  { name: "WBS Code", dataType: "TEXT" },
  {
    name: "Part", dataType: "SINGLE_SELECT",
    options: [
      option("기획·프론트", "BLUE"), option("Vision·AR", "PURPLE"),
      option("LLM 서비스", "GREEN"), option("ML·DL 추천", "ORANGE"),
      option("기획·ML/DL", "PINK"),
    ],
  },
  {
    name: "Target", dataType: "SINGLE_SELECT",
    options: [
      option("최종발표", "BLUE"), option("중간발표", "PURPLE"),
      option("공식제출", "RED"), option("주간 운영", "GREEN"),
      option("선택·후순위", "GRAY"), option("매주 목요일 보고", "YELLOW"),
      option("공식제출 선행", "ORANGE"), option("조건부", "PINK"),
    ],
  },
] as const;

type ExistingField = { id: string; name: string; dataType: string; options: string[] };

function normalizeFields(rawFields: readonly unknown[]): ExistingField[] {
  return rawFields.flatMap((raw): ExistingField[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.dataType !== "string") return [];
    const options = Array.isArray(item.options)
      ? item.options.flatMap((value): string[] =>
        value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
          ? [(value as { name: string }).name] : [])
      : [];
    return [{ id: item.id, name: item.name, dataType: item.dataType, options }];
  });
}

export type WbsFieldAction = "create" | "skip-existing" | "manual-review";
export interface WbsFieldPlan {
  name: string;
  dataType: CustomType;
  action: WbsFieldAction;
  reason: string;
  options: string[];
}

export interface WbsSetupPlan {
  template: "kbeauty-wbs-v1";
  owner: string;
  number: number;
  projectId: string;
  readyForApply: boolean;
  statusOptions: string[];
  warnings: string[];
  fields: WbsFieldPlan[];
  missingFields: string[];
}

export function assertKbeautyWbsTarget(owner: string, number: number, projectId: string): void {
  if (owner !== KBEAUTY_WBS_PROJECT.owner
    || number !== KBEAUTY_WBS_PROJECT.number
    || projectId !== KBEAUTY_WBS_PROJECT.id) {
    throw new Error("WBS_TEMPLATE_TARGET_MISMATCH: This template may only configure gyuniverse-hq Project #3.");
  }
}

export function planKbeautyWbsFields(
  rawFields: readonly unknown[],
  owner = KBEAUTY_WBS_PROJECT.owner,
  number = KBEAUTY_WBS_PROJECT.number,
  projectId = KBEAUTY_WBS_PROJECT.id,
): WbsSetupPlan {
  assertKbeautyWbsTarget(owner, number, projectId);
  const fields = normalizeFields(rawFields);
  const status = fields.find((field) => field.name === "Status");
  const statusOptions = status?.options ?? [];
  const warnings: string[] = [];

  if (!status || status.dataType !== "SINGLE_SELECT" || !statusOptions.includes("Backlog")) {
    warnings.push("BLOCKED: Status must be SINGLE_SELECT and include the exact option 'Backlog'.");
  }
  if (!statusOptions.includes("In Review")) {
    warnings.push("OPTIONAL: Status 'In Review' is absent; add via GitHub UI if review tracking is needed. Existing Status options will not be overwritten.");
  }

  const plans: WbsFieldPlan[] = KBEAUTY_WBS_FIELDS.map((spec) => {
    const matches = fields.filter((field) => field.name === spec.name);
    const optionNames = spec.options?.map((value) => value.name) ?? [];
    if (matches.length === 0) {
      return { name: spec.name, dataType: spec.dataType, options: optionNames,
        action: "create", reason: "field does not exist" };
    }
    if (matches.length > 1) {
      return { name: spec.name, dataType: spec.dataType, options: optionNames,
        action: "manual-review", reason: "multiple fields with the same name" };
    }
    const existing = matches[0]!;
    if (existing.dataType !== spec.dataType) {
      return { name: spec.name, dataType: spec.dataType, options: optionNames,
        action: "manual-review", reason: "existing field has type " + existing.dataType };
    }
    const missingOptions = optionNames.filter((name) => !existing.options.includes(name));
    if (missingOptions.length > 0) {
      return { name: spec.name, dataType: spec.dataType, options: optionNames,
        action: "manual-review", reason: "existing option(s) missing: " + missingOptions.join(", ") };
    }
    return { name: spec.name, dataType: spec.dataType, options: optionNames,
      action: "skip-existing", reason: "compatible existing field; preserved without changes" };
  });

  return {
    template: "kbeauty-wbs-v1",
    owner, number, projectId,
    readyForApply: statusOptions.includes("Backlog") && status?.dataType === "SINGLE_SELECT"
      && plans.every((field) => field.action !== "manual-review"),
    statusOptions,
    warnings,
    fields: plans,
    missingFields: plans.filter((field) => field.action === "create").map((field) => field.name),
  };
}

export interface WbsFoundationOptions {
  client: GitHubGraphQlClient;
  projects: Pick<ProjectService, "resolveProject">;
  writePolicy: WritePolicy;
  principal: AuthenticatedPrincipal | null;
}

export class WbsFieldSetupService {
  constructor(private readonly options: WbsFoundationOptions) {}

  private async read(owner: string, number: number): Promise<{ id: string; fields: unknown[] }> {
    // Reject cross-project calls even before GitHub lookup; Project #2 is untouched.
    if (owner !== KBEAUTY_WBS_PROJECT.owner || number !== KBEAUTY_WBS_PROJECT.number) {
      throw new Error("WBS_TEMPLATE_TARGET_MISMATCH: This template may only target gyuniverse-hq Project #3.");
    }
    const project = await this.options.projects.resolveProject(owner, number);
    const projectId = projectIdOf(project);
    assertKbeautyWbsTarget(owner, number, projectId);
    return { id: projectId, fields: await listProjectFields(this.options.client, owner, number) };
  }

  async preview(owner: string, number: number): Promise<WbsSetupPlan> {
    const { id, fields } = await this.read(owner, number);
    return planKbeautyWbsFields(fields, owner, number, id);
  }

  async apply(owner: string, number: number): Promise<{
    created: string[];
    before: WbsSetupPlan;
    after: WbsSetupPlan;
  }> {
    if (!this.options.principal || this.options.principal.role !== "admin") {
      throw new Error("ADMIN_REQUIRED: Only an authenticated MCP Admin may configure WBS fields.");
    }
    const before = await this.preview(owner, number);
    this.options.writePolicy.authorize({ operation: "configure_project_fields", projectId: before.projectId });
    if (!before.readyForApply) throw new Error("WBS_FIELD_PREFLIGHT_FAILED: Inspect preview before applying.");

    const created: string[] = [];
    try {
      for (const spec of KBEAUTY_WBS_FIELDS) {
        const current = await this.preview(owner, number);
        if (!current.readyForApply) throw new Error("WBS_FIELD_STATE_CHANGED: Preflight no longer matches.");
        const plan = current.fields.find((field) => field.name === spec.name);
        if (!plan) throw new Error("WBS_FIELD_PLAN_MISSING: " + spec.name);
        if (plan.action === "skip-existing") continue;
        if (plan.action !== "create") throw new Error("WBS_FIELD_INCOMPATIBLE: " + spec.name);

        const input = {
          projectId: before.projectId,
          name: spec.name,
          dataType: spec.dataType,
          ...(spec.options ? { singleSelectOptions: spec.options.map((o) => ({
            name: o.name, color: o.color, description: o.description,
          })) } : {}),
        };
        await this.options.client.request(
          "mutation($input: CreateProjectV2FieldInput!) { createProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType } } } }",
          { input },
        );

        // Verify the field was actually created and remains compatible.
        const verified = await this.preview(owner, number);
        const verifiedField = verified.fields.find((field) => field.name === spec.name);
        if (verifiedField?.action !== "skip-existing") {
          throw new Error("WBS_FIELD_VERIFICATION_FAILED: " + spec.name);
        }
        created.push(spec.name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("WBS_FIELD_PARTIAL_FAILURE: created [" + created.join(", ") + "]. "
        + message + ". Preview again before retrying; existing fields are preserved.");
    }
    return { created, before, after: await this.preview(owner, number) };
  }
}
