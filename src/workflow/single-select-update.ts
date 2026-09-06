import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { listProjectFields, updateProjectItemField } from "../github/projects.js";

interface SingleSelectOption {
  id: string;
  name: string;
}

interface SingleSelectField {
  id: string;
  name: string;
  options: SingleSelectOption[];
}

interface ProjectItemFieldContext {
  itemId: string;
  projectId: string;
  projectNumber: number | null;
  projectTitle: string | null;
  current: SingleSelectOption | null;
}

export interface NamedSingleSelectUpdateInput {
  owner: string;
  projectNumber: number;
  projectId: string;
  itemId: string;
  fieldName: string;
  optionName: string;
  expectedFieldId?: string;
  expectedCurrentOptionId?: string | null;
  expectedTargetOptionId?: string;
}

export interface NamedSingleSelectPreview {
  project: { id: string; number: number; title: string | null };
  itemId: string;
  field: { id: string; name: string };
  requestedOption: SingleSelectOption;
  current: SingleSelectOption | null;
}

export interface NamedSingleSelectUpdateResult {
  changed: boolean;
  verified: boolean;
  project: {
    id: string;
    number: number;
    title: string | null;
  };
  itemId: string;
  field: {
    id: string;
    name: string;
  };
  requestedOption: SingleSelectOption;
  before: SingleSelectOption | null;
  after: SingleSelectOption | null;
  mutationSkippedReason: string | null;
}

interface ItemEnvelope {
  node?: {
    __typename?: string | null;
    id?: string | null;
    project?: {
      id?: string | null;
      number?: number | null;
      title?: string | null;
    } | null;
    fieldValueByName?: {
      __typename?: string | null;
      name?: string | null;
      optionId?: string | null;
    } | null;
  } | null;
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function stringField(value: unknown, key: string): string | null {
  const item = objectField(value, key);
  return typeof item === "string" && item.length > 0 ? item : null;
}

function resolveSingleSelectField(
  fields: unknown[],
  fieldName: string,
  optionName: string,
): { field: SingleSelectField; option: SingleSelectOption } {
  const namedFields = fields.filter((field) => stringField(field, "name") === fieldName);
  if (namedFields.length === 0) {
    throw new Error(`PROJECT_FIELD_NOT_FOUND: Project field '${fieldName}' was not found.`);
  }
  if (namedFields.length > 1) {
    throw new Error(`PROJECT_FIELD_AMBIGUOUS: Multiple Project fields are named '${fieldName}'.`);
  }

  const rawField = namedFields[0];
  if (stringField(rawField, "__typename") !== "ProjectV2SingleSelectField") {
    throw new Error(`INVALID_FIELD_TYPE: Project field '${fieldName}' is not a single-select field.`);
  }

  const fieldId = stringField(rawField, "id");
  if (!fieldId) {
    throw new Error(`PROJECT_FIELD_INVALID: Project field '${fieldName}' does not have a valid node ID.`);
  }

  const rawOptions = objectField(rawField, "options");
  const options = Array.isArray(rawOptions)
    ? rawOptions.flatMap((rawOption) => {
        const id = stringField(rawOption, "id");
        const name = stringField(rawOption, "name");
        return id && name ? [{ id, name }] : [];
      })
    : [];

  const matches = options.filter((option) => option.name === optionName);
  if (matches.length === 0) {
    throw new Error(`PROJECT_FIELD_OPTION_NOT_FOUND: Option '${optionName}' was not found in '${fieldName}'.`);
  }
  if (matches.length > 1) {
    throw new Error(`PROJECT_FIELD_OPTION_AMBIGUOUS: Multiple '${fieldName}' options are named '${optionName}'.`);
  }

  return {
    field: { id: fieldId, name: fieldName, options },
    option: matches[0]!,
  };
}

async function getProjectItemFieldContext(
  client: GitHubGraphQlClient,
  itemId: string,
  fieldName: string,
): Promise<ProjectItemFieldContext> {
  const data = await client.request<ItemEnvelope>(
    `query($itemId: ID!, $fieldName: String!) {
      node(id: $itemId) {
        __typename
        ... on ProjectV2Item {
          id
          project { id number title }
          fieldValueByName(name: $fieldName) {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
          }
        }
      }
    }`,
    { itemId, fieldName },
  );

  const item = data.node;
  if (!item || item.__typename !== "ProjectV2Item" || typeof item.id !== "string") {
    throw new Error(`PROJECT_ITEM_NOT_FOUND: '${itemId}' is not an accessible ProjectV2 item.`);
  }

  const projectId = item.project?.id;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error(`PROJECT_ITEM_INVALID: Project item '${itemId}' does not expose a valid parent Project ID.`);
  }

  const rawCurrent = item.fieldValueByName;
  const current = rawCurrent?.__typename === "ProjectV2ItemFieldSingleSelectValue"
    && typeof rawCurrent.optionId === "string"
    && typeof rawCurrent.name === "string"
    ? { id: rawCurrent.optionId, name: rawCurrent.name }
    : null;

  return {
    itemId: item.id,
    projectId,
    projectNumber: typeof item.project?.number === "number" ? item.project.number : null,
    projectTitle: typeof item.project?.title === "string" ? item.project.title : null,
    current,
  };
}

function assertItemInProject(context: ProjectItemFieldContext, expectedProjectId: string): void {
  if (context.projectId !== expectedProjectId) {
    throw new Error(
      `PROJECT_ITEM_PROJECT_MISMATCH: Project item '${context.itemId}' belongs to '${context.projectId}', not '${expectedProjectId}'.`,
    );
  }
}

export async function updateProjectSingleSelectByName(
  client: GitHubGraphQlClient,
  input: NamedSingleSelectUpdateInput,
): Promise<NamedSingleSelectUpdateResult> {
  const preview = await inspectProjectSingleSelectByName(client, input);
  const field = preview.field;
  const option = preview.requestedOption;
  const beforeContext = {
    itemId: preview.itemId,
    projectId: preview.project.id,
    projectNumber: preview.project.number,
    projectTitle: preview.project.title,
    current: preview.current,
  };
  if (("expectedFieldId" in input && field.id !== input.expectedFieldId) ||
      ("expectedTargetOptionId" in input && option.id !== input.expectedTargetOptionId)) {
    throw new Error(`PLAN_STALE: '${input.fieldName}' configuration changed after bulk preflight.`);
  }
  if ("expectedCurrentOptionId" in input &&
      (beforeContext.current?.id ?? null) !== input.expectedCurrentOptionId) {
    throw new Error(`PLAN_STALE: '${input.fieldName}' changed after bulk preflight.`);
  }

  if (beforeContext.current?.id === option.id) {
    return {
      changed: false,
      verified: true,
      project: {
        id: input.projectId,
        number: input.projectNumber,
        title: beforeContext.projectTitle,
      },
      itemId: input.itemId,
      field: { id: field.id, name: field.name },
      requestedOption: option,
      before: beforeContext.current,
      after: beforeContext.current,
      mutationSkippedReason: "already_at_requested_option",
    };
  }

  await updateProjectItemField(client, input.projectId, input.itemId, field.id, {
    singleSelectOptionId: option.id,
  });

  const afterContext = await getProjectItemFieldContext(client, input.itemId, input.fieldName);
  assertItemInProject(afterContext, input.projectId);

  if (afterContext.current?.id !== option.id || afterContext.current.name !== option.name) {
    throw new Error(
      `MUTATION_VERIFICATION_FAILED: '${input.fieldName}' did not resolve to '${input.optionName}' after mutation.`,
    );
  }

  return {
    changed: true,
    verified: true,
    project: {
      id: input.projectId,
      number: input.projectNumber,
      title: afterContext.projectTitle ?? beforeContext.projectTitle,
    },
    itemId: input.itemId,
    field: { id: field.id, name: field.name },
    requestedOption: option,
    before: beforeContext.current,
    after: afterContext.current,
    mutationSkippedReason: null,
  };
}

export async function inspectProjectSingleSelectByName(
  client: GitHubGraphQlClient,
  input: NamedSingleSelectUpdateInput,
): Promise<NamedSingleSelectPreview> {
  const fields = await listProjectFields(client, input.owner, input.projectNumber);
  const { field, option } = resolveSingleSelectField(fields, input.fieldName, input.optionName);
  const context = await getProjectItemFieldContext(client, input.itemId, input.fieldName);
  assertItemInProject(context, input.projectId);
  return {
    project: { id: input.projectId, number: input.projectNumber, title: context.projectTitle },
    itemId: context.itemId,
    field: { id: field.id, name: field.name },
    requestedOption: option,
    current: context.current,
  };
}
